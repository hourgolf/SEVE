import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import { readCompleteEvidence } from "@/lib/perform/windowedEvidenceRead";
import { summarizeExecutableShadow, type SummaryReceipt, type SummaryRun } from "@/lib/research/executableShadowSummary";

export const dynamic = "force-dynamic";
const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLUG = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;
const validDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s))
  && new Date(s).toISOString().slice(0, 10) === s;
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "cache-control": "private, no-store, max-age=0" },
});
export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) return json({ ok: false, error: "executable-shadow evidence is not configured" }, 503);
  const params = new URL(req.url).searchParams, slug = params.get("slug") ?? "";
  if (!SLUG.test(slug)) return json({ ok: false, error: "invalid channel slug" }, 400);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const from = params.get("from") ?? "2026-06-01", through = params.get("through") ?? today;
  if (!validDay(from) || !validDay(through) || from > through || through > today)
    return json({ ok: false, error: "invalid evidence window" }, 400);
  try {
    const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const registration = await sb.from("research_channel_registration_current")
      .select("state,candidate_spec,registered_at,content_hash").eq("channel_slug", slug).maybeSingle();
    if (registration.error) throw new Error(registration.error.message);
    if (!registration.data?.candidate_spec) return json({ ok: true, summary: null });
    const hash = registration.data.content_hash;
    if (typeof hash !== "string" || !hash.startsWith("sha256:")) throw new Error("registration identity unavailable");
    const rows = await readCompleteEvidence<SummaryReceipt>(() => sb.from("executable_shadow_receipts")
      .select("id,run_id,opportunity_id,signal_id,channel_slug,session_date_et,mode,configuration_content_hash,manager_id,manager_version,contract_selection_id,disposition,result_per_contract_usd", { count: "exact" })
      .eq("channel_slug", slug).eq("mode", "channel_isolated").eq("configuration_content_hash", hash)
      .gte("session_date_et", from).lte("session_date_et", through).order("id"), "executable shadow receipts");
    const ids = [...new Set(rows.map(r => r.run_id))];
    const runs: SummaryRun[] = [];
    for (let start = 0; start < ids.length; start += 100) {
      const batch = ids.slice(start, start + 100);
      const metadata = await readCompleteEvidence<Omit<SummaryRun, "observedReceiptCount">>(() => sb.from("executable_shadow_runs")
        .select("id,generated_at,receipt_count", { count: "exact" }).in("id", batch).order("id"), "executable shadow runs");
      if (metadata.length !== batch.length) throw new Error("missing executable shadow run metadata");
      // A run is published before its append-only receipts. A partially
      // published newer run must not displace a complete prior session.
      for (let i = 0; i < metadata.length; i += 4) {
        runs.push(...await Promise.all(metadata.slice(i, i + 4).map(async run => {
          const actual = await sb.from("executable_shadow_receipts").select("id", { count: "exact", head: true }).eq("run_id", run.id);
          if (actual.error || actual.count == null) throw new Error("run completeness unavailable");
          return { ...run, observedReceiptCount: actual.count };
        })));
      }
    }
    const registrationAfter = await sb.from("research_channel_registration_current").select("content_hash").eq("channel_slug", slug).maybeSingle();
    if (registrationAfter.error || registrationAfter.data?.content_hash !== hash) throw new Error("registration changed during evidence read; refresh");
    const candidate = registration.data.candidate_spec as Record<string, unknown>;
    const exits = candidate.exitParameters as Record<string, unknown> | undefined;
    const controls = Array.isArray(exits?.executableShadowManagerControls) ? exits.executableShadowManagerControls.map(String) : [];
    const primaryManager = controls[0] ?? String(candidate.managerProfileId ?? "");
    const summary = summarizeExecutableShadow({ rows, runs, slug, configurationHash: hash, from, through, primaryManager });
    return json({ ok: true, summary: { ...summary, slug, posture: "OBSERVING", evidenceLayer: "EXECUTABLE SHADOW",
      primaryManager, nextGate: slug === "fomc-event-follow" ? "10 event sessions" : "10 recent independent sessions",
      registeredAt: registration.data.registered_at } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "executable-shadow summary failed" }, 502);
  }
}
