// SELECT-only Monday release receipt renderer. The only optional write is the
// explicitly requested local --out file; no Supabase/R2/broker write client or
// mutation is present.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import {
  DAY1_EVIDENCE_FLOOR,
  DAY1_OPPORTUNITY_CLUSTER_RULE,
  DAY1_PORTFOLIO_RULE,
  DAY1_PROSPECTIVE_SCORER_VERSION,
  DAY1_ZERO_DELTA_RULE,
} from "../lib/research/day1ProspectiveScorer.js";
import { sealDay1Preregistration, type Day1PreregistrationContent } from "../lib/research/day1Preregistration.js";
import { WORKER_VERSION } from "../worker/src/version.js";
import {
  applyDay1ReleaseFleetOverlay,
  DAY1_DARK_CHANNELS,
  DAY1_MANAGER_ARMS,
  DAY1_RELEASE_CONFIGURATION,
  DAY1_RELEASE_CONFIGURATION_SHA256,
  DAY1_RELEASE_ID,
  DAY1_ROOTS,
} from "../worker/src/day1ReleasePolicy.js";
import { observedPolicyIdentity } from "../worker/src/planShadowModel.js";
import type { ChannelConfig } from "../worker/src/store.js";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

interface AccountRow { id: string; name: string; mode: string; cred_ref: string | null; }

