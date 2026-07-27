// Read-only bridge for RC5.4 composites whose runner is the root channel's
// actually executed manager. It combines one per-contract durable manager
// shadow bank with one per-contract booked native runner. No counterfactual
// runner is inferred and manual closes are censored.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  DAY1_EXECUTABLE_GIVEBACK_TRAILS,
  DAY1_ROOT_BINDINGS,
} from "../worker/src/day1ReleasePolicy.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const FROM = arg("from", "2026-07-20T00:00:00Z");
const THROUGH = arg("through", "2026-07-25T23:59:59Z");
const OUTPUT = arg("output", "");
const MARKDOWN = arg("markdown", "");
if (!OUTPUT || !MARKDOWN) throw new Error("--output and --markdown are required");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) throw new Error("Supabase backend credentials missing");
const sb = createClient(url, key, { auth: { persistSession: false } });
const round = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const stable = (value: unknown): string => {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((name) => `${JSON.stringify(name)}:${stable(row[name])}`).join(",")}}`;
};

const ROOTS = [
  {
    channelSlug: "momo-shape",
    profile: "B30/A13",
    bankManagerId: "LOCK30/30",
    nativePolicy: "A13 arm +50% retain 67% executable-bid peak gain",
  },
  {
    channelSlug: "orb-qqq-trail",
    profile: "B20/NATIVE-ATR",
    bankManagerId: "LOCK20/30",
    nativePolicy: "atr_chandelier",
  },
] as const;

interface StrategistRow {
  id: string;
  slug: string;
  spec_json: Record<string, unknown> | null;
}

interface PositionRow {
  id: string;
  strategist_id: string;
  qty: number;
  avg_entry_price: number;
  realized_pnl: number;
  close_reason: string | null;
  opened_at: string;
  closed_at: string | null;
  occ_symbol: string;
  status: string;
}

interface ManagerRow {
  position_id: string;
  manager_id: string;
  manager_policy_version: string;
  shadow_book_version: string;
  status: string;
  evidence_state: string;
  original_qty: number;
  economic_mode: string;
  entry_price: number;
  terminal_at: string | null;
  terminal_bid: number | null;
  terminal_return_pct: number | null;
  terminal_pnl: number | null;
  terminal_trigger: string | null;
  terminal_quote_age_ms: number | null;
  actual_close_at: string | null;
  actual_close_reason: string | null;
  actual_realized_pnl: number | null;
  censor_code: string | null;
}

async function main(): Promise<void> {
const strategistRead = await sb.from("strategists")
  .select("id,slug,spec_json")
  .in("slug", ROOTS.map((row) => row.channelSlug))
  .order("slug");
if (strategistRead.error) throw new Error(`strategists SELECT failed: ${strategistRead.error.message}`);
const strategists = (strategistRead.data ?? []) as StrategistRow[];
const slugById = new Map(strategists.map((row) => [row.id, row.slug]));

const positionRead = await sb.from("positions")
  .select("id,strategist_id,qty,avg_entry_price,realized_pnl,close_reason,opened_at,closed_at,occ_symbol,status")
  .in("strategist_id", strategists.map((row) => row.id))
  .eq("status", "closed")
  .gte("opened_at", FROM)
  .lt("opened_at", THROUGH)
  .order("opened_at")
  .order("id");
if (positionRead.error) throw new Error(`positions SELECT failed: ${positionRead.error.message}`);
const positions = (positionRead.data ?? []) as PositionRow[];

const managerRead = positions.length
  ? await sb.from("manager_shadow_runs")
      .select("position_id,manager_id,manager_policy_version,shadow_book_version,status,evidence_state,original_qty,economic_mode,entry_price,terminal_at,terminal_bid,terminal_return_pct,terminal_pnl,terminal_trigger,terminal_quote_age_ms,actual_close_at,actual_close_reason,actual_realized_pnl,censor_code")
      .in("position_id", positions.map((row) => row.id))
      .in("manager_id", ROOTS.map((row) => row.bankManagerId))
      .order("entry_at")
      .order("id")
  : { data: [], error: null };
if (managerRead.error) throw new Error(`manager_shadow_runs SELECT failed: ${managerRead.error.message}`);
const managers = (managerRead.data ?? []) as ManagerRow[];

const specBySlug = new Map(strategists.map((row) => [row.slug, row.spec_json]));
const orbSpec = specBySlug.get("orb-qqq-trail") as {
  management?: { trail?: { mode?: string } };
} | undefined;
const policyChecks = {
  momoA13: DAY1_EXECUTABLE_GIVEBACK_TRAILS["momo-shape"]?.engageMult === 1.5
    && DAY1_EXECUTABLE_GIVEBACK_TRAILS["momo-shape"]?.givebackPct === 33
    && DAY1_EXECUTABLE_GIVEBACK_TRAILS["momo-shape"]?.priceBasis === "executable-option-bid",
  orbQqqNativeAtr: orbSpec?.management?.trail?.mode === "atr_chandelier",
  bindings: ROOTS.every((root) => DAY1_ROOT_BINDINGS.some((row) =>
    row.slug === root.channelSlug && strategists.some((strategist) =>
      strategist.slug === root.channelSlug && strategist.id === row.strategistId))),
};
if (!policyChecks.momoA13 || !policyChecks.orbQqqNativeAtr || !policyChecks.bindings)
  throw new Error(`native policy identity mismatch: ${JSON.stringify(policyChecks)}`);

interface CompositePath {
  positionId: string;
  channelSlug: string;
  profile: string;
  openedAt: string;
  closedAt: string;
  occSymbol: string;
  quantity: number;
  entryPrice: number;
  bank: {
    managerId: string;
    terminalAt: string;
    terminalBid: number;
    terminalTrigger: string;
    pnl: number;
    basis: "durable_manager_shadow_executable_bid";
  };
  runner: {
    terminalAt: string;
    terminalTrigger: string;
    pnl: number;
    basis: "booked_native_root_exit";
  };
  pnl: number;
  pnlPerContract: number;
  observedNativePnl: number;
  deltaVsObservedNative: number;
  exact: true;
}

interface Censor {
  positionId: string;
  channelSlug: string;
  profile: string;
  code: string;
  fact: string;
}

const paths: CompositePath[] = [];
const censors: Censor[] = [];
for (const position of positions) {
  const channelSlug = slugById.get(position.strategist_id) ?? "";
  const root = ROOTS.find((row) => row.channelSlug === channelSlug);
  if (!root) continue;
  if (position.close_reason === "manual" || position.close_reason === "operator") {
    censors.push({
      positionId: position.id,
      channelSlug,
      profile: root.profile,
      code: "manual_close_censors_native_runner",
      fact: position.close_reason,
    });
    continue;
  }
  const rows = managers.filter((row) =>
    row.position_id === position.id && row.manager_id === root.bankManagerId);
  if (rows.length !== 1) {
    censors.push({
      positionId: position.id,
      channelSlug,
      profile: root.profile,
      code: "missing_or_duplicate_bank_receipt",
      fact: `${rows.length} ${root.bankManagerId} rows`,
    });
    continue;
  }
  const bank = rows[0];
  const valid = bank.status === "terminal" && bank.evidence_state === "observing"
    && bank.economic_mode === "whole_lot_executable" && bank.censor_code == null
    && bank.original_qty === position.qty && position.qty === 2
    && finite(bank.entry_price) && Math.abs(bank.entry_price - position.avg_entry_price) < 0.0001
    && finite(bank.terminal_pnl) && finite(bank.terminal_bid)
    && bank.terminal_at != null && bank.terminal_trigger != null
    && finite(bank.actual_realized_pnl) && Math.abs(bank.actual_realized_pnl - position.realized_pnl) < 0.02
    && bank.actual_close_at != null && position.closed_at != null
    && Date.parse(bank.actual_close_at) === Date.parse(position.closed_at);
  if (!valid) {
    censors.push({
      positionId: position.id,
      channelSlug,
      profile: root.profile,
      code: "bank_or_native_receipt_invalid",
      fact: `${bank.status}/${bank.evidence_state}/${bank.economic_mode}`,
    });
    continue;
  }
  const bankPnl = round((bank.terminal_pnl as number) / position.qty);
  const runnerPnl = round(position.realized_pnl / position.qty);
  const pnl = round(bankPnl + runnerPnl);
  paths.push({
    positionId: position.id,
    channelSlug,
    profile: root.profile,
    openedAt: position.opened_at,
    closedAt: position.closed_at as string,
    occSymbol: position.occ_symbol,
    quantity: position.qty,
    entryPrice: position.avg_entry_price,
    bank: {
      managerId: bank.manager_id,
      terminalAt: bank.terminal_at as string,
      terminalBid: bank.terminal_bid as number,
      terminalTrigger: bank.terminal_trigger as string,
      pnl: bankPnl,
      basis: "durable_manager_shadow_executable_bid",
    },
    runner: {
      terminalAt: position.closed_at as string,
      terminalTrigger: position.close_reason ?? "unknown",
      pnl: runnerPnl,
      basis: "booked_native_root_exit",
    },
    pnl,
    pnlPerContract: round(pnl / 2),
    observedNativePnl: position.realized_pnl,
    deltaVsObservedNative: round(pnl - position.realized_pnl),
    exact: true,
  });
}

const summaries = ROOTS.map((root) => {
  const rows = paths.filter((row) => row.channelSlug === root.channelSlug);
  const pnl = round(rows.reduce((sum, row) => sum + row.pnl, 0));
  const observedNativePnl = round(rows.reduce((sum, row) => sum + row.observedNativePnl, 0));
  return {
    channelSlug: root.channelSlug,
    profile: root.profile,
    exactPaths: rows.length,
    censoredPaths: censors.filter((row) => row.channelSlug === root.channelSlug).length,
    pnl,
    avgPerPath: rows.length ? round(pnl / rows.length) : null,
    observedNativePnl,
    deltaVsObservedNative: round(pnl - observedNativePnl),
    wins: rows.filter((row) => row.pnl > 0).length,
    losses: rows.filter((row) => row.pnl < 0).length,
  };
});

const canonical = {
  schemaVersion: 1,
  replayVersion: "rc54-root-receipt-composite-v1",
  generatedAt: new Date().toISOString(),
  window: { fromInclusive: FROM, throughExclusive: THROUGH },
  policyChecks,
  source: {
    positions: "Supabase positions SELECT-only booked root exits",
    banks: "Supabase manager_shadow_runs SELECT-only durable executable-bid terminals",
    priceBasis: "one exact counterfactual bank lot plus one actually booked native-manager lot",
  },
  summaries,
  paths,
  censors,
  interpretation: {
    exactMeans: "both one-contract legs are grounded in durable observed receipts from the same two-contract position",
    manualCloseRule: "manual/operator closes cannot stand in for the native runner and are censored",
    noReentryClaim: true,
  },
  externalWrites: false,
  orderPathAuthorized: false,
  policyChangeAuthorized: false,
  rosterChangeAuthorized: false,
};
const canonicalSha256 = createHash("sha256").update(stable(canonical)).digest("hex");
const output = { ...canonical, canonicalSha256 };
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);

const money = (value: number | null): string =>
  value == null ? "—" : `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(0)}`;
const md = [
  "# RC5.4 native-runner receipt bridge",
  "",
  "This closes the exact-replay coverage gap without sending a new held-contract manifest to Databento.",
  "",
  "| Channel | Composite | Exact paths | Censored | Composite P&L | Existing native P&L | Delta |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...summaries.map((row) =>
    `| ${row.channelSlug} | ${row.profile} | ${row.exactPaths} | ${row.censoredPaths} | ${money(row.pnl)} | ${money(row.observedNativePnl)} | ${money(row.deltaVsObservedNative)} |`),
  "",
  "## Path receipts",
  "",
  "| Date | Channel | Composite | Bank leg | Native runner | Composite | Existing native | Delta |",
  "|---|---|---:|---:|---:|---:|---:|---:|",
  ...paths.map((row) =>
    `| ${row.openedAt.slice(0, 10)} | ${row.channelSlug} | ${row.profile} | ${money(row.bank.pnl)} | ${money(row.runner.pnl)} | ${money(row.pnl)} | ${money(row.observedNativePnl)} | ${money(row.deltaVsObservedNative)} |`),
  "",
  "## Censors",
  "",
  ...(censors.length
    ? censors.map((row) => `- ${row.positionId} · ${row.channelSlug} · ${row.code}: ${row.fact}`)
    : ["- None"]),
  "",
  "## Guardrails",
  "",
  "- Bank legs are observed executable-bid manager-shadow terminals divided to one contract.",
  "- Runner legs are the booked one-contract share of the channel's actually executed native manager.",
  "- Manual closes are excluded; they do not prove what the native manager would have done.",
  "- No re-entry, collision-release, future performance, policy, roster, or order claim is made.",
  "",
  `Canonical SHA-256: \`${canonicalSha256}\``,
  "",
];
writeFileSync(MARKDOWN, `${md.join("\n")}\n`);

console.log(`rc54-root-receipt-composites: ${paths.length} exact paths · ${censors.length} censors`);
console.log(`  json: ${OUTPUT}`);
console.log(`  markdown: ${MARKDOWN}`);
console.log("  external writes: NONE — Supabase SELECT-only; local evidence output only");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
