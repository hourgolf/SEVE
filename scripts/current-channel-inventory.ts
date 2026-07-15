// Read-only current fleet → cartridge inventory. Supabase calls are SELECT-only;
// the sole write is a gitignored local JSON receipt.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { STRATEGY_REGISTRY } from "../engine/registry.js";
import {
  buildCurrentFleetInventory,
  type CurrentChannelConfigSnapshot,
  type CurrentChannelSnapshot,
} from "../lib/strategy/currentChannelInventory.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const todayEt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const OUT = arg("out", `data/channel-cartridge-inventories/${todayEt}.json`);

async function page<T>(
  read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1_000) return rows;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

function registryBundleHash(): string {
  const files = ["engine/registry.ts", ...readdirSync("engine/strategies")
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => join("engine/strategies", file))];
  const hash = createHash("sha256");
  for (const file of files) hash.update(file).update("\0").update(readFileSync(file)).update("\0");
  return hash.digest("hex");
}

const numeric = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

interface StrategistRow {
  id: string;
  slug: string;
  name: string;
  mandate: string;
  underlying: string | null;
  executor: string | null;
  status: string | null;
  is_active: boolean;
  account_id: string | null;
  spec_json: unknown;
}
interface AccountRow { id: string; name: string; mode: string; }
interface ConfigRow {
  strategist_id: string;
  capital_pct: unknown;
  max_contracts: unknown;
  daily_stop_usd: unknown;
  underlying_stop_pct: unknown;
  premium_stop_pct: unknown;
  take_profit_pct: unknown;
  entry_dte: unknown;
  strike_offset: unknown;
  event_policy: string | null;
  pyramid_adds: unknown;
  stall_minutes: unknown;
  stall_max_favor_pct: unknown;
  daily_target_usd: unknown;
  muted: boolean | null;
  boosted: boolean | null;
}
interface PolicyEpochRow {
  id: string;
  strategist_id: string;
  channel_version: string;
  manager_id: string;
  manager_version: string;
  mode: string;
  created_at: string;
  retired_at: string | null;
}
interface WorkerRunRow {
  version: string;
  git_sha: string;
  last_heartbeat_at: string;
  ended_at: string | null;
}

function mapConfig(row: ConfigRow | undefined): CurrentChannelConfigSnapshot | null {
  if (!row) return null;
  const configuredPremium = numeric(row.premium_stop_pct);
  return {
    riskPerTradeUsd: numeric(row.capital_pct),
    maxContracts: numeric(row.max_contracts),
    dailyEntryLatchUsd: numeric(row.daily_stop_usd),
    underlyingStopPct: numeric(row.underlying_stop_pct),
    premiumStopPct: configuredPremium && configuredPremium > 0 ? configuredPremium : 50,
    premiumStopUsesRuntimeDefault: !(configuredPremium && configuredPremium > 0),
    takeProfitPct: numeric(row.take_profit_pct),
    entryDte: numeric(row.entry_dte),
    strikeOffset: numeric(row.strike_offset),
    eventPolicy: row.event_policy,
    pyramidAdds: numeric(row.pyramid_adds),
    stallMinutes: numeric(row.stall_minutes),
    stallMaxFavorablePct: numeric(row.stall_max_favor_pct),
    dailyTargetUsd: numeric(row.daily_target_usd),
    muted: row.muted,
    boosted: row.boosted,
  };
}

