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
  DAY1_ROOT_BINDINGS,
  DAY1_ROOTS,
  validateDay1ReleaseStartup,
} from "../worker/src/day1ReleasePolicy.js";
import { observedPolicyIdentity } from "../worker/src/planShadowModel.js";
import type { AccountRow, ChannelConfig } from "../worker/src/store.js";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

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
  const deriveBindings = process.argv.includes("--derive-bindings");
  if (deriveBindings && (arg("out") || arg("active-settings-out"))) {
    throw new Error("--derive-bindings is SELECT-only stdout and cannot write receipt files");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [strategistRead, accountRead, fundRead] = await Promise.all([
    sb.from("strategists")
      .select("id,slug,name,status,spec_json,underlying,executor,account_id,is_active,strategist_config(*)")
      .order("slug").order("id"),
    sb.from("accounts").select("id,name,mode,cred_ref,is_armed,is_halted,master_daily_stop_usd").order("id"),
    sb.from("fund_state").select("mode").eq("id", 1).maybeSingle(),
  ]);
  if (strategistRead.error) throw new Error(`strategists SELECT failed: ${strategistRead.error.message}`);
  if (accountRead.error) throw new Error(`accounts SELECT failed: ${accountRead.error.message}`);
  if (fundRead.error) throw new Error(`fund_state SELECT failed: ${fundRead.error.message}`);
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
  const startup = validateDay1ReleaseStartup({
    channels: overlaid,
    accounts,
    fundMode: String((fundRead.data as { mode?: unknown } | null)?.mode ?? ""),
    workerVersion: WORKER_VERSION,
    expectedConfigurationSha256: DAY1_RELEASE_CONFIGURATION_SHA256,
    resolvedCredentialAccountIds: [...new Set(DAY1_ROOT_BINDINGS.map((binding) => binding.accountId))],
    credentialRouteEvidenceBasis: "offline-example-assumption",
    posture: {
      alpacaPaperHost: "https://paper-api.alpaca.markets",
      stockFeed: "sip", optionFeed: "opra", dryRun: true, liveTrading: false,
      heldCaptureEnabled: true, heldCaptureFlushMs: 30_000,
      heldCaptureTargetSamples: 12, heldCaptureMaxAgeMs: 60_000,
      heldCaptureIngressMaxSamples: 10_000, heldCaptureIngressMaxBytes: 8_388_608,
      heldCaptureStateMaxSamples: 10_000, heldCaptureStateMaxBytes: 8_388_608,
      heldCaptureRetryMaxAttempts: 5, heldCaptureRetryBaseDelayMs: 30_000,
      heldCaptureRetryMaxDelayMs: 300_000, heldCaptureAdapterDeadlineMs: 5_000,
      heldCaptureNormalFlushDeadlineMs: 15_000, heldCaptureShutdownDeadlineMs: 30_000,
      managerShadowEnabled: true,
      managerShadowQuoteMaxAgeMs: 15_000,
    },
  });
  if (!startup.ok && !deriveBindings) throw new Error(`live fleet does not reproduce RC4 bindings: ${startup.errors.join(";")}`);

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
      committedRootBindings: DAY1_ROOT_BINDINGS,
      supersededRc1: {
        status: "rejected-superseded-not-deployable",
        fileSha256: "120cd5ec768c9743e024539cdca8a6e8145bcd32bb00e932367d6732df9cb99a",
        contentSha256: "02de877337c4cb1df736bbfd5dfbba0cf8c144c8f0204189d058db28cb09f2f8",
        configurationSha256: "ba0fed21340f34a7f816a7edb7589a44758e15b6696b4a6db41d432e090a37c1",
      },
      supersededRc2: {
        status: "accepted-major-correction-superseded-not-deployable",
        fileSha256: "4b0b4e6b3dbd5f7832cc696693bed674446dce8833e23c55bbfdab7d697c4c12",
        activeSettingsSha256: "e081acb65e9ab48904acfc8c363050bd1819e80b0dcf76b302776d1a2c36d6b6",
        releaseConfigurationSha256: "67abd8b0ad3435268156836a646d935da79ffd985b72cbef001e926b283fe746",
      },
      supersededRc3: {
        status: "accepted-shadow-candidate-superseded-before-executor",
        fileSha256: "705a997854395052ce1fed9870f440c07ac1e57dd4b00f810dfd7a128c5ad2df",
        activeSettingsSha256: "21e6e28fd25153cd33c79dc9289d91561e40be996d9b07305b40c12dfaa2df4d",
        releaseConfigurationSha256: "32a7d27813411274d0dc31dd4bcb9a86902d0bb990e5e2bc044317e109a1f3a6",
      },
      capture: {
        samples: 12, maxAgeMs: 60_000, ingressMaxSamples: 10_000, ingressMaxBytes: 8_388_608,
        combinedStateMaxSamples: 10_000, combinedStateMaxBytes: 8_388_608,
        retryAttempts: 5, retryBaseDelayMs: 30_000, retryMaxDelayMs: 300_000,
        retrySeconds: [0, 30, 90, 210, 450],
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
      "day1_global_snapshot_incomplete", "day1_global_orders_incomplete", "day1_account_manage_only",
      "day1_stale_decision_bar",
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
  const activeSettingsOut = arg("active-settings-out");
  if (activeSettingsOut) writeFileSync(activeSettingsOut, JSON.stringify(startup.activeSettingsReceipt));
  console.log(JSON.stringify({
    externalWrites: false,
    supabaseOperations: ["SELECT strategists", "SELECT accounts", "SELECT fund_state"],
    localOutput: out,
    localActiveSettingsOutput: activeSettingsOut,
    fleetChannels: channels.length,
    roots: roots.map((root) => ({
      slug: root.slug,
      strategistId: root.strategistId,
      account: root.account,
      channelVersion: root.policyIdentity.channelVersion,
      managerVersion: root.policyIdentity.managerVersion,
      configurationEpoch: root.policyIdentity.configurationEpochId,
      policyEpoch: root.policyIdentity.policyEpochId,
    })),
    releaseConfigurationSha256: DAY1_RELEASE_CONFIGURATION_SHA256,
    contentSha256: sealed.sha256,
    activeSettingsReceiptExample: startup.activeSettingsReceipt,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
