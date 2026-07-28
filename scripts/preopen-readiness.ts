// ============================================================================
// Release-agnostic pre-open operational-congruence gate.
//
// This command is SELECT/GET only. It does not judge or authorize configuration
// changes, create control-plane records, write evidence, or place orders.
// The temporary RC5.4 adapter describes the currently active sealed worker
// overlay. Draft control-plane manifests are intentionally not runtime authority.
// ============================================================================

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { MarketEvent } from "@/lib/types";
import {
  evaluatePreopenReadiness,
  type PaperAccountObservation,
  type WorkerObservation,
} from "@/lib/ops/preopenReadinessEngine";
import {
  mapRc54ChannelRow,
  observeRc54ReleaseReceipt,
  observeRc54Bindings,
  rc54OperationalContract,
} from "@/lib/ops/rc54ReadinessAdapter";
import type { AccountRow, ChannelConfig } from "@/worker/src/store";
import { createServerSupabaseClient } from "./serverSupabase";

const WORKER_FRESH_MS = 150_000;
const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

const envFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
if (envFile) {
  const path = resolve(envFile);
  if (!existsSync(path)) throw new Error(`environment file not found: ${path}`);
  process.loadEnvFile(path);
} else if (existsSync(resolve(".env.local"))) {
  process.loadEnvFile(resolve(".env.local"));
}

type FundRow = {
  mode: string | null;
  is_halted: boolean | null;
};

type PositionRow = {
  strategist_id: string;
  occ_symbol: string;
  qty: number | string;
};

type WorkerRow = {
  version: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  last_phase: string | null;
  ended_at: string | null;
  last_error: string | null;
};

type BrokerPosition = {
  symbol?: string;
  qty?: string | number;
};

type BrokerOrder = {
  id?: string;
};

function envCredentials(ref: string | null): { key: string; secret: string } | null {
  const suffix = ref ? `_${ref}` : "";
  const key = process.env[`ALPACA_KEY${suffix}`];
  const secret = process.env[`ALPACA_SECRET${suffix}`];
  return key && secret ? { key, secret } : null;
}

