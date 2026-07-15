// Read-only Phase 1J scorecard over the dark Phase 1I observers. This script
// writes a local research artifact only; it never mutates Supabase or policy.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PB2_MANAGER_ID,
  buildObserverScorecard,
  type FamilyAdmissionReceipt,
  type OpportunityOutcomeReceipt,
  type Pb2ShadowReceipt,
} from "../lib/research/observerScorecard.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const todayEt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const FROM = arg("from", "2026-07-14");
const THROUGH = arg("through", todayEt);
const OUT = arg("out", `data/observer-scorecards/${THROUGH}.json`);
for (const [label, value] of [["from", FROM], ["through", THROUGH]] as const) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid --${label} ${value}`);
}
if (FROM > THROUGH) throw new Error(`--from ${FROM} is after --through ${THROUGH}`);

function etWallToUtcMs(dateEt: string, hour: number, minute: number): number {
  const noon = new Date(`${dateEt}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(noon);
  const localHour = Number(parts.find((part) => part.type === "hour")?.value ?? "12") % 24;
  const localMinute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return Date.parse(`${dateEt}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`)
    + (12 * 60 - localHour * 60 - localMinute) * 60_000;
}

function nextDate(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

const START_ISO = new Date(etWallToUtcMs(FROM, 0, 0)).toISOString();
const END_ISO = new Date(etWallToUtcMs(nextDate(THROUGH), 0, 0)).toISOString();
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): Record<string, unknown> | null => value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

async function page<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1_000) return rows;
  }
}

interface FamilyDbRow {
  id: string;
  family_id: string;
  source_bar_at: string;
  candidate_count: number;
  candidates: unknown;
  admission_arms: unknown;
}

interface OutcomeDbRow {
  opportunity_id: string | null;
  realized_pnl: number | string | null;
}

interface Pb2DbRow {
  id: string;
  entry_at: string;
  status: string;
  terminal_pnl: number | string | null;
  actual_realized_pnl: number | string | null;
  bank_return_pct: number | string | null;
  censor_code: string | null;
}

function familyReceipt(row: FamilyDbRow): FamilyAdmissionReceipt | null {
  if (!Array.isArray(row.candidates) || !Array.isArray(row.admission_arms)) return null;
  const candidates = row.candidates.flatMap((value) => {
    const item = record(value);
    const opportunityId = item?.opportunityId;
    const channelSlug = item?.channelSlug;
    const requestedQty = Number(item?.requestedQty);
    return typeof opportunityId === "string" && typeof channelSlug === "string" && Number.isInteger(requestedQty)
      ? [{ opportunityId, channelSlug, requestedQty }]
      : [];
  });
  const admissionArms = row.admission_arms.flatMap((value) => {
    const item = record(value);
    const keepOpportunityId = item?.keepOpportunityId;
    const rejectOpportunityIds = item?.rejectOpportunityIds;
    return typeof keepOpportunityId === "string" && Array.isArray(rejectOpportunityIds) && rejectOpportunityIds.every((id) => typeof id === "string")
      ? [{ keepOpportunityId, rejectOpportunityIds: rejectOpportunityIds as string[] }]
      : [];
  });
  return Number.isInteger(row.candidate_count) && row.candidate_count >= 2
    && candidates.length === row.candidate_count && admissionArms.length === row.candidate_count
    ? { id: row.id, familyId: row.family_id, sourceBarAt: row.source_bar_at, candidates, admissionArms }
    : null;
}

function etDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

