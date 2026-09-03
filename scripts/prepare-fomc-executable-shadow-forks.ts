// Publish two immutable, authority-dark registrations for the explicitly split
// FOMC/non-FOMC collectors. Default mode is read-only. This script cannot add a
// channel to a release manifest, authorize paper entries, or place an order.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { contentHash } from "../lib/channels/channelControlPlane";
import { prepareResearchChannelRegistrationWrite } from "../lib/channels/channelRosterBundlePersistence";
import { buildFomcExecutableShadowForkRegistrations, FOMC_EXECUTABLE_SHADOW_FORKS } from "../lib/channels/fomcExecutableShadowForks";
import { createServerSupabaseClient } from "./serverSupabase";

const has = (name: string): boolean => process.argv.includes(`--${name}`);
const value = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const publish = has("publish");
const acknowledged = has("ack-authority-dark");
const outputFile = resolve(value("output", "data/research/fomc-executable-shadow-forks/latest.json"));

interface WorkerRow { version: string; git_sha: string; last_heartbeat_at: string; ended_at: string | null }

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const joined = chars.join("");
  return [joined.slice(0, 8), joined.slice(8, 12), joined.slice(12, 16), joined.slice(16, 20), joined.slice(20)].join("-");
}

async function exactOperator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator inventory failed: ${read.error.message}`);
  const operators = read.data.users.filter(isDeskOperator);
  if (operators.length !== 1) throw new Error(`expected one desk operator, observed ${operators.length}`);
  return operators[0];
}

function exactFreshWorker(rows: WorkerRow[], nowMs: number): WorkerRow {
  const fresh = rows.filter((row) => row.ended_at == null
    && /^[a-f0-9]{40}$/i.test(row.git_sha)
    && Number.isFinite(Date.parse(row.last_heartbeat_at))
    && nowMs - Date.parse(row.last_heartbeat_at) >= 0
    && nowMs - Date.parse(row.last_heartbeat_at) <= 120_000);
  if (fresh.length !== 1) throw new Error(`expected one fresh exact worker, observed ${fresh.length}`);
  return fresh[0];
}

async function main(): Promise<void> {
  if (publish && !acknowledged) throw new Error("--publish requires --ack-authority-dark");
  const now = new Date().toISOString();
  if (publish) {
    const window = channelControlMutationWindow(Date.parse(now));
    if (!window.allowed) throw new Error(window.message);
  }
  const sb = createServerSupabaseClient("prepare-fomc-executable-shadow-forks");
  const [activeRead, workerRead, operator, sourceRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    sb.from("worker_runs").select("version,git_sha,last_heartbeat_at,ended_at")
      .is("ended_at", null).order("last_heartbeat_at", { ascending: false }).limit(20),
    exactOperator(sb),
    sb.from("strategists").select("id,slug,status,is_active,underlying,executor,account_id,spec_json,strategist_config(*)")
      .in("slug", Object.values(FOMC_EXECUTABLE_SHADOW_FORKS).map((fork) => fork.slug)),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") throw new Error("one exact active control-plane manifest is required");
  if (workerRead.error) throw new Error(`worker read failed: ${workerRead.error.message}`);
  if (sourceRead.error) throw new Error(`fork source read failed: ${sourceRead.error.message}`);
  const sources = sourceRead.data ?? [];
  if (sources.length !== 2) throw new Error(`expected two installed fork roots, observed ${sources.length}; apply the fork migration first`);
  for (const fork of Object.values(FOMC_EXECUTABLE_SHADOW_FORKS)) {
    const row = sources.find((source) => source.id === fork.channelId && source.slug === fork.slug);
    if (!row || row.status !== "draft" || row.is_active !== true || row.underlying !== "SPY" || row.executor !== "stream"
      || row.account_id !== "56daa293-e6bc-447d-83ac-2bfafb4d0ac1" || !row.spec_json) {
      throw new Error(`${fork.slug}: installed observe-only source identity drifted`);
    }
    const config = (Array.isArray(row.strategist_config) ? row.strategist_config[0] : row.strategist_config) as Record<string, unknown> | undefined;
    if (!config || Number(config.max_contracts) !== fork.quantity || Number(config.capital_pct) !== 105
      || Number(config.daily_stop_usd) !== 105 || Number(config.premium_stop_pct) !== 30
      || Number(config.take_profit_pct) !== 0 || Number(config.entry_dte) !== 0
      || config.event_policy !== (fork.eventPresence ? "ignore" : "standdown")) {
      throw new Error(`${fork.slug}: installed observe-only source config drifted`);
    }
  }
  const worker = exactFreshWorker((workerRead.data ?? []) as WorkerRow[], Date.parse(now));
  const registrations = buildFomcExecutableShadowForkRegistrations({
    active: activeRead.compiled,
    runtimeVersion: worker.version,
    runtimeSourceCommit: worker.git_sha,
    registeredAt: now,
    registeredBy: `operator:${operator.id}`,
  });
  if (registrations.some((registration) => registration.state !== "paper-eligible")) {
    throw new Error(`fork registration blocked: ${registrations.flatMap((row) => row.blockers).join("; ")}`);
  }
  for (const registration of registrations) {
    const source = sources.find((row) => row.id === registration.channelId);
    if (!source || contentHash(source.spec_json) !== registration.candidateSpec?.strategyVersion) {
      throw new Error(`${registration.slug}: durable strategist spec disagrees with the immutable registration`);
    }
  }
  const stored: unknown[] = [];
  if (publish) {
    for (const registration of registrations) {
      const write = prepareResearchChannelRegistrationWrite({
        registration,
        recordId: deterministicUuid(`fomc-executable-shadow-registration:${registration.contentHash}`),
      });
      const result = await sb.rpc(write.rpc, write.args).abortSignal(AbortSignal.timeout(8_000)).single();
      if (result.error) throw new Error(`${registration.slug}: registration rejected: ${result.error.message}`);
      stored.push(result.data);
    }
  }
  const receipt = {
    schemaVersion: 1,
    kind: "fomc-executable-shadow-fork-registration",
    generatedAt: now,
    mode: publish ? "published-authority-dark" : "plan-only",
    worker: { version: worker.version, gitSha: worker.git_sha, lastHeartbeatAt: worker.last_heartbeat_at },
    activeManifest: { key: activeRead.compiled.manifest.id, contentHash: activeRead.compiled.manifest.contentHash },
    registrations: registrations.map((row) => ({ registrationKey: row.id, channelId: row.channelId, slug: row.slug, state: row.state, contentHash: row.contentHash, quantity: row.candidateSpec?.quantity, manager: row.candidateSpec?.managerProfileId })),
    stored,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  };
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ outputFile, mode: receipt.mode, registrations: receipt.registrations, executionAuthority: false, orderAuthority: false }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
