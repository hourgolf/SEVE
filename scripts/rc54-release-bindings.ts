// SELECT-only RC5.4 identity derivation. This script has no write call and emits
// the exact checked-in binding seal to stdout for review.

import { createClient } from "@supabase/supabase-js";
import { observedPolicyIdentity } from "../worker/src/planShadowModel.js";
import {
  applyRc54ReleaseFleetOverlay,
  RC54_ROOTS,
  RC54_RELEASE_CONFIGURATION_SHA256,
  rc54ManagerProfileId,
  validateRc54AccountBindings,
  validateRc54IdentitySeal,
  validateRc54SourceExecutorBoundary,
} from "../worker/src/rc54ReleasePolicy.js";
import type { AccountRow, ChannelConfig } from "../worker/src/store.js";
import { WORKER_VERSION } from "../worker/src/version.js";

function mapChannel(row: any): ChannelConfig {
  const cfg = Array.isArray(row.strategist_config)
    ? row.strategist_config[0]
    : row.strategist_config;
  if (!cfg) throw new Error(`strategist ${row.slug} has no strategist_config row`);
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name ?? row.slug),
    status: (row.status ?? "armed") as ChannelConfig["status"],
    spec_json: row.spec_json ?? null,
    underlying: String(row.underlying ?? "SPY").toUpperCase(),
    executor: row.executor === "stream" ? "stream" : "cron",
    account_id: row.account_id ?? null,
    is_active: row.is_active !== false,
    capital_pct: Number(cfg.capital_pct),
    aggression: Number(cfg.aggression),
    max_contracts: Number(cfg.max_contracts),
    daily_stop_usd: Number(cfg.daily_stop_usd),
    daily_target_usd: Number(cfg.daily_target_usd ?? 0),
    underlying_stop_pct: Number(cfg.underlying_stop_pct ?? 0),
    muted: !!cfg.muted,
    soloed: !!cfg.soloed,
    boosted: !!cfg.boosted,
    event_policy: cfg.event_policy === "ignore" ? "ignore" : "standdown",
    entry_dte: Math.max(0, Math.min(1, Number(cfg.entry_dte ?? 0))),
    strike_offset: Math.round(Number(cfg.strike_offset ?? 0)),
    premium_stop_pct: cfg.premium_stop_pct == null ? null : Number(cfg.premium_stop_pct),
    take_profit_pct: Math.max(0, Number(cfg.take_profit_pct ?? 0)),
    pyramid_adds: Math.max(0, Math.floor(Number(cfg.pyramid_adds ?? 0))),
    stall_minutes: Math.max(0, Math.floor(Number(cfg.stall_minutes ?? 0))),
    stall_max_favor_pct: Math.max(0, Number(cfg.stall_max_favor_pct ?? 0)),
    gap_min: Math.max(0, Number(cfg.gap_min ?? 0)),
    runner_frac: Math.min(0.9, Math.max(0, Number(cfg.runner_frac ?? 0))),
    runner_giveback_pct: Math.max(0, Number(cfg.runner_giveback_pct ?? 0)),
  };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [strategistRead, accountRead] = await Promise.all([
    sb.from("strategists")
      .select("id,slug,name,status,spec_json,underlying,executor,account_id,is_active,strategist_config(*)")
      .order("slug"),
    sb.from("accounts")
      .select("id,name,mode,cred_ref,is_armed,is_halted,master_daily_stop_usd")
      .order("id"),
  ]);
  if (strategistRead.error) throw new Error(`strategists SELECT failed: ${strategistRead.error.message}`);
  if (accountRead.error) throw new Error(`accounts SELECT failed: ${accountRead.error.message}`);
  const fleet = (strategistRead.data ?? []).map(mapChannel);
  const rootSlugs = new Set(RC54_ROOTS.map((root) => root.slug));
  const channels = fleet.filter((channel) => rootSlugs.has(channel.slug));
  const accounts = (accountRead.data ?? []) as AccountRow[];
  if (channels.length !== RC54_ROOTS.length) {
    throw new Error(`root count mismatch: expected ${RC54_ROOTS.length}, observed ${channels.length}`);
  }
  const boundaryErrors = validateRc54SourceExecutorBoundary(fleet);
  if (boundaryErrors.length) throw new Error(`source boundary failed: ${boundaryErrors.join(";")}`);
  const accountErrors = validateRc54AccountBindings(accounts);
  if (accountErrors.length) throw new Error(`account bindings failed: ${accountErrors.join(";")}`);
  const overlaid = applyRc54ReleaseFleetOverlay(fleet);
  const identityErrors = validateRc54IdentitySeal({
    channels: fleet,
    workerVersion: WORKER_VERSION,
  });
  if (identityErrors.length) {
    throw new Error(`checked-in identity seal failed: ${identityErrors.join(";")}`);
  }
  const channelBySlug = new Map(overlaid.map((channel) => [channel.slug, channel]));
  const seal = RC54_ROOTS.map((root) => {
    const channel = channelBySlug.get(root.slug);
    if (!channel) throw new Error(`${root.slug}: missing after overlay`);
    const identity = observedPolicyIdentity({
      channel,
      accountId: root.accountId,
      workerVersion: WORKER_VERSION,
      executableManagerProfile: rc54ManagerProfileId(root.slug),
    });
    if (!identity) throw new Error(`${root.slug}: identity unavailable`);
    return {
      slug: root.slug,
      strategistId: root.strategistId,
      accountId: root.accountId,
      accountMode: "paper",
      channelVersion: identity.channelVersion,
      managerVersion: identity.managerVersion,
      configurationEpoch: identity.configurationEpochId,
      policyEpoch: identity.policyEpochId,
    };
  });
  process.stdout.write(`${JSON.stringify({
    releaseConfigurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
    fleetCount: fleet.length,
    identitySealVerified: true,
    seal,
  }, null, 2)}\n`);
}

void main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
  process.exitCode = 1;
});
