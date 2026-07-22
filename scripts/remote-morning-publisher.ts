// Remote, Mac-independent pre-open Sentinel publisher.
//
// This is intentionally a separate Railway cron/service, never imported by the
// order executor. It reads one bounded forensics row plus compact event receipts,
// self-gates to 08:55-09:10 ET, and publishes a truthfully PARTIAL Sentinel v3
// artifact until terrain/IV/full-scan inputs have their own durable cloud source.
//
// Local review (zero writes): npm run remote-morning-publisher -- --dry-run --force-window
// Railway cron: 0 13,14 * * 1-5 (one run self-gates in EDT, the other in EST)

import { buildRemoteSentinelMeta, deriveRemoteMorningPlan, remoteMorningClock, remoteMorningRunId, REMOTE_MORNING_PUBLISHER_VERSION, type PriorSentinelReceipt, type RemoteForensicsReport } from "@/lib/sentinel/remoteMorningPublisher";
import { auditMorningPublisherReceipt, type MorningPublisherEvent } from "@/lib/sentinel/morningPublisherReceipt";
import { createServerSupabaseClient } from "./serverSupabase";
import type { SupabaseClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_WINDOW = process.argv.includes("--force-window");
const atIndex = process.argv.indexOf("--at");
const AT_MS = atIndex >= 0 && process.argv[atIndex + 1] ? Date.parse(process.argv[atIndex + 1]) : null;
if (AT_MS != null && !DRY_RUN) throw new Error("--at is test-only and requires --dry-run");
if (AT_MS != null && !Number.isFinite(AT_MS)) throw new Error("--at must be a valid ISO timestamp");
const timeoutMs = Math.max(10_000, Math.min(120_000, Number(process.env.MORNING_PUBLISHER_TIMEOUT_MS ?? 60_000)));

let errorClient: SupabaseClient | null = null;
let errorContext: Record<string, unknown> = { version: REMOTE_MORNING_PUBLISHER_VERSION };

const withDeadline = async <T>(work: PromiseLike<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("remote-morning-publisher");
  errorClient = sb;
  const nowMs = AT_MS ?? Date.now();
  const [reportRead, sentinelRead, lifecycleRead] = await withDeadline(Promise.all([
    sb.from("forensics_reports").select("report_date,generated_at,payload").order("report_date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("events").select("message,created_at,meta").like("message", "sentinel:%").order("created_at", { ascending: false }).limit(25),
    sb.from("events").select("message,created_at,meta").in("message", ["morning-publisher: start", "morning-publisher: finish"]).order("created_at", { ascending: false }).limit(50),
  ]), "publisher inputs");
  for (const [label, result] of [["forensics", reportRead], ["sentinel", sentinelRead], ["lifecycle", lifecycleRead]] as const) {
    if (result.error) throw new Error(`${label} read failed: ${result.error.message}`);
  }

  const targetDate = remoteMorningClock(nowMs).date;
  const completedTarget = (lifecycleRead.data ?? []).some((row) => row.message === "morning-publisher: finish" && row.meta?.targetSession === targetDate)
    ? targetDate
    : null;
  const plan = deriveRemoteMorningPlan({
    nowMs,
    report: (reportRead.data as RemoteForensicsReport | null) ?? null,
    priorSentinel: ((sentinelRead.data?.[0] as PriorSentinelReceipt | undefined) ?? null),
    completedTarget,
    forceWindow: FORCE_WINDOW,
  });

  const publisherRunId = plan.targetSession && plan.evidenceSession
    ? remoteMorningRunId(plan.evidenceSession, plan.targetSession)
    : null;
  const summary = { version: REMOTE_MORNING_PUBLISHER_VERSION, publisherRunId, dryRun: DRY_RUN, action: plan.action, code: plan.code, detail: plan.detail, targetSession: plan.targetSession ?? null, evidenceSession: plan.evidenceSession ?? null };
  errorContext = summary;
  console.log(JSON.stringify(summary));
  if (plan.action === "skip") return;
  if (plan.action === "block") {
    throw new Error(plan.detail);
  }

  const publishedAt = new Date().toISOString();
  const matchingPacket = ((sentinelRead.data ?? []) as PriorSentinelReceipt[]).find((row) =>
    row.meta?.session === plan.evidenceSession
    && row.meta?.operatorPacket != null
    && typeof row.meta.operatorPacket === "object",
  ) ?? null;
  const meta = buildRemoteSentinelMeta(plan, publishedAt, matchingPacket);
  const runId = remoteMorningRunId(plan.evidenceSession, plan.targetSession);
  if (DRY_RUN) {
    console.log(JSON.stringify({ wouldPublish: { message: `sentinel: ${plan.evidenceSession}`, meta } }));
    return;
  }

  const priorLifecycle = lifecycleRead.data ?? [];
  const hasStart = priorLifecycle.some((row) => row.message === "morning-publisher: start" && row.meta?.publisherRunId === runId);
  const hasSentinel = (sentinelRead.data ?? []).some((row) => row.meta?.publisherRunId === runId);
  if (!hasStart) {
    const start = await withDeadline(sb.from("events").insert({ level: "INFO", message: "morning-publisher: start", meta: { ...summary, startedAt: publishedAt } }), "start receipt");
    if (start.error) throw new Error(`start receipt failed: ${start.error.message}`);
  }

  if (!hasSentinel) {
    const publish = await withDeadline(sb.from("events").insert({ level: "INFO", message: `sentinel: ${plan.evidenceSession}`, meta }), "Sentinel publish");
    if (publish.error) throw new Error(`Sentinel publish failed: ${publish.error.message}`);
  }

  const finish = await withDeadline(sb.from("events").insert({ level: "INFO", message: "morning-publisher: finish", meta: { ...summary, publisherEvidenceState: "partial", publishedAt } }), "finish receipt");
  if (finish.error) throw new Error(`finish receipt failed: ${finish.error.message}`);
  const verifyRead = await withDeadline(sb.from("events").select("message,created_at,meta")
    .contains("meta", { publisherRunId: runId }).order("created_at", { ascending: true }).limit(10), "receipt verification");
  if (verifyRead.error) throw new Error(`receipt verification read failed: ${verifyRead.error.message}`);
  const audit = auditMorningPublisherReceipt({
    events: (verifyRead.data as MorningPublisherEvent[] | null) ?? [],
    evidenceSession: plan.evidenceSession,
    targetSession: plan.targetSession,
  });
  if (audit.state !== "complete" && audit.state !== "recovered") throw new Error(`hosted receipt chain ${audit.state}: ${audit.facts.join("; ") || "incomplete"}`);
  console.log(`remote morning publisher: published ${plan.evidenceSession} -> ${plan.targetSession} (partial evidence)`);
}

main().catch((error) => {
  const message = (error as Error).message;
  console.error(`remote morning publisher: ${message}`);
  if (DRY_RUN || !errorClient) process.exit(1);
  void withDeadline(errorClient.from("events").insert({
    level: "WARN",
    message: "morning-publisher: error",
    meta: { ...errorContext, publisherEvidenceState: "error", error: message, observedAt: new Date().toISOString() },
  }), "fatal error receipt").then((result) => {
    if (result.error) throw new Error(result.error.message);
  }).catch((receiptError) => {
    console.error(`remote morning publisher: error receipt failed — ${(receiptError as Error).message}`);
  }).finally(() => process.exit(1));
});
