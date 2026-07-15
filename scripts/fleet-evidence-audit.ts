// Read-only Phase 1K-A fleet evidence inventory. The only write is a local JSON
// artifact; this script never mutates Supabase, strategy policy, or execution.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildFleetEvidenceAudit,
  type FleetChannelReceipt,
  type FleetExecutionReceipt,
  type FleetManagerReceipt,
  type FleetOutcomeReceipt,
  type FleetPositionReceipt,
  type FleetSignalReceipt,
} from "../lib/research/fleetEvidenceAudit.js";
import { POSITION_RESEARCH_ANNOTATIONS } from "../lib/research/positionAnnotations.js";

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
const FROM = arg("from", "2026-06-01");
const THROUGH = arg("through", todayEt);
const OUT = arg("out", `data/fleet-evidence-audits/${THROUGH}.json`);
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
const numeric = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return finite(parsed) ? parsed : null;
};

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

interface StrategistDbRow {
  id: string;
  slug: string;
  name: string;
  account_id: string | null;
  underlying: string | null;
  executor: string | null;
  status: string | null;
  is_active: boolean;
}
interface AccountDbRow { id: string; name: string; mode: string; }
interface ConfigDbRow { strategist_id: string; muted: boolean; }
interface SignalDbRow { strategist_id: string; acted_on: boolean; blocked_reason: string | null; }
interface PositionDbRow {
  id: string;
  strategist_id: string;
  opened_at: string;
  closed_at: string | null;
  qty: number | string | null;
  realized_pnl: number | string | null;
  close_reason: string | null;
  runner_of: string | null;
}
interface ExecutionDbRow {
  strategist_id: string;
  position_id: string | null;
  event_kind: string;
  action: string;
  opportunity_id: string | null;
  blocked_reason: string | null;
}
interface OutcomeDbRow { position_id: string; event_kind: string; opportunity_id: string | null; }
interface ManagerDbRow {
  strategist_id: string;
  position_id: string;
  status: string;
  economic_mode: string;
  terminal_pnl: number | string | null;
  actual_realized_pnl: number | string | null;
}