async function readSnapshots(sb: SupabaseClient): Promise<{ snapshots: CurrentChannelSnapshot[]; sourceRows: Record<string, number> }> {
  const [strategists, accounts, configs, policyEpochs, workerRuns] = await Promise.all([
    page<StrategistRow>((from, to) => sb.from("strategists")
      .select("id,slug,name,mandate,underlying,executor,status,is_active,account_id,spec_json")
      .order("slug").order("id").range(from, to), "strategists"),
    page<AccountRow>((from, to) => sb.from("accounts").select("id,name,mode").order("id").range(from, to), "accounts"),
    page<ConfigRow>((from, to) => sb.from("strategist_config")
      .select("strategist_id,capital_pct,max_contracts,daily_stop_usd,underlying_stop_pct,premium_stop_pct,take_profit_pct,entry_dte,strike_offset,event_policy,pyramid_adds,stall_minutes,stall_max_favor_pct,daily_target_usd,muted,boosted")
      .order("strategist_id").range(from, to), "strategist_config"),
    page<PolicyEpochRow>((from, to) => sb.from("policy_epochs")
      .select("id,strategist_id,channel_version,manager_id,manager_version,mode,created_at,retired_at")
      .order("created_at", { ascending: false }).order("id").range(from, to), "policy_epochs"),
    page<WorkerRunRow>((from, to) => sb.from("worker_runs")
      .select("version,git_sha,last_heartbeat_at,ended_at")
      .order("last_heartbeat_at", { ascending: false }).range(from, to), "worker_runs"),
  ]);
  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const configByStrategist = new Map(configs.map((row) => [row.strategist_id, row]));
  const latestPolicy = new Map<string, PolicyEpochRow>();
  for (const row of policyEpochs) if (!latestPolicy.has(row.strategist_id) && !row.retired_at) latestPolicy.set(row.strategist_id, row);
  const registryHash = registryBundleHash();
  const registrySlugs = new Set(Object.keys(STRATEGY_REGISTRY));
  const currentWorker = workerRuns.find((run) => !run.ended_at && !!run.version && /^[a-f0-9]{7,40}$/i.test(run.git_sha));
  const snapshots = strategists.map((row): CurrentChannelSnapshot => {
    const account = row.account_id ? accountById.get(row.account_id) : null;
    const policy = latestPolicy.get(row.id);
    const hasSpec = !!row.spec_json && typeof row.spec_json === "object" && Object.keys(row.spec_json as Record<string, unknown>).length > 0;
    const strategySource = hasSpec
      ? { kind: "compiled_spec" as const, ref: `strategists/${row.id}/spec_json`, contentHash: sha256(canonical(row.spec_json)) }
      : registrySlugs.has(row.slug)
        ? { kind: "registry" as const, ref: `engine/registry:${row.slug}`, contentHash: registryHash }
        : null;
    return {
      strategistId: row.id,
      slug: row.slug,
      name: row.name,
      mandate: row.mandate,
      underlying: row.underlying,
      executor: row.executor,
      status: row.status,
      isActive: row.is_active,
      accountId: row.account_id,
      accountName: account?.name ?? null,
      accountMode: account?.mode ?? null,
      strategySource,
      runtimeStamp: row.executor === "stream" && currentWorker
        ? { workerVersion: currentWorker.version, sourceCommit: currentWorker.git_sha }
        : null,
      policyStamp: policy ? {
        policyEpochId: policy.id,
        channelVersion: policy.channel_version,
        managerId: policy.manager_id,
        managerVersion: policy.manager_version,
        mode: policy.mode,
      } : null,
      // Stream admission is visibly completed-1m-bar based today, but the
      // tolerated provider→decision lag is not a sealed per-policy value.
      decisionClock: row.executor === "stream" && row.underlying ? {
        id: `${row.underlying}:stock-feed:1m-complete`, mode: "bar_close", cadenceMs: 60_000, maxDecisionLagMs: null,
      } : null,
      // Railway feed settings are deployment variables, not durable per-channel
      // policy receipts. Do not infer production SIP/OPRA from this local process.
      marketInputs: null,
      declaredCollisionFamily: null,
      maxOpenPositions: null,
      maxConcurrentInCollisionFamily: null,
      harvestPolicyVersion: policy ? `${policy.manager_id}@${policy.manager_version}` : null,
      harvestMinimumQuantity: null,
      eodMinutesBeforeClose: null,
      config: mapConfig(configByStrategist.get(row.id)),
    };
  });
  return { snapshots, sourceRows: { strategists: strategists.length, accounts: accounts.length, configs: configs.length, policyEpochs: policyEpochs.length, workerRuns: workerRuns.length } };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { snapshots, sourceRows } = await readSnapshots(sb);
  const inventory = buildCurrentFleetInventory(snapshots);
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "read_only_supabase_current_channel_inventory",
    sourceRows,
    inventory,
    caveats: [
      "This receipt does not mutate Supabase, runtime configuration, policy, sizing, or orders.",
      "Registry source hashing covers the current registry + strategy source bundle; compiled specs hash canonical spec_json.",
      "Railway feed variables, decision-lag bounds, collision policy, and session-relative EOD are reported missing unless durably stamped; local environment values are not treated as production truth.",
      "Current runtime defaults are observations, not immutable cartridge policy.",
      "No inventory result authorizes promotion or a paper-runtime change.",
    ],
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`current-channel-inventory: ${inventory.summary.channels} channels · ${inventory.summary.cartridgeReady} cartridge-ready`);
  for (const row of inventory.summary.blockerCounts.slice(0, 12)) console.log(`  ${row.code}: ${row.channels}`);
  console.log(`  receipt: ${OUT}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