async function readOutcomes(sb: SupabaseClient, opportunityIds: string[]): Promise<OpportunityOutcomeReceipt[]> {
  const rows: OutcomeDbRow[] = [];
  for (let offset = 0; offset < opportunityIds.length; offset += 100) {
    const chunk = opportunityIds.slice(offset, offset + 100);
    const batch = await page<OutcomeDbRow>(
      (from, to) => sb.from("position_outcome_events")
        .select("opportunity_id,realized_pnl")
        .eq("event_kind", "position_booked")
        .in("opportunity_id", chunk)
        .order("event_at")
        .order("id")
        .range(from, to),
      "position outcomes",
    );
    rows.push(...batch);
  }
  return rows.flatMap((row) => {
    const realizedPnl = Number(row.realized_pnl);
    return row.opportunity_id && finite(realizedPnl) ? [{ opportunityId: row.opportunity_id, realizedPnl }] : [];
  });
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const familyRows = await page<FamilyDbRow>(
    (from, to) => sb.from("family_admission_observations")
      .select("id,family_id,source_bar_at,candidate_count,candidates,admission_arms")
      .gte("source_bar_at", START_ISO).lt("source_bar_at", END_ISO)
      .order("source_bar_at").order("id").range(from, to),
    "family observations",
  );
  const familyObservations = familyRows.flatMap((row) => {
    const parsed = familyReceipt(row);
    return parsed ? [parsed] : [];
  });
  const opportunityIds = [...new Set(familyObservations.flatMap((observation) => observation.candidates.map((candidate) => candidate.opportunityId)))];
  const opportunityOutcomes = await readOutcomes(sb, opportunityIds);

  const pb2Rows = await page<Pb2DbRow>(
    (from, to) => sb.from("manager_shadow_runs")
      .select("id,entry_at,status,terminal_pnl,actual_realized_pnl,bank_return_pct,censor_code")
      .eq("manager_id", PB2_MANAGER_ID)
      .gte("entry_at", START_ISO).lt("entry_at", END_ISO)
      .order("entry_at").order("id").range(from, to),
    "PB2 shadow runs",
  );
  const pb2Runs: Pb2ShadowReceipt[] = pb2Rows.flatMap((row) => {
    if (row.status !== "active" && row.status !== "terminal" && row.status !== "censored") return [];
    const terminalPnl = row.terminal_pnl == null ? null : Number(row.terminal_pnl);
    const actualRealizedPnl = row.actual_realized_pnl == null ? null : Number(row.actual_realized_pnl);
    const bankReturnPct = row.bank_return_pct == null ? null : Number(row.bank_return_pct);
    return [{
      id: row.id,
      sessionDateEt: etDate(row.entry_at),
      status: row.status,
      terminalPnl: finite(terminalPnl) ? terminalPnl : null,
      actualRealizedPnl: finite(actualRealizedPnl) ? actualRealizedPnl : null,
      bankReturnPct: finite(bankReturnPct) ? bankReturnPct : null,
      censorCode: row.censor_code,
    }];
  });

  const scorecard = buildObserverScorecard({ familyObservations, opportunityOutcomes, pb2Runs });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    window: { fromDateEt: FROM, throughDateEt: THROUGH, startIso: START_ISO, endExclusiveIso: END_ISO },
    evidence: {
      familyObservationRows: familyRows.length,
      validFamilyObservationRows: familyObservations.length,
      opportunityOutcomeRows: opportunityOutcomes.length,
      pb2ShadowRows: pb2Rows.length,
      source: "append_only_phase1i_receipts",
      priceBasis: "native booked pnl plus durable executable-bid manager shadow",
    },
    caveats: [
      "Evidence floors are review gates, never automatic promotion rules.",
      "Incomplete collision groups are censored rather than scored from a partial family.",
      "PB2 rankings exclude active, censored, and terminal rows missing either modeled or actual P&L.",
      "Observed executable bids are counterfactual evidence, not guaranteed fills.",
      "Regime concentration, quote gaps, slippage sensitivity, and native-close censoring still require review.",
    ],
    scorecard,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  const family = scorecard.familyAdmission;
  const pb2 = scorecard.pb2;
  console.log(`observer-scorecard: ${FROM} → ${THROUGH}`);
  console.log(`  family: ${family.completedGroups}/${family.observedGroups} complete · ${family.censoredGroups} censored · ${family.independentSessions} sessions · floor ${family.evidenceFloorMet ? "MET" : "NOT MET"}`);
  for (const channel of family.channels) console.log(`    ${channel.familyId} keep ${channel.channelSlug}: ${channel.completedGroups} groups · survivor $${channel.survivorPnl} · Δ $${channel.deltaVsNative}`);
  console.log(`  PB2: ${pb2.completedPaths}/${pb2.observedPaths} complete · ${pb2.bankTriggeredPaths} bank-triggered · ${pb2.censoredPaths} censored · ${pb2.activePaths} active · ${pb2.independentSessions} sessions`);
  console.log(`    native $${pb2.actualPnl} · modeled $${pb2.modeledPnl} · Δ $${pb2.deltaVsActual} · floor ${pb2.evidenceFloorMet ? "MET" : "NOT MET"}`);
  console.log("  promotion: NEVER AUTOMATIC — explicit operator review required");
  console.log(`  wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