async function readFleet(sb: SupabaseClient): Promise<{
  channels: FleetChannelReceipt[];
  signals: FleetSignalReceipt[];
  positions: FleetPositionReceipt[];
  executions: FleetExecutionReceipt[];
  outcomes: FleetOutcomeReceipt[];
  managerRuns: FleetManagerReceipt[];
  sourceRows: Record<string, number>;
}> {
  const [strategists, accounts, configs, signalRows, positionRows, executionRows, outcomeRows, managerRows] = await Promise.all([
    page<StrategistDbRow>(
      (from, to) => sb.from("strategists")
        .select("id,slug,name,account_id,underlying,executor,status,is_active")
        .order("slug").order("id").range(from, to),
      "strategists",
    ),
    page<AccountDbRow>(
      (from, to) => sb.from("accounts").select("id,name,mode").order("sort_order").order("id").range(from, to),
      "accounts",
    ),
    page<ConfigDbRow>(
      (from, to) => sb.from("strategist_config").select("strategist_id,muted").order("strategist_id").range(from, to),
      "strategist config",
    ),
    page<SignalDbRow>(
      (from, to) => sb.from("signals")
        .select("strategist_id,acted_on,blocked_reason")
        .gte("created_at", START_ISO).lt("created_at", END_ISO)
        .order("created_at").order("id").range(from, to),
      "signals",
    ),
    page<PositionDbRow>(
      (from, to) => sb.from("positions")
        .select("id,strategist_id,opened_at,closed_at,qty,realized_pnl,close_reason,runner_of")
        .gte("opened_at", START_ISO).lt("opened_at", END_ISO)
        .order("opened_at").order("id").range(from, to),
      "positions",
    ),
    page<ExecutionDbRow>(
      (from, to) => sb.from("execution_observations")
        .select("strategist_id,position_id,event_kind,action,opportunity_id,blocked_reason")
        .gte("event_at", START_ISO).lt("event_at", END_ISO)
        .order("event_at").order("id").range(from, to),
      "execution observations",
    ),
    page<OutcomeDbRow>(
      (from, to) => sb.from("position_outcome_events")
        .select("position_id,event_kind,opportunity_id")
        .gte("event_at", START_ISO).lt("event_at", END_ISO)
        .order("event_at").order("id").range(from, to),
      "position outcomes",
    ),
    page<ManagerDbRow>(
      (from, to) => sb.from("manager_shadow_runs")
        .select("strategist_id,position_id,status,economic_mode,terminal_pnl,actual_realized_pnl")
        .gte("entry_at", START_ISO).lt("entry_at", END_ISO)
        .order("entry_at").order("id").range(from, to),
      "manager shadow runs",
    ),
  ]);

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const configByStrategist = new Map(configs.map((config) => [config.strategist_id, config]));
  return {
    channels: strategists.map((strategist) => {
      const account = strategist.account_id ? accountById.get(strategist.account_id) : null;
      return {
        strategistId: strategist.id,
        slug: strategist.slug,
        name: strategist.name,
        accountId: strategist.account_id,
        accountName: account?.name ?? null,
        accountMode: account?.mode ?? null,
        underlying: strategist.underlying,
        executor: strategist.executor,
        status: strategist.status,
        active: strategist.is_active,
        muted: configByStrategist.get(strategist.id)?.muted ?? null,
      };
    }),
    signals: signalRows.map((row) => ({ strategistId: row.strategist_id, actedOn: row.acted_on, blockedReason: row.blocked_reason })),
    positions: positionRows.map((row) => ({
      id: row.id,
      strategistId: row.strategist_id,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      quantity: numeric(row.qty),
      realizedPnl: numeric(row.realized_pnl),
      closeReason: row.close_reason,
      runnerOf: row.runner_of,
    })),
    executions: executionRows.map((row) => ({
      strategistId: row.strategist_id,
      positionId: row.position_id,
      eventKind: row.event_kind,
      action: row.action,
      opportunityId: row.opportunity_id,
      blockedReason: row.blocked_reason,
    })),
    outcomes: outcomeRows.map((row) => ({ positionId: row.position_id, eventKind: row.event_kind, opportunityId: row.opportunity_id })),
    managerRuns: managerRows.map((row) => ({
      strategistId: row.strategist_id,
      positionId: row.position_id,
      status: row.status,
      economicMode: row.economic_mode,
      terminalPnl: numeric(row.terminal_pnl),
      actualRealizedPnl: numeric(row.actual_realized_pnl),
    })),
    sourceRows: {
      strategists: strategists.length,
      accounts: accounts.length,
      configs: configs.length,
      signals: signalRows.length,
      positions: positionRows.length,
      executionObservations: executionRows.length,
      positionOutcomes: outcomeRows.length,
      managerShadowRuns: managerRows.length,
    },
  };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const fleet = await readFleet(sb);
  const audit = buildFleetEvidenceAudit({
    channels: fleet.channels,
    signals: fleet.signals,
    positions: fleet.positions,
    executions: fleet.executions,
    outcomes: fleet.outcomes,
    managerRuns: fleet.managerRuns,
    annotations: POSITION_RESEARCH_ANNOTATIONS,
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    window: { fromDateEt: FROM, throughDateEt: THROUGH, startIso: START_ISO, endExclusiveIso: END_ISO },
    sourceRows: fleet.sourceRows,
    source: "read_only_supabase_fleet_evidence",
    audit,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  const s = audit.summary;
  console.log(`fleet-evidence-audit: ${FROM} → ${THROUGH}`);
  console.log(`  ${s.channels} channels · ${s.channelsWithTrades} with trades · ${s.channelsWithSignalsOnly} signals-only`);
  console.log(`  ${s.rootTrades} root trades · ${s.closedRows} closed rows · gross ledger ${s.grossLedgerPnl == null ? "UNKNOWN" : `$${s.grossLedgerPnl}`}`);
  console.log(`  native ${s.nativeRows} rows / ${s.nativeOutcomePnl == null ? "P&L UNKNOWN" : `$${s.nativeOutcomePnl}`} · operator ${s.operatorManagedRows} · annotated ${s.annotatedExcludedRows} · reconciled ${s.executionCorrectionRows} · legacy-unattributed ${s.legacyUnattributedRows}`);
  console.log(`  ${s.completeLineageChannels} channel(s) have complete durable lineage for every row in this window`);
  for (const family of audit.families) {
    if (family.rootTrades === 0 && family.channels === 0) continue;
    console.log(`    ${family.familyId}: ${family.channels} ch · ${family.rootTrades} roots · native ${family.nativeRows} / ${family.nativeOutcomePnl == null ? "P&L UNKNOWN" : `$${family.nativeOutcomePnl}`} · complete-lineage ${family.completeLineageChannels}`);
  }
  console.log("  promotion: NEVER AUTOMATIC — this is evidence coverage, not a roster verdict");
  console.log(`  wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
