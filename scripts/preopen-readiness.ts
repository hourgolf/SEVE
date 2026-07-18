// ============================================================================
//  Pre-open readiness gate — read-only proof of the production paper boundary,
//  broker/desk flatness, worker liveness, and the effective armed-channel book.
//
//  Run: npm run preopen
//
//  This script never places an order and never writes Supabase. It deliberately
//  prints no API keys, account numbers, UUIDs, or broker account identifiers.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { DAY1_CONFIG_HASH, DAY1_RELEASE_ID, DAY1_ROOTS, DAY1_WORKER_VERSION } from "@/lib/channels/day1Release";
import { findDay1ReleaseReceipt } from "@/lib/ops/releaseReceipt";
import type { MarketEvent } from "@/lib/types";

const REQUIRED_PAPER_HOST = "https://paper-api.alpaca.markets";
const WORKER_FRESH_SEC = 150;

type AccountRow = {
  id: string;
  name: string;
  cred_ref: string | null;
  is_armed: boolean;
  is_halted: boolean;
  master_daily_stop_usd: number | string | null;
};

type ConfigRow = {
  max_contracts: number | string | null;
  capital_pct: number | string | null;
  daily_stop_usd: number | string | null;
  daily_target_usd: number | string | null;
  premium_stop_pct: number | string | null;
  take_profit_pct: number | string | null;
  underlying_stop_pct: number | string | null;
  entry_dte: number | string | null;
  strike_offset: number | string | null;
  muted: boolean | null;
  boosted: boolean | null;
  event_policy: string | null;
};

type ChannelRow = {
  id: string;
  slug: string;
  status: string;
  underlying: string | null;
  executor: string | null;
  account_id: string | null;
  is_active: boolean | null;
  strategist_config: ConfigRow | ConfigRow[] | null;
};

type PositionRow = {
  strategist_id: string;
  occ_symbol: string;
  qty: number | string;
};

type WorkerRow = {
  version: string | null;
  git_sha: string | null;
  last_heartbeat_at: string | null;
  last_phase: string | null;
  ended_at: string | null;
  last_error: string | null;
};

type BrokerPosition = { symbol?: string; qty?: string | number };

const num = (value: unknown): number => Number(value ?? 0);
const usd = (value: number): string => `$${Math.round(value).toLocaleString()}`;
const pad = (value: string, width: number): string => (value + " ".repeat(width)).slice(0, width);
const padL = (value: string, width: number): string => (" ".repeat(width) + value).slice(-width);

function configOf(channel: ChannelRow): ConfigRow | null {
  if (Array.isArray(channel.strategist_config)) return channel.strategist_config[0] ?? null;
  return channel.strategist_config;
}

function envCreds(ref: string | null): { key: string; secret: string } | null {
  const suffix = ref ? `_${ref}` : "";
  const key = process.env[`ALPACA_KEY${suffix}`];
  const secret = process.env[`ALPACA_SECRET${suffix}`];
  return key && secret ? { key, secret } : null;
}

