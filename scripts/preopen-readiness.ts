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

const REQUIRED_PAPER_HOST = "https://paper-api.alpaca.markets";
const WORKER_FRESH_SEC = 150;
const DEFAULT_PREMIUM_STOP_PCT = 50;
const MIN_SCALABLE_QTY = 2;

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
  const [fundRead, accountsRead, channelsRead, positionsRead, workerRead] = await Promise.all([
    sb.from("fund_state").select("mode,is_halted,halted_reason").eq("id", 1).maybeSingle(),
    sb.from("accounts").select("id,name,cred_ref,is_armed,is_halted,master_daily_stop_usd").order("name"),
    sb.from("strategists").select("id,slug,status,underlying,executor,account_id,is_active,strategist_config(max_contracts,capital_pct,daily_stop_usd,daily_target_usd,premium_stop_pct,take_profit_pct,underlying_stop_pct,entry_dte,strike_offset,muted,boosted,event_policy)").eq("status", "armed").eq("is_active", true).order("slug"),
    sb.from("positions").select("strategist_id,occ_symbol,qty").eq("status", "open"),
    sb.from("worker_runs").select("version,git_sha,last_heartbeat_at,last_phase,ended_at,last_error").is("ended_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  for (const [label, error] of [
    ["fund_state", fundRead.error], ["accounts", accountsRead.error], ["strategists", channelsRead.error],
    ["positions", positionsRead.error], ["worker_runs", workerRead.error],
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
  }

  const accounts = (accountsRead.data ?? []) as AccountRow[];
  const channels = (channelsRead.data ?? []) as ChannelRow[];
  const positions = (positionsRead.data ?? []) as PositionRow[];
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const identities = new Set<string>();

  console.log("\n══ SEVE PRE-OPEN READINESS · READ ONLY ══");
  console.log(`Broker host : ${configuredHost} ${configuredHost === REQUIRED_PAPER_HOST ? "✓ PAPER" : "✗"}`);
  console.log(`Fund        : ${fund?.mode ?? "missing"} · halted=${fund?.is_halted ? "TRUE" : "false"}`);
  console.log(`Worker      : ${worker?.version ?? "missing"} · ${Math.round(workerAgeSec)}s · ${worker?.last_phase ?? "?"} · ${worker?.last_error ? "ERROR" : "clean"}`);
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

  console.log("\nEffective armed-channel manifest:");
  console.log(`  ${pad("CHANNEL", 28)} ${pad("ACCOUNT", 12)} ${pad("SYM", 4)} ${padL("RISK", 7)} ${padL("CAP", 4)} ${padL("2-LOT ASK≤", 11)} ${padL("STOP", 7)} ${padL("TAKE", 7)} ${pad("STATE", 8)}`);

  let effective = 0;
  let muted = 0;
  for (const channel of channels.sort((a, b) => {
    const aa = accountById.get(a.account_id ?? "")?.name ?? "unresolved";
    const ba = accountById.get(b.account_id ?? "")?.name ?? "unresolved";
    return aa.localeCompare(ba) || a.slug.localeCompare(b.slug);
  })) {
    const cfg = configOf(channel);
    const account = accountById.get(channel.account_id ?? "");
    const maxContracts = num(cfg?.max_contracts);
    const risk = num(cfg?.capital_pct) * (cfg?.boosted ? 2 : 1);
    const rawStop = cfg?.premium_stop_pct == null ? DEFAULT_PREMIUM_STOP_PCT : num(cfg.premium_stop_pct);
    const stopPct = rawStop > 0 ? rawStop : DEFAULT_PREMIUM_STOP_PCT;
    const scalableAsk = risk / ((stopPct / 100) * 100 * MIN_SCALABLE_QTY);
    const state = cfg?.muted ? "MUTED" : account?.is_armed && !account?.is_halted ? "READY" : "OFF";
    if (cfg?.muted) muted++; else effective++;

    if (!account) failures.push(`${channel.slug}: account_id does not resolve`);
    if (channel.executor !== "stream") failures.push(`${channel.slug}: executor is ${channel.executor ?? "missing"}, expected stream`);
    if (maxContracts < MIN_SCALABLE_QTY) failures.push(`${channel.slug}: max_contracts ${maxContracts} cannot support a multi-contract scale-out`);
    if (scalableAsk < 1) warnings.push(`${channel.slug}: two-lot scaling requires ask <= $${scalableAsk.toFixed(2)}`);

    const stop = rawStop > 0 ? `-${rawStop}%` : "U-STOP";
    const take = num(cfg?.take_profit_pct) > 0 ? `+${num(cfg?.take_profit_pct)}%` : "RIDE";
    console.log(`  ${pad(channel.slug, 28)} ${pad(account?.name ?? "UNRESOLVED", 12)} ${pad(String(channel.underlying ?? "?"), 4)} ${padL(usd(risk), 7)} ${padL(String(maxContracts), 4)} ${padL(`$${scalableAsk.toFixed(2)}`, 11)} ${padL(stop, 7)} ${padL(take, 7)} ${pad(state, 8)}`);
  }

  console.log(`\nChannels    : ${channels.length} armed/active configs · ${effective} entry-enabled · ${muted} muted`);
  console.log("Account stop: legacy display only; live entry risk is governed per channel by the manifest above");
  if (warnings.length) console.log(`\nWarnings (${warnings.length}):\n  - ${warnings.join("\n  - ")}`);
  if (failures.length) {
    console.error(`\n✗ PRE-OPEN BLOCKED (${failures.length}):\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✓ PRE-OPEN HARD GATES PASS — paper boundary, broker/desk books, worker, routing, and multi-contract caps\n");
}

main().catch((error) => {
  console.error(`preopen failed: ${(error as Error).message}`);
  process.exit(1);
});