function mapChannel(row: any): ChannelConfig {
  const cfg = Array.isArray(row.strategist_config) ? row.strategist_config[0] : row.strategist_config;
  if (!cfg) throw new Error(`strategist ${row.slug} has no strategist_config row`);
  return {
    id: String(row.id), slug: String(row.slug), name: String(row.name ?? row.slug),
    status: (row.status ?? "armed") as ChannelConfig["status"], spec_json: row.spec_json ?? null,
    underlying: String(row.underlying ?? "SPY").toUpperCase(),
    executor: row.executor === "stream" ? "stream" : "cron", account_id: row.account_id ?? null,
    is_active: row.is_active !== false, capital_pct: Number(cfg.capital_pct), aggression: Number(cfg.aggression),
    max_contracts: Number(cfg.max_contracts), daily_stop_usd: Number(cfg.daily_stop_usd),
    daily_target_usd: Number(cfg.daily_target_usd ?? 0), underlying_stop_pct: Number(cfg.underlying_stop_pct ?? 0),
    muted: !!cfg.muted, soloed: !!cfg.soloed, boosted: !!cfg.boosted,
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
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [strategistRead, accountRead] = await Promise.all([
    sb.from("strategists")
      .select("id,slug,name,status,spec_json,underlying,executor,account_id,is_active,strategist_config(*)")
      .order("slug").order("id"),
    sb.from("accounts").select("id,name,mode,cred_ref").order("id"),
  ]);
  if (strategistRead.error) throw new Error(`strategists SELECT failed: ${strategistRead.error.message}`);
  if (accountRead.error) throw new Error(`accounts SELECT failed: ${accountRead.error.message}`);
  const channels = (strategistRead.data ?? []).map(mapChannel);
  const accounts = (accountRead.data ?? []) as AccountRow[];
  if (channels.length !== DAY1_ROOTS.length + DAY1_DARK_CHANNELS.length) {
    throw new Error(`fleet size mismatch: expected 68, observed ${channels.length}`);
  }
  const expectedSlugs = new Set([...DAY1_ROOTS.map((root) => root.slug), ...DAY1_DARK_CHANNELS]);
  const actualSlugs = new Set(channels.map((channel) => channel.slug));
  const missing = [...expectedSlugs].filter((slug) => !actualSlugs.has(slug));
  const unexpected = [...actualSlugs].filter((slug) => !expectedSlugs.has(slug));
  if (missing.length || unexpected.length || actualSlugs.size !== channels.length) {
    throw new Error(`fleet identity mismatch: missing=${missing.join(",")} unexpected=${unexpected.join(",")}`);
  }
  const overlaid = applyDay1ReleaseFleetOverlay(channels);
  const channelBySlug = new Map(overlaid.map((channel) => [channel.slug, channel]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const defaultAccounts = accounts.filter((account) => !account.cred_ref);
  if (defaultAccounts.length !== 1) throw new Error(`expected one default paper account, found ${defaultAccounts.length}`);

  const roots = DAY1_ROOTS.map((root) => {
    const channel = channelBySlug.get(root.slug);
    if (!channel) throw new Error(`root missing after overlay: ${root.slug}`);
    const account = accountById.get(channel.account_id ?? defaultAccounts[0].id);
    if (!account || account.mode.toLowerCase() !== "paper") throw new Error(`${root.slug} does not resolve to a paper account`);
    const identity = observedPolicyIdentity({ channel, accountId: account.id, workerVersion: WORKER_VERSION });
    if (!identity) throw new Error(`could not build policy identity for ${root.slug}`);
    return {
      ...root,
      strategistId: channel.id,
      lifecycle: "paper-root",
      account: { id: account.id, name: account.name, mode: account.mode },
      policyIdentity: identity,
    };
  });

  const content: Day1PreregistrationContent = {
    schemaVersion: 1,
    contractId: DAY1_RELEASE_ID,
    cohortStartEt: "2026-07-20",
    paperOnly: true,
    roots,
    shadows: DAY1_DARK_CHANNELS.map((slug) => ({ slug, lifecycle: "dark", fillsAuthorized: false })),
    families: DAY1_ROOTS.map((root) => ({
      id: root.familyId, root: root.slug, maxOpen: 1, quantity: 2,
      underlyingMaxOpen: DAY1_RELEASE_CONFIGURATION.concurrency.maxOpenByUnderlying[root.underlying],
    })),
    evidence: {
      frozenGate0ReceiptSha256: "967f342378922b4e8c12e1d9bef01739bde40ae014cb54dd65c56cc021c7f819",
      workerVersion: WORKER_VERSION,
      releaseConfigurationSha256: DAY1_RELEASE_CONFIGURATION_SHA256,
      releaseConfiguration: DAY1_RELEASE_CONFIGURATION,
      capture: {
        samples: 12, maxAgeSeconds: 60, combinedStateMaxSamples: 10_000,
        combinedStateMaxBytes: 8_388_608, retrySeconds: [0, 30, 90, 210, 450],
        adapterDeadlineSeconds: 5, normalFlushDeadlineSeconds: 15, shutdownDeadlineSeconds: 30,
      },
      scorer: {
        version: DAY1_PROSPECTIVE_SCORER_VERSION,
        zeroDeltaRule: DAY1_ZERO_DELTA_RULE,
        opportunityClusterRule: DAY1_OPPORTUNITY_CLUSTER_RULE,
        evidenceFloor: DAY1_EVIDENCE_FLOOR,
        portfolioRule: DAY1_PORTFOLIO_RULE,
        portfolioWeightingRule: null,
        portfolioClaimAuthorized: false,
      },
      shadowManager: { version: DAY1_RELEASE_CONFIGURATION.management.shadowManagerVersion, arms: DAY1_MANAGER_ARMS },
      gate2: {
        schemaStatus: "design-approved-unapplied-before-t-plus-1",
        exactPathRequired: true,
        substitutesAuthorized: false,
        historicalFixtureClockBasis: "openedAtMs_proxy_not_original_decision_timestamp",
      },
    },
    censors: [
      "day1_dark_lifecycle", "day1_adds_disabled", "day1_exit_shadow_only", "day1_session_ledger_unavailable",
      "day1_premium_debit_cap", "day1_admission_closed", "day1_spy_same_clock_collision", "day1_family_open",
      "day1_reentry_disabled", "day1_same_occ_open", "day1_underlying_concurrency", "day1_global_concurrency",
      "left_boundary_censored", "right_boundary_censored", "internal_gap_censored", "path_identity_mismatch",
      "invalid_exact_quote", "invalid_exact_entry_ask", "adapter_timeout", "retry_exhausted", "shutdown_abandoned",
      "no_fresh_cutoff_bid",
    ],
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
  };
  const sealed = sealDay1Preregistration(content);
  const output = JSON.stringify({ contentSha256: sealed.sha256, content: JSON.parse(sealed.canonicalJson) });
  const out = arg("out");
  if (out) writeFileSync(out, output);
  console.log(JSON.stringify({
    externalWrites: false,
    supabaseOperations: ["SELECT strategists", "SELECT accounts"],
    localOutput: out,
    fleetChannels: channels.length,
    roots: roots.map((root) => ({
      slug: root.slug,
      channelVersion: root.policyIdentity.channelVersion,
      managerVersion: root.policyIdentity.managerVersion,
      configurationEpoch: root.policyIdentity.configurationEpochId,
    })),
    releaseConfigurationSha256: DAY1_RELEASE_CONFIGURATION_SHA256,
    contentSha256: sealed.sha256,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