async function brokerRead(path: string, creds: { key: string; secret: string }): Promise<Response> {
  return fetch(`${REQUIRED_PAPER_HOST}${path}`, {
    headers: {
      "APCA-API-KEY-ID": creds.key,
      "APCA-API-SECRET-KEY": creds.secret,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
}

function aggregateDeskPositions(
  positions: PositionRow[],
  channelsById: Map<string, ChannelRow>,
  accountId: string,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const position of positions) {
    if (channelsById.get(position.strategist_id)?.account_id !== accountId) continue;
    result.set(position.occ_symbol, (result.get(position.occ_symbol) ?? 0) + num(position.qty));
  }
  return result;
}

function aggregateBrokerPositions(positions: BrokerPosition[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const position of positions) {
    const symbol = String(position.symbol ?? "");
    if (!symbol) continue;
    result.set(symbol, (result.get(symbol) ?? 0) + num(position.qty));
  }
  return result;
}

function sameBook(a: Map<string, number>, b: Map<string, number>): boolean {
  const symbols = new Set([...a.keys(), ...b.keys()]);
  return [...symbols].every((symbol) => Math.abs((a.get(symbol) ?? 0) - (b.get(symbol) ?? 0)) < 0.001);
}

async function main(): Promise<void> {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const configuredHost = process.env.ALPACA_PAPER_HOST ?? REQUIRED_PAPER_HOST;
  const failures: string[] = [];
  const warnings: string[] = [];
  if (configuredHost !== REQUIRED_PAPER_HOST) failures.push(`ALPACA_PAPER_HOST is ${configuredHost}; expected ${REQUIRED_PAPER_HOST}`);

  const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [fundRead, accountsRead, channelsRead, positionsRead, workerRead, releaseRead] = await Promise.all([
    sb.from("fund_state").select("mode,is_halted,halted_reason").eq("id", 1).maybeSingle(),
    sb.from("accounts").select("id,name,cred_ref,is_armed,is_halted,master_daily_stop_usd").order("name"),
    sb.from("strategists").select("id,slug,status,underlying,executor,account_id,is_active,strategist_config(max_contracts,capital_pct,daily_stop_usd,daily_target_usd,premium_stop_pct,take_profit_pct,underlying_stop_pct,entry_dte,strike_offset,muted,boosted,event_policy)").order("slug"),
    sb.from("positions").select("strategist_id,occ_symbol,qty").eq("status", "open"),
    sb.from("worker_runs").select("version,git_sha,last_heartbeat_at,last_phase,ended_at,last_error").is("ended_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("events").select("id,level,message,created_at,strategist_id,meta").ilike("message", "%day1-release ACTIVE%").order("created_at", { ascending: false }).limit(1),
  ]);

  for (const [label, error] of [
    ["fund_state", fundRead.error], ["accounts", accountsRead.error], ["strategists", channelsRead.error],
    ["positions", positionsRead.error], ["worker_runs", workerRead.error], ["release receipt", releaseRead.error],
  ] as const) if (error) failures.push(`${label} read failed: ${error.message}`);

  const fund = fundRead.data as { mode?: string; is_halted?: boolean; halted_reason?: string | null } | null;
  if (!fund) failures.push("fund_state row missing");
  else {
    if (fund.mode !== "paper") failures.push(`fund mode is ${fund.mode ?? "missing"}, not paper`);
    if (fund.is_halted) warnings.push(`fund is intentionally HALTED${fund.halted_reason ? `: ${fund.halted_reason}` : ""}`);
  }

  const worker = workerRead.data as WorkerRow | null;
  let workerAgeSec = Infinity;
  if (!worker?.last_heartbeat_at) failures.push("no open worker run with a heartbeat");
  else {
    workerAgeSec = Math.max(0, (Date.now() - Date.parse(worker.last_heartbeat_at)) / 1000);
    if (workerAgeSec > WORKER_FRESH_SEC) failures.push(`worker heartbeat is ${Math.round(workerAgeSec)}s old`);
    if (worker.last_error) failures.push(`worker reports an error: ${worker.last_error}`);
    if (worker.version !== DAY1_WORKER_VERSION) failures.push(`worker version is ${worker.version ?? "missing"}; expected ${DAY1_WORKER_VERSION}`);
  }

  const release = findDay1ReleaseReceipt((releaseRead.data ?? []) as MarketEvent[]);
  if (!release) failures.push("no Day 1 startup receipt observed");
  else {
    if (release.releaseId !== DAY1_RELEASE_ID) failures.push(`release id is ${release.releaseId}; expected ${DAY1_RELEASE_ID}`);
    if (release.configHash !== DAY1_CONFIG_HASH) failures.push(`release hash is ${release.configHash}; expected ${DAY1_CONFIG_HASH}`);
  }

  const accounts = (accountsRead.data ?? []) as AccountRow[];
  const allChannels = (channelsRead.data ?? []) as ChannelRow[];
  const channels = allChannels.filter((channel) => channel.status === "armed" && channel.is_active === true);
  const positions = (positionsRead.data ?? []) as PositionRow[];
  const channelsById = new Map(allChannels.map((channel) => [channel.id, channel]));
  const channelsBySlug = new Map(allChannels.map((channel) => [channel.slug, channel]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const identities = new Set<string>();

  console.log("\n══ SEVE PRE-OPEN READINESS · READ ONLY ══");
  console.log(`Broker host : ${configuredHost} ${configuredHost === REQUIRED_PAPER_HOST ? "✓ PAPER" : "✗"}`);
  console.log(`Fund        : ${fund?.mode ?? "missing"} · halted=${fund?.is_halted ? "TRUE" : "false"}`);
  console.log(`Worker      : ${worker?.version ?? "missing"} · ${Math.round(workerAgeSec)}s · ${worker?.last_phase ?? "?"} · ${worker?.last_error ? "ERROR" : "clean"}`);
  console.log(`Release     : ${release?.releaseId ?? "missing"} · ${release?.configHash.slice(0, 12) ?? "—"}${release ? "…" : ""}`);
  console.log(`Desk rows   : ${positions.length} open\n`);

  console.log("Paper broker accounts:");
  for (const account of accounts) {
    const creds = envCreds(account.cred_ref);
    if (!creds) {
      failures.push(`${account.name}: credentials missing for cred_ref ${account.cred_ref ?? "default"}`);
      console.log(`  ✗ ${pad(account.name, 12)} credentials missing`);
      continue;
    }
    try {
      const [accountResponse, positionsResponse] = await Promise.all([
        brokerRead("/v2/account", creds), brokerRead("/v2/positions", creds),
      ]);
      const brokerAccount = await accountResponse.json() as Record<string, unknown>;
      const brokerPositions = positionsResponse.ok ? await positionsResponse.json() as BrokerPosition[] : [];
      const identity = String(brokerAccount.id ?? brokerAccount.account_number ?? "");
      const unique = !!identity && !identities.has(identity);
      if (identity) identities.add(identity);
      const active = accountResponse.ok && brokerAccount.status === "ACTIVE";
      const unblocked = brokerAccount.account_blocked === false && brokerAccount.trading_blocked === false;
      const deskBook = aggregateDeskPositions(positions, channelsById, account.id);
      const brokerBook = aggregateBrokerPositions(brokerPositions);
      const booksMatch = positionsResponse.ok && sameBook(deskBook, brokerBook);
      if (!active) failures.push(`${account.name}: paper broker account is not ACTIVE`);
      if (!unblocked) failures.push(`${account.name}: paper broker account is blocked`);
      if (!unique) failures.push(`${account.name}: broker identity missing or duplicates another account`);
      if (!booksMatch) failures.push(`${account.name}: desk open lots do not match paper broker positions`);
      if (!account.is_armed || account.is_halted) warnings.push(`${account.name}: entries are ${account.is_halted ? "HALTED" : "DISARMED"}`);
      console.log(`  ${active && unblocked && unique && booksMatch ? "✓" : "✗"} ${pad(account.name, 12)} ACTIVE · distinct · broker ${brokerBook.size} / desk ${deskBook.size} OCCs${account.is_armed && !account.is_halted ? "" : " · entries off"}`);
    } catch (error) {
      failures.push(`${account.name}: paper broker read failed: ${(error as Error).message}`);
      console.log(`  ✗ ${pad(account.name, 12)} unreachable`);
    }
  }

  console.log("\nSealed RC5 runtime roots:");
  console.log(`  ${pad("CHANNEL", 28)} ${pad("ACCOUNT", 12)} ${pad("SYM", 4)} ${padL("QTY", 4)} ${padL("RISK", 7)} ${padL("PREM≤", 7)} ${padL("DEBIT≤", 8)} ${padL("STOP", 7)} ${padL("TAKE", 7)} ${pad("EOD", 6)} ${pad("DB", 7)}`);

  let readyRoots = 0;
  const rootPolicies = Object.values(DAY1_ROOTS).sort((a, b) => a.accountName.localeCompare(b.accountName) || a.priority - b.priority || a.slug.localeCompare(b.slug));
  for (const root of rootPolicies) {
    const channel = channelsBySlug.get(root.slug);
    const account = accountById.get(root.accountId);
    const cfg = channel ? configOf(channel) : null;
    const dbState = !channel
      ? "MISSING"
      : channel.status !== "armed" || channel.is_active !== true
        ? "OFF"
        : cfg?.muted
          ? "MUTED"
          : account?.is_armed && !account?.is_halted
            ? "READY"
            : "OFF";

    if (!channel) failures.push(`${root.slug}: sealed root is missing from armed/active database rows`);
    else {
      if (channel.status !== "armed" || channel.is_active !== true) failures.push(`${root.slug}: sealed root is not armed and active in the database`);
      if (channel.account_id !== root.accountId) failures.push(`${root.slug}: database account does not match the sealed root binding`);
      if (channel.executor !== "stream") failures.push(`${root.slug}: executor is ${channel.executor ?? "missing"}, expected stream`);
      if (channel.underlying !== root.underlying) failures.push(`${root.slug}: underlying is ${channel.underlying ?? "missing"}, expected ${root.underlying}`);
      if (cfg?.muted) failures.push(`${root.slug}: sealed root is database-muted`);
      if (num(cfg?.max_contracts) < root.quantity) failures.push(`${root.slug}: database max_contracts ${num(cfg?.max_contracts)} is below sealed quantity ${root.quantity}`);
    }
    if (!account) failures.push(`${root.slug}: sealed account binding does not resolve`);
    if (dbState === "READY") readyRoots++;

    console.log(`  ${pad(root.slug, 28)} ${pad(root.accountName, 12)} ${pad(root.underlying, 4)} ${padL(String(root.quantity), 4)} ${padL(usd(root.riskBudgetUsd), 7)} ${padL(`$${root.premiumCap.toFixed(2)}`, 7)} ${padL(usd(root.aggregateDebitCap), 8)} ${padL(`-${root.premiumStopPct}%`, 7)} ${padL(root.takeProfitPct ? `+${root.takeProfitPct}%` : "RIDE", 7)} ${pad(root.eodEt, 6)} ${pad(dbState, 7)}`);
  }

  const darkDatabaseRows = channels.filter((channel) => !DAY1_ROOTS[channel.slug]).length;
  console.log(`\nRuntime     : ${readyRoots}/${rootPolicies.length} sealed roots ready · ${darkDatabaseRows} other armed/active DB rows suppressed to dark evidence by RC5`);
  console.log("DB settings : context only where RC5 overlays policy; the startup receipt + worker version identify the active runtime contract");
  console.log("Account stop: legacy display only; sealed per-channel risk governs the Day 1 roots above");
  if (warnings.length) console.log(`\nWarnings (${warnings.length}):\n  - ${warnings.join("\n  - ")}`);
  if (failures.length) {
    console.error(`\n✗ PRE-OPEN BLOCKED (${failures.length}):\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✓ PRE-OPEN HARD GATES PASS — paper boundary, broker/desk books, worker liveness, sealed RC5 identity, and six-root routing\n");
}

main().catch((error) => {
  console.error(`preopen failed: ${(error as Error).message}`);
  process.exit(1);
});
