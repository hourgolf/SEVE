// SELECT-only channel manager evidence audit. Counterfactuals are admitted by
// nativeManagerComparison, which requires the observed channel spec, native
// catastrophe stop, whole-lot economics, and a verified before-close path.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readCompleteEvidence } from "../lib/perform/windowedEvidenceRead";
import type { ComparisonSpec, NativeObservation } from "../lib/research/nativeManagerComparison";
import {
  deriveChannelManagerEvidenceBook,
  type ChannelManagerPositionRow,
  type ChannelManagerRunRow,
} from "../lib/research/channelManagerEvidence";
import { createFixedEntryServiceClient } from "../worker/src/fixedEntryServiceClient";
import { readFixedManagerComparisonEvidence } from "../worker/src/fixedEntryManagerComparisonEvidence";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const envFile = resolve(arg("env-file") ?? ".env.local");
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const cohortFrom = arg("from") ?? "2026-07-13";
if (!/^\d{4}-\d{2}-\d{2}$/.test(cohortFrom)) throw new Error("--from must be YYYY-MM-DD");
const cohortIso = `${cohortFrom}T04:00:00.000Z`;
const out = resolve(arg("out") ?? "data/channel-manager-evidence-audit.json");

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createFixedEntryServiceClient(url, key);
  const [managerRuns, positions, fixedManagerComparison, comparisonSpecs, nativeObservations] = await Promise.all([
    readCompleteEvidence<ChannelManagerRunRow>(() => sb.from("manager_shadow_runs")
      .select([
        "id", "position_id", "channel_slug", "manager_id", "manager_policy_version",
        "shadow_book_version", "configuration_epoch_id", "status", "evidence_state",
        "entry_at", "entry_price", "original_qty", "economic_mode", "peak_return_pct",
        "terminal_at", "terminal_return_pct", "terminal_pnl", "censored_at", "censor_code",
        "account_id", "strategist_id", "admitted_at", "admission_source",
        "first_quote_at", "terminal_trigger",
      ].join(","), { count: "exact" })
      .gte("entry_at", cohortIso)
      .order("entry_at", { ascending: true })
      .order("id", { ascending: true }), "manager evidence"),
    readCompleteEvidence<ChannelManagerPositionRow>(() => sb.from("positions")
      .select("id,runner_of,realized_pnl,entry_features,qty,avg_entry_price,status,closed_at,close_reason,channel_spec_version_id", { count: "exact" })
      .order("id", { ascending: true }), "manager positions"),
    readFixedManagerComparisonEvidence(sb),
    readCompleteEvidence<ComparisonSpec>(() => sb.from("channel_spec_versions")
      .select("id,version_key,stop_loss,take_profit,ratchet_parameters,exit_parameters", { count: "exact" })
      .order("id"), "comparison specs"),
    readCompleteEvidence<NativeObservation & { id: string }>(() => sb.from("execution_observations")
      .select("id,position_id,event_at,reason,bid,payload", { count: "exact" })
      .eq("reason", "target_premium")
      .gte("event_at", cohortIso)
      .order("id"), "native target observations"),
  ]);
  const book = deriveChannelManagerEvidenceBook({ managerRuns, positions, fixedManagerComparison,
    comparisonSpecs, nativeObservations, generatedAt: new Date().toISOString(), cohortFrom });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(book, null, 2)}\n`);
  const channels = Object.values(book.channels).sort((left, right) => left.slug.localeCompare(right.slug));
  const lines = [
    `# Native-stop-preserved paired exit evidence — from ${cohortFrom}`,
    "",
    "Only prospective whole-lot manager paths with the same catastrophe stop as the position's sealed channel spec are scored.",
    "",
    "| Channel | State | Trades / sessions | Complete MFE | Best reviewable manager | Valid paths / coverage | Median lift | Beat rate | Verdict |",
    "|---|---|---:|---:|---|---:|---:|---:|---|",
    ...channels.map((channel) => {
      const verdictRank = { promising: 3, mixed: 2, collecting: 1, inferior: 0 } as const;
      const best = [...channel.managers].filter((manager) => manager.terminalPaths > 0)
        .sort((left, right) => verdictRank[right.verdict] - verdictRank[left.verdict]
          || right.terminalPaths - left.terminalPaths
          || (right.medianDeltaPct ?? -Infinity) - (left.medianDeltaPct ?? -Infinity))[0];
      return `| ${channel.slug} | ${channel.state} | ${channel.positions} / ${channel.sessions} | ${Math.round(channel.commonMfeCoverage * 100)}% | ${best?.managerId ?? "—"} | ${best ? `${best.terminalPaths} / ${Math.round(best.coverage * 100)}%` : "—"} | ${best?.medianDeltaPct == null ? "—" : `${best.medianDeltaPct}%`} | ${best?.beatRate == null ? "—" : `${Math.round(best.beatRate * 100)}%`} | ${best?.verdict ?? "collecting"} |`;
    }),
    "",
    "Censored paths remain visible in the JSON artifact and never become zero-return observations. This audit has no order, roster, policy, or production-write authority.",
    "",
  ];
  writeFileSync(out.replace(/\.json$/i, ".md"), lines.join("\n"));
  console.log(`channel-manager-evidence-audit: PASS · ${channels.length} channel(s) · ${managerRuns.length} source path(s) · production writes 0`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