async function brokerGet(
  origin: string,
  path: string,
  credentials: { key: string; secret: string },
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    headers: {
      "APCA-API-KEY-ID": credentials.key,
      "APCA-API-SECRET-KEY": credentials.secret,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
}

function aggregatePositions(rows: readonly { symbol: string; qty: number }[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    if (!row.symbol || !Number.isFinite(row.qty)) continue;
    result.set(row.symbol, (result.get(row.symbol) ?? 0) + row.qty);
  }
  for (const [symbol, quantity] of result) {
    if (Math.abs(quantity) < 0.001) result.delete(symbol);
  }
  return result;
}

function sameBook(left: Map<string, number>, right: Map<string, number>): boolean {
  const symbols = new Set([...left.keys(), ...right.keys()]);
  return [...symbols].every((symbol) =>
    Math.abs((left.get(symbol) ?? 0) - (right.get(symbol) ?? 0)) < 0.001);
}

async function observePaperAccount(input: {
  account: AccountRow;
  deskPositions: PositionRow[];
  channelsById: Map<string, ChannelConfig>;
  brokerOrigin: string;
}): Promise<PaperAccountObservation> {
  const { account, deskPositions, channelsById, brokerOrigin } = input;
  const accountDeskPositions = deskPositions
    .filter((position) => channelsById.get(position.strategist_id)?.account_id === account.id);
  const deskBook = aggregatePositions(accountDeskPositions
    .map((position) => ({ symbol: position.occ_symbol, qty: Number(position.qty) })));
  const credentials = envCredentials(account.cred_ref);
  const base = {
    accountId: account.id,
    name: account.name,
    mode: account.mode,
    configuredArmed: account.is_armed,
    configuredHalted: account.is_halted,
    credentialsPresent: credentials != null,
    deskPositionCount: accountDeskPositions
      .filter((position) => Math.abs(Number(position.qty)) >= 0.001).length,
  };
  if (!credentials) {
    return {
      ...base,
      brokerReachable: false,
      brokerActive: false,
      brokerUnblocked: false,
      brokerIdentity: null,
      positionsKnown: false,
      ordersKnown: false,
      openOrderCount: null,
      brokerPositionCount: null,
      booksMatch: false,
    };
  }

  try {
    const [accountResponse, positionsResponse, ordersResponse] = await Promise.all([
      brokerGet(brokerOrigin, "/v2/account", credentials),
      brokerGet(brokerOrigin, "/v2/positions", credentials),
      brokerGet(brokerOrigin, "/v2/orders?status=open&limit=500&direction=asc&nested=false", credentials),
    ]);
    const brokerAccount = accountResponse.ok
      ? await accountResponse.json() as Record<string, unknown>
      : null;
    const brokerPositions = positionsResponse.ok
      ? await positionsResponse.json() as BrokerPosition[]
      : null;
    const openOrders = ordersResponse.ok
      ? await ordersResponse.json() as BrokerOrder[]
      : null;
    const positionsKnown = Array.isArray(brokerPositions);
    const ordersKnown = Array.isArray(openOrders);
    const brokerBook = positionsKnown
      ? aggregatePositions(brokerPositions.map((position) => ({
          symbol: String(position.symbol ?? ""),
          qty: Number(position.qty ?? 0),
        })))
      : new Map<string, number>();
    return {
      ...base,
      brokerReachable: accountResponse.ok,
      brokerActive: brokerAccount?.status === "ACTIVE",
      brokerUnblocked: brokerAccount?.account_blocked === false
        && brokerAccount?.trading_blocked === false,
      brokerIdentity: brokerAccount
        ? String(brokerAccount.id ?? brokerAccount.account_number ?? "") || null
        : null,
      positionsKnown,
      ordersKnown,
      openOrderCount: ordersKnown ? openOrders.length : null,
      brokerPositionCount: positionsKnown ? brokerBook.size : null,
      booksMatch: positionsKnown && sameBook(deskBook, brokerBook),
    };
  } catch {
    return {
      ...base,
      brokerReachable: false,
      brokerActive: false,
      brokerUnblocked: false,
      brokerIdentity: null,
      positionsKnown: false,
      ordersKnown: false,
      openOrderCount: null,
      brokerPositionCount: null,
      booksMatch: false,
    };
  }
}

async function main(): Promise<void> {
  const closeMode = process.argv.includes("--require-flat");
  const sb = createServerSupabaseClient("preopen-readiness");
  const [
    fundRead,
    accountRead,
    strategistRead,
    positionsRead,
    workerRead,
    releaseRead,
  ] = await Promise.all([
    sb.from("fund_state").select("mode,is_halted").eq("id", 1).maybeSingle(),
    sb.from("accounts")
      .select("id,name,mode,cred_ref,is_armed,is_halted,master_daily_stop_usd")
      .order("name"),
    sb.from("strategists")
      .select("id,slug,name,status,spec_json,underlying,executor,account_id,is_active,strategist_config(*)")
      .order("slug"),
    sb.from("positions").select("strategist_id,occ_symbol,qty").eq("status", "open"),
    sb.from("worker_runs")
      .select("version,started_at,last_heartbeat_at,last_phase,ended_at,last_error")
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(20),
    sb.from("events")
      .select("id,level,message,created_at,strategist_id,meta")
      .ilike("message", "%release ACTIVE%")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  for (const [label, error] of [
    ["fund_state", fundRead.error],
    ["accounts", accountRead.error],
    ["strategists", strategistRead.error],
    ["positions", positionsRead.error],
    ["worker_runs", workerRead.error],
    ["release events", releaseRead.error],
  ] as const) {
    if (error) throw new Error(`${label} SELECT failed: ${error.message}`);
  }

  const allAccounts = (accountRead.data ?? []) as AccountRow[];
  const configuredPaperAccounts = allAccounts.filter((account) =>
    account.mode.toLowerCase() === "paper");
  const fleet = (strategistRead.data ?? []).map((row) =>
    mapRc54ChannelRow(row as Record<string, unknown>));
  const bindings = observeRc54Bindings(fleet, allAccounts);
  const contract = rc54OperationalContract(bindings.roots);
  const channelsById = new Map(fleet.map((channel) => [channel.id, channel]));
  const deskPositions = (positionsRead.data ?? []) as PositionRow[];
  const configuredPaperAccountIds = new Set(configuredPaperAccounts.map((account) => account.id));
  const unattributedDeskPositionCount = deskPositions.filter((position) => {
    const accountId = channelsById.get(position.strategist_id)?.account_id;
    return !accountId || !configuredPaperAccountIds.has(accountId);
  }).length;
  const accountObservations = await Promise.all(configuredPaperAccounts.map((account) =>
    observePaperAccount({
      account,
      deskPositions,
      channelsById,
      brokerOrigin: contract.paperOrigin,
    })));
  const workers: WorkerObservation[] = ((workerRead.data ?? []) as WorkerRow[]).map((worker) => ({
    runtimeVersion: worker.version,
    startedAt: worker.started_at,
    heartbeatAt: worker.last_heartbeat_at,
    lastPhase: worker.last_phase,
    lastError: worker.last_error,
  }));
  const receipt = observeRc54ReleaseReceipt((releaseRead.data ?? []) as MarketEvent[]);
  const fund = fundRead.data as FundRow | null;
  const result = evaluatePreopenReadiness({
    nowMs: Date.now(),
    workerFreshMs: WORKER_FRESH_MS,
    fund: { mode: fund?.mode ?? null, halted: fund?.is_halted ?? null },
    contract,
    bindingIssues: bindings.issues,
    workers,
    receipt,
    configuredPaperAccounts: accountObservations,
    unattributedDeskPositionCount,
  });

  console.log(`\n══ SEVE ${closeMode ? "SESSION-CLOSE" : "PRE-OPEN"} OPERATIONAL CONGRUENCE · READ ONLY ══`);
  console.log(`Adapter     : ${contract.adapterId}`);
  console.log(`Authority   : sealed runtime overlay · draft control-plane manifest excluded`);
  console.log(`Release     : ${contract.releaseId}`);
  console.log(`Config      : ${contract.configurationSha256}`);
  console.log(`Fleet       : ${bindings.fleetCount} database rows · ${contract.roots.length} sealed roots`);
  console.log(`Accounts    : ${accountObservations.length} configured paper account(s) queried`);
  console.log(`Worker      : ${result.currentWorker?.runtimeVersion ?? "missing"} · ${result.currentWorker?.lastPhase ?? "unknown"}\n`);

  for (const item of result.checks) {
    const mark = item.state === "pass" ? "✓" : item.state === "warn" ? "!" : "✗";
    console.log(`  ${mark} ${item.id} — ${item.fact}`);
  }

  if (result.warnings.length) {
    console.log(`\nWarnings (${result.warnings.length}) require explanation but are not hidden.`);
  }
  if (!result.ready) {
    console.error(`\n✗ NO NEW ENTRIES — ${result.blockers.length} operational congruence blocker(s).\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✓ AUTOMATED OPERATIONAL CONGRUENCE PASS");
  console.log("  This is not configuration approval, activation authority, or order authority.");
  console.log("  Operator must still confirm the signed-in Operations panel agrees before the session.\n");
}

void main().catch((cause) => {
  console.error(`preopen failed closed: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
