// Build the exact, reversible Weekend Profit-Conversion Monday roster packet.
// This is SELECT/GET-only and writes local evidence artifacts only.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  compileReleaseManifest,
  contentHash,
  managerPolicyContentHash,
  projectAdmissionPolicyReentry,
  type AdmissionPolicySpec,
  type ChannelRatchetPolicy,
  type ChannelSpecVersion,
  type ChannelSpecVersionDraft,
  type ChannelTakeProfitPolicy,
} from "../lib/channels/channelControlPlane";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { evaluatePortfolioCapacity } from "../lib/channels/channelPortfolioCapacity";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import {
  WEEKEND_MONDAY_OBSERVE_TRANSITIONS,
  WEEKEND_MONDAY_ROSTER,
  WEEKEND_MONDAY_ROSTER_VERSION,
  WEEKEND_MONDAY_TARGET_SESSION,
  validateWeekendMondayRoster,
} from "../lib/channels/weekendMondayRoster20260824";
import { CORE_REQUIRED_RECEIPTS, type StrategyCartridgeV1 } from "../lib/strategy/channelContract";
import { registerResearchChannel } from "../lib/channels/researchChannelRegistry";
import { createServerSupabaseClient } from "./serverSupabase";

const GENERATED_AT = "2026-08-23T12:00:00.000Z";
const TRIALS = ["vb-curl-reversal-iwm", "vb-gap-drift-qqq", "vb-or-fail-iwm", "orb-trend-rider"] as const;

const value = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const tournamentFile = resolve(value("tournament-file", "data/weekend-optimization/2026-08-22/monday-roster-tournament/report.json"));
const phenotypeFile = resolve(value("phenotype-file", "data/weekend-optimization/2026-08-22/channel-phenotypes/phenotypes.json"));
const outputDir = resolve(value("output-dir", "data/weekend-optimization/2026-08-22/sunday-decision-packet"));
if (!existsSync(tournamentFile) || !existsSync(phenotypeFile)) throw new Error("tournament or phenotype evidence missing");

interface SourceRow {
  id: string; slug: string; name: string; underlying: string; executor: string;
  account_id: string; status: string; is_active: boolean; spec_json: unknown;
  strategist_config: Record<string, unknown> | Record<string, unknown>[] | null;
}
interface ManagerShape {
  profile: string;
  takeProfit: ChannelTakeProfitPolicy;
  stopPct: number;
  ratchet: ChannelRatchetPolicy;
  label: string;
}

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const joined = chars.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
function withoutHash(spec: ChannelSpecVersion): ChannelSpecVersionDraft {
  const { contentHash: _contentHash, ...draft } = spec;
  return draft;
}
function sourceConfig(source: SourceRow): Record<string, unknown> {
  const row = Array.isArray(source.strategist_config) ? source.strategist_config[0] : source.strategist_config;
  if (!row) throw new Error(`${source.slug}: strategist configuration missing`);
  return row;
}
function sourceHash(source: SourceRow): string {
  return contentHash({ id: source.id, slug: source.slug, name: source.name,
    underlying: source.underlying, executor: source.executor, accountId: source.account_id,
    status: source.status, isActive: source.is_active, specJson: source.spec_json,
    strategistConfig: sourceConfig(source) });
}
async function exactOperator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator inventory failed: ${read.error.message}`);
  const rows = read.data.users.filter(isDeskOperator);
  if (rows.length !== 1) throw new Error(`expected one desk operator, observed ${rows.length}`);
  return rows[0]!;
}
const none: ChannelRatchetPolicy = {
  kind: "none", engageReturnPct: null, givebackPct: null,
  retainGainPct: null, fixedTargetPct: null,
};
const managerShapes: Record<string, ManagerShape> = {
  "BANK30-R50-K67": {
    profile: "BANK30-R50-K67",
    takeProfit: { kind: "bank", targetPct: 30, fraction: 0.5 }, stopPct: 30,
    ratchet: { kind: "a13", engageReturnPct: 50, givebackPct: 33,
      retainGainPct: 67, fixedTargetPct: null },
    label: "BANK HALF +30% · RUNNER RATCHET +50 / KEEP 67% · STOP -30%",
  },
  "FULL-R50-K75": {
    profile: "FULL-R50-K75",
    takeProfit: { kind: "ride", targetPct: null, fraction: 0 }, stopPct: 35,
    ratchet: { kind: "a13", engageReturnPct: 50, givebackPct: 25,
      retainGainPct: 75, fixedTargetPct: null },
    label: "FULL POSITION RATCHET +50 / KEEP 75% · STOP -35%",
  },
  "FULL-R35-K67": {
    profile: "FULL-R35-K67",
    takeProfit: { kind: "ride", targetPct: null, fraction: 0 }, stopPct: 30,
    ratchet: { kind: "a13", engageReturnPct: 35, givebackPct: 33,
      retainGainPct: 67, fixedTargetPct: null },
    label: "FULL POSITION RATCHET +35 / KEEP 67% · STOP -30%",
  },
  "TP-50": {
    profile: "BREAKOUT-ALL-OUT-50", takeProfit: { kind: "bank", targetPct: 50, fraction: 0 },
    stopPct: 40, ratchet: none, label: "ALL OUT +50% · STOP -40%",
  },
  "TP-30": {
    profile: "VB-LEVEL-ALL-OUT-30", takeProfit: { kind: "bank", targetPct: 30, fraction: 0 },
    stopPct: 30, ratchet: none, label: "ALL OUT +30% · STOP -30%",
  },
};

function changedExisting(input: {
  source: ChannelSpecVersion; operatorId: string; proposalId: string;
  accountTemplateByName: Map<string, ChannelSpecVersion>;
}): ChannelSpecVersionDraft {
  const decision = WEEKEND_MONDAY_ROSTER.find((row) => row.channel === input.source.slug);
  const observe = WEEKEND_MONDAY_OBSERVE_TRANSITIONS.includes(input.source.slug as typeof WEEKEND_MONDAY_OBSERVE_TRANSITIONS[number]);
  if (!decision && !observe) return withoutHash(input.source);
  if (!decision && observe) return {
    ...withoutHash(input.source),
    id: `spec:proposal:${input.proposalId}:${input.source.slug}`,
    parentVersionId: input.source.id,
    executionPosture: "observe-only",
    validFrom: GENERATED_AT, validUntil: null,
    createdAt: GENERATED_AT, createdBy: `operator:${input.operatorId}`, status: "draft",
  };
  const accountTemplate = decision ? input.accountTemplateByName.get(decision.account) : null;
  if (decision && !accountTemplate) throw new Error(`${decision.channel}: account template missing`);
  const manager = decision ? managerShapes[decision.manager] : undefined;
  const semanticManagerChange = manager != null && manager.profile !== input.source.managerProfileId;
  const premiumCap = Number(input.source.entryParameters.premiumCap);
  const quantity = decision?.quantity ?? input.source.quantity;
  const maxDebitUsd = Math.round(premiumCap * quantity * 100);
  const stopPct = manager?.stopPct ?? input.source.stopLoss.catastrophePct;
  const takeProfit = manager?.takeProfit ?? structuredClone(input.source.takeProfit);
  const ratchetParameters = manager?.ratchet ?? structuredClone(input.source.ratchetParameters);
  const stopLoss = { catastrophePct: stopPct, priceBasis: "executable-option-bid" as const };
  const managerProfileId = manager?.profile ?? input.source.managerProfileId;
  const managerVersion = manager ? managerPolicyContentHash({ managerProfileId, takeProfit,
    stopLoss, ratchetParameters, liquidationEt: input.source.exitParameters.eodEt ?? "15:25" }) : input.source.managerVersion;
  const routingChange = Boolean(decision && input.source.accountId !== accountTemplate!.accountId);
  const semanticChange = observe || decision?.priority !== input.source.priority
    || decision?.entryCap !== Number(input.source.entryParameters.maxEntriesPerSession ?? 1)
    || decision?.quantity !== input.source.quantity || semanticManagerChange || routingChange
    || (decision != null && (input.source.executionPosture ?? "paper") !== "paper");
  if (!semanticChange) return withoutHash(input.source);
  return {
    ...withoutHash(input.source),
    id: `spec:proposal:${input.proposalId}:${input.source.slug}`,
    parentVersionId: input.source.id,
    ...(decision && accountTemplate && routingChange ? {
      accountId: accountTemplate.accountId, accountRole: accountTemplate.accountRole,
      collisionDomain: decision.collisionDomain,
      cohort: accountTemplate.cohort,
    } : {}),
    quantity, priority: decision?.priority ?? input.source.priority,
    maxDebitUsd,
    entryParameters: { ...input.source.entryParameters,
      ...(decision ? { maxEntriesPerSession: decision.entryCap } : {}) },
    exitParameters: { ...input.source.exitParameters,
      ...(manager ? { managerLabel: manager.label } : {}) },
    managerProfileId, managerVersion, takeProfit, stopLoss, ratchetParameters,
    riskLimits: { maxContracts: quantity, maxDebitUsd,
      maxRiskUsd: Math.round(maxDebitUsd * stopPct) / 100 },
    reentryPolicy: decision && decision.entryCap > 1 ? "bounded" : "disabled",
    executionPosture: observe ? "observe-only" : "paper",
    validFrom: GENERATED_AT, validUntil: null,
    createdAt: GENERATED_AT, createdBy: `operator:${input.operatorId}`, status: "draft",
  };
}

function candidateSpec(input: {
  source: SourceRow; decision: typeof WEEKEND_MONDAY_ROSTER[number];
  accountTemplate: ChannelSpecVersion; operatorId: string; proposalId: string;
}): ChannelSpecVersionDraft {
  const cfg = sourceConfig(input.source);
  const nativeTargetBySlug: Record<string, number> = {
    "vb-curl-reversal-iwm": 20,
    "vb-gap-drift-qqq": 25,
    "vb-or-fail-iwm": 15,
    "orb-trend-rider": 30,
  };
  const targetByManager: Record<string, number> = {
    "VB-CURL-IWM-ALL-OUT-20": 20,
    "VB-GAP-QQQ-ALL-OUT-25": 25,
    "VB-OR-FAIL-IWM-ALL-OUT-15": 15,
    "ORB-ALL-OUT-50": 50,
  };
  const nativeTarget = nativeTargetBySlug[input.source.slug];
  const expectedTarget = targetByManager[input.decision.manager];
  if (nativeTarget == null || expectedTarget == null) throw new Error(`${input.source.slug}: manager target mapping missing`);
  if (input.source.executor !== "stream" || input.source.is_active !== true
      || input.source.spec_json == null || input.source.underlying !== input.decision.underlying
      || Number(cfg.entry_dte) !== 0 || Number(cfg.strike_offset) !== 0
      || Number(cfg.take_profit_pct) !== nativeTarget || Number(cfg.premium_stop_pct) < 30
      || (cfg.event_policy ?? "standdown") !== "standdown") {
    throw new Error(`${input.source.slug}: candidate source or settings drifted`);
  }
  const takeProfit: ChannelTakeProfitPolicy = { kind: "bank", targetPct: expectedTarget, fraction: 0 };
  const stopLoss = { catastrophePct: 30, priceBasis: "executable-option-bid" as const };
  const profile = input.decision.manager;
  const premiumCap = Number(cfg.capital_pct) / 100;
  const maxDebitUsd = Math.round(premiumCap * input.decision.quantity * 100);
  return {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: `spec:proposal:${input.proposalId}:${input.source.slug}`,
    channelId: input.source.id, slug: input.source.slug,
    strategyIdentity: `strategists/${input.source.id}/compiled-spec`,
    strategyVersion: sourceHash(input.source), signalVersion: `weekend-monday:${sourceHash(input.source)}`,
    managerProfileId: profile,
    managerVersion: managerPolicyContentHash({ managerProfileId: profile, takeProfit,
      stopLoss, ratchetParameters: none, liquidationEt: "15:25" }),
    accountId: input.accountTemplate.accountId, accountRole: input.accountTemplate.accountRole,
    accountMode: "paper", symbolScope: [input.decision.underlying], familyId: input.decision.familyId,
    cohort: input.accountTemplate.cohort, priority: input.decision.priority,
    quantity: input.decision.quantity, maxDebitUsd,
    entryParameters: { entryDte: 0, strikeOffset: 0, premiumCap,
      eventPolicy: "standdown", maxEntriesPerSession: input.decision.entryCap },
    exitParameters: { accountName: input.accountTemplate.accountRole,
      managerLabel: `ALL OUT +${expectedTarget}% · STOP -30%`, eodEt: "15:25",
      priceBasis: "executable-option-bid" },
    takeProfit, stopLoss, ratchetParameters: none,
    reentryPolicy: "disabled", scalePolicy: { adds: 0, pyramiding: "disabled" },
    collisionDomain: input.decision.collisionDomain,
    riskLimits: { maxContracts: input.decision.quantity, maxDebitUsd,
      maxRiskUsd: Math.round(maxDebitUsd * 0.3) },
    executionPosture: "paper", validFrom: GENERATED_AT, validUntil: null,
    createdBy: `operator:${input.operatorId}`, createdAt: GENERATED_AT,
    // New paper members must point at the exact paper-eligible research spec
    // that qualifies their admission. The roster persistence boundary verifies
    // this link against the current registry before it will store the bundle.
    parentVersionId: `spec:research:${input.source.slug}:weekend-monday-v1`,
    status: "draft",
  };
}

function policiesFor(active: readonly AdmissionPolicySpec[], specs: readonly ChannelSpecVersionDraft[]): AdmissionPolicySpec[] {
  return projectAdmissionPolicyReentry(active.map((policy) => ({
    ...structuredClone(policy),
    priorityBySlug: Object.fromEntries(specs.filter((spec) => spec.collisionDomain === policy.id)
      .map((spec) => [spec.slug, spec.priority])),
  })), specs);
}

function normalizeUnderlyingPriorities(input: {
  specs: readonly ChannelSpecVersionDraft[];
  baseBySlug: Map<string, ChannelSpecVersion>;
  proposalId: string;
  operatorId: string;
}): ChannelSpecVersionDraft[] {
  const paperSet = new Set(WEEKEND_MONDAY_ROSTER.map((row) => row.channel));
  const nextPriority = new Map<string, number>();
  const assigned = new Map<string, number>();
  const ordered = [...input.specs].sort((left, right) => {
    const leftPaper = paperSet.has(left.slug) ? 0 : 1;
    const rightPaper = paperSet.has(right.slug) ? 0 : 1;
    return left.collisionDomain.localeCompare(right.collisionDomain)
      || String(left.symbolScope[0] ?? "").localeCompare(String(right.symbolScope[0] ?? ""))
      || leftPaper - rightPaper || left.priority - right.priority || left.slug.localeCompare(right.slug);
  });
  for (const spec of ordered) {
    const key = `${spec.collisionDomain}:${spec.symbolScope[0] ?? ""}`;
    const priority = nextPriority.get(key) ?? 1;
    assigned.set(spec.slug, priority);
    nextPriority.set(key, priority + 1);
  }
  return input.specs.map((spec) => {
    const priority = assigned.get(spec.slug)!;
    if (priority === spec.priority) return spec;
    const base = input.baseBySlug.get(spec.slug);
    return { ...spec, priority,
      id: `spec:proposal:${input.proposalId}:${spec.slug}`,
      parentVersionId: base?.id ?? spec.parentVersionId,
      validFrom: GENERATED_AT, validUntil: null, createdAt: GENERATED_AT,
      createdBy: `operator:${input.operatorId}`, status: "draft" };
  });
}

function cartridge(source: SourceRow, spec: ChannelSpecVersionDraft): StrategyCartridgeV1 {
  const target = spec.takeProfit.targetPct ?? 0;
  const hypothesisBySlug: Record<string, string> = {
    "vb-gap-drift-qqq": "Trade QQQ gap-day drift after its native directional qualification.",
    "vb-curl-reversal-iwm": "Trade IWM stale-curl reversal after its native directional qualification.",
    "vb-or-fail-iwm": "Trade IWM opening-range rejection after its native directional qualification.",
    "orb-trend-rider": "Trade a qualified SPY opening-range trend only when the primary ORB authority is not occupying the family lane.",
  };
  const hypothesis = hypothesisBySlug[source.slug];
  if (!hypothesis) throw new Error(`${source.slug}: hypothesis missing`);
  return {
    schemaVersion: 1,
    identity: { slug: spec.slug, displayName: source.name, familyId: spec.familyId,
      hypothesis, version: "1.0.0", underlyings: [...spec.symbolScope], executor: "stream" },
    lifecycle: { stage: "dark", promotionAuthority: "operator_only", liveMoneyAuthorized: false },
    admission: { strategyRef: { kind: "compiled_spec", ref: spec.strategyIdentity,
      contentHash: spec.strategyVersion }, runtimeRef: { workerVersion: "proposal-only",
      sourceCommit: "0".repeat(40) }, decisionClock: { id: `${spec.symbolScope[0]}:stock-feed:1m-complete`,
      mode: "bar_close", cadenceMs: 60_000, maxDecisionLagMs: 15_000 },
      conditionsSummary: hypothesis,
      requiredInputs: [
        { id: "underlying-bars", kind: "underlying_bar", source: "alpaca-sip",
          cadenceMs: 60_000, maxAgeMs: 75_000, purposes: ["admission", "evidence"] },
        { id: "opra-cbbo", kind: "option_cbbo", source: "alpaca-opra",
          cadenceMs: 1_000, maxAgeMs: 15_000, purposes: ["selection", "risk", "management", "evidence"] },
        { id: "session-calendar", kind: "session_calendar", source: "seve-market-calendar",
          cadenceMs: 86_400_000, maxAgeMs: 86_400_000, purposes: ["admission", "management"] },
      ], eventPolicy: "stand_down", optionSelector: { dte: { min: 0, max: 0 },
        strike: { kind: "atm_offset", offset: 0 }, entryBasis: "ask", exitMarkBasis: "bid" },
      reentry: "one_per_session" },
    risk: { riskPerTradeUsd: spec.riskLimits.maxRiskUsd, maxContracts: spec.quantity,
      dailyEntryLatchUsd: spec.maxDebitUsd, maxOpenPositions: 1,
      collisionFamily: spec.familyId, maxConcurrentInCollisionFamily: 1,
      concentrationTags: [spec.symbolScope[0]!, "US-INDEX-LONG-PREMIUM"] },
    management: { managerId: spec.managerProfileId, managerVersion: "1.0.0",
      initialStops: [{ kind: "premium_loss_pct", lossPct: spec.stopLoss.catastrophePct, basis: "bid" }],
      harvest: { allocationMode: "whole_contract_exact", minimumQuantity: 1,
        tranches: [{ id: "all-out", role: "all_out", allocation: { units: 1, of: 1 },
          exit: { kind: "premium_return_pct", returnPct: target, basis: "bid" } }] },
      adds: { enabled: false }, stall: { enabled: false },
      eod: { kind: "minutes_before_session_close", minutes: 35 } },
    observability: { requiredReceipts: [...CORE_REQUIRED_RECEIPTS], missingEvidenceBehavior: "censor",
      outcomePartitions: ["native", "operator_managed", "operator_test", "execution_correction", "censored"] },
    display: { liveFacts: ["channel_state", "open_position", "risk_budget", "initial_stop",
      "next_harvest", "policy_version", "last_decision", "data_freshness"],
      researchFacts: ["cohort", "window", "independent_sessions", "native_outcomes",
        "matched_opportunity_clocks", "mfe", "mae", "realized_capture", "quote_provenance", "evidence_blockers"],
      performanceBasisRequired: true, placeholderMetricsAllowed: false },
  };
}

function diff(before: ChannelSpecVersion | undefined, after: ChannelSpecVersion) {
  const keys = ["executionPosture", "accountId", "accountRole", "collisionDomain", "familyId",
    "priority", "quantity", "managerProfileId", "managerVersion", "entryParameters",
    "takeProfit", "stopLoss", "ratchetParameters", "maxDebitUsd", "riskLimits"] as const;
  return keys.flatMap((key) => contentHash({ value: before?.[key] ?? null }) === contentHash({ value: after[key] })
    ? [] : [{ field: key, before: before?.[key] ?? null, after: after[key] }]);
}

function scaled(spec: ChannelSpecVersion, quantity: number): ChannelSpecVersion {
  const unitDebit = spec.maxDebitUsd / spec.quantity;
  const unitRisk = spec.riskLimits.maxRiskUsd / spec.quantity;
  return { ...spec, quantity, maxDebitUsd: Math.round(unitDebit * quantity * 100) / 100,
    riskLimits: { maxContracts: quantity,
      maxDebitUsd: Math.round(unitDebit * quantity * 100) / 100,
      maxRiskUsd: Math.round(unitRisk * quantity * 100) / 100 } };
}

function markdown(packet: any): string {
  const money = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  return [
    "# Sunday decision packet · Monday 2026-08-24", "",
    "**PROPOSAL ONLY · READ-ONLY PREPARATION · NO PRODUCTION CHANGES**", "",
    "## GO recommendation", "",
    "GO for the exact ten-channel paper roster below, contingent on a fresh flat-boundary check, exact worker compatibility, and separate operator approval. Every change is independently reversible.", "",
    "## Monday roster and account map", "",
    "| Account | Priority | Channel | Size | Native manager | Decision |",
    "|---|---:|---|---:|---|---|",
    ...packet.roster.map((row: any) => `| ${row.account} | ${row.priority} | ${row.channel} | ${row.quantity} | ${row.manager} | ${row.action.replaceAll("_", " ")} |`), "",
    "## Exact configuration and sizing changes", "",
    "| Channel | Monday change |",
    "|---|---|",
    "| momo-shape-2 | Keep 2 contracts; native becomes BANK30-R50-K67; allow at most 2 entries/session. |",
    "| grind-smart-entries | Observing → trading; 2 → 4 contracts; native becomes FULL-R50-K75; 1 entry/session. |",
    "| vb-curl-reversal-iwm | New 2-contract Account 1 paper trial; native all-out +20/-30. |",
    "| vb-macd-state | No change: 4 contracts, WIDE20/50. |",
    "| vb-level-break | 2 → 4 contracts; native LOCK50/30 → all-out +30/-30; priority 4 → 2. |",
    "| vb-gap-drift-qqq | New 2-contract Account 2 paper trial; native all-out +25/-30. |",
    "| vb-or-fail-iwm | New 2-contract Account 2 paper trial; native all-out +15/-30. |",
    "| orb-ustop-ctl | No change: 2 contracts, primary Account 3 priority, B30/A13. |",
    "| orb-trend-rider | New 2-contract Account 3 family-backup trial; native all-out +50/-30. |",
    "| pb-ride | Observing → 2-contract Account 3 paper trial; native all-out +12. |",
    "| breakout, breakout-alt-v3-itm, vb-rsi-revert-iwm, vb-curl-reversal-qqq, pb-ride-itm, grind-v3 | Trading → observing; retain research collection without entry authority. |", "",
    "## Why this roster", "",
    `The same-clock replay modeled ${money(packet.portfolioReplay.twoWeek.modeledPnlUsd)} over the recent two-week window and remained ${money(packet.portfolioReplay.twoWeek.withoutBestSessionUsd)} after removing its best session. It was positive in ${packet.portfolioReplay.twoWeek.positiveSessions}/${packet.portfolioReplay.twoWeek.sessions} sessions.`,
    "Five open-lane candidates passed both recent windows, stayed positive without their best session, and displaced zero incumbents: vb-gap-drift-qqq, pb-ride, vb-or-fail-iwm, orb-trend-rider, and vb-curl-reversal-iwm.",
    "The selected ten are the fourth-ranked raw replay but the strongest defensible transition: they trail the numerical leader by only $23 after best-session removal over two weeks, preserve the established momo and primary ORB authorities, and exclude the unstable vb-rsi-revert-iwm leg.",
    "breakout's FULL-R35-K67 exit remains a validated shadow finding, but the channel's recent portfolio contribution was still negative after its best session was removed. It returns to observation instead of consuming a Monday lane.", "",
    "## Native versus shadow controls", "",
    ...packet.roster.map((row: any) => `- **${row.channel}:** native ${row.manager}; shadow ${row.shadowControls.join(", ")}.`), "",
    "## Promotions, holds, and retirements", "",
    "- Promote/paper-test: grind-smart-entries, vb-curl-reversal-iwm, vb-gap-drift-qqq, vb-or-fail-iwm, orb-trend-rider, and pb-ride.",
    "- Return to observe-only: breakout, breakout-alt-v3-itm, vb-curl-reversal-qqq, pb-ride-itm, grind-v3, and vb-rsi-revert-iwm.",
    "- Hold outside the Monday roster: breakout-smart-entries and every other non-winning tournament entrant. Their evidence remains research evidence; no production behavior changes.",
    "- New retirements: none. A failed paper-lane test returns to observation first; existing retired channels remain retired unless they independently win a future preregistered tournament.", "",
    "## Collision and sizing read", "",
    `- Candidate capacity state: **${packet.capacity.state.toUpperCase()}**.`,
    "- Cross-account same-OCC remains allowed with independent exits.",
    "- Within-account same-OCC, family limits, per-underlying limits, and global account caps remain enforced.",
    "- grind-smart-entries and vb-level-break step from two to four contracts; vb-macd-state remains four and every other channel remains two. The 1–6 chronological and capacity curves are retained in the JSON evidence.", "",
    "## Rollback", "",
    `Exact whole-roster rollback: \`${packet.rollback.manifestId}\` / \`${packet.rollback.manifestContentHash}\`.`,
    `Candidate to approve: \`${packet.candidate.manifest.id}\` / \`${packet.candidate.manifest.contentHash}\`.`,
    "Each channel is independently reversible; no failed experiment requires rolling back unrelated channels.", "",
    ...packet.roster.map((row: any) => `- **${row.channel}:** ${row.rollbackCondition}`), "",
    "## Remaining uncertainty", "",
    "- vb-macd-state stays protected because the exact current WIDE20/50 path is not reproducible from the historical-native path ledger; its weaker historical-native replay is not treated as a like-for-like verdict.",
    "- The proposed roster was selected using these same windows. The without-best-session and recent-window tests reduce, but do not eliminate, selection bias.",
    "- Exact Monday behavior still depends on quotes, fills, chronological overlap, and the live flat-boundary observation.",
    "- New trials need forward independent sessions before sizing or manager changes.", "",
    "## Dashboard trust cleanup", "",
    "Use the existing Studio and Research views only: show one canonical roster version, explicit TRADING versus OBSERVING labels, current executed versus historical virtual evidence, and one concise next decision. Keep hashes and methodology behind supporting evidence.", "",
    "## GO / NO-GO", "",
    "- **GO:** approve this exact candidate for a separately authorized activation after the flat-boundary, worker-compatibility, account-reachability, and authenticated-dashboard gates pass.",
    "- **NO-GO:** do not activate a partial subset, a different hash, a non-flat manifest, or any worker that cannot compile the bounded channel-specific ratchets.", "",
  ].join("\n");
}

async function main(): Promise<void> {
  validateWeekendMondayRoster();
  const tournamentText = readFileSync(tournamentFile, "utf8");
  const phenotypeText = readFileSync(phenotypeFile, "utf8");
  const tournament = JSON.parse(tournamentText);
  const phenotype = JSON.parse(phenotypeText);
  const sb = createServerSupabaseClient("prepare-weekend-monday-roster-2026-08-24");
  const [activeRead, operator, sourceRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb), exactOperator(sb),
    sb.from("strategists").select("id,slug,name,underlying,executor,account_id,status,is_active,spec_json,strategist_config(*)")
      .in("slug", [...TRIALS]).order("slug"),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") throw new Error("one exact active manifest is required");
  if (sourceRead.error) throw new Error(`candidate source read failed: ${sourceRead.error.message}`);
  const active = activeRead.compiled;
  if (active.manifest.contentHash !== tournament.activeManifest.contentHash) throw new Error("active manifest drifted from tournament base");
  const context = await loadChannelRosterBundleServerContext({ sb, active, now: GENERATED_AT });
  const proposalId = deterministicUuid(`${WEEKEND_MONDAY_ROSTER_VERSION}:${active.manifest.contentHash}`);
  const bySlug = new Map(active.channelSpecs.map((spec) => [spec.slug, spec]));
  const accountTemplateByName = new Map<string, ChannelSpecVersion>([
    ["Account 1", bySlug.get("momo-shape-2")!],
    ["Account 2", bySlug.get("vb-macd-state")!],
    ["Account 3", bySlug.get("orb-ustop-ctl")!],
  ]);
  const sources = (sourceRead.data ?? []) as SourceRow[];
  if (sources.length !== TRIALS.length) throw new Error(`expected ${TRIALS.length} trial sources, observed ${sources.length}`);
  const sourceBySlug = new Map(sources.map((source) => [source.slug, source]));
  const existing = active.channelSpecs.map((source) => changedExisting({ source,
    operatorId: operator.id, proposalId, accountTemplateByName }));
  const additions = TRIALS.map((slug) => {
    if (bySlug.has(slug)) throw new Error(`${slug}: unexpectedly already in active manifest`);
    const decision = WEEKEND_MONDAY_ROSTER.find((row) => row.channel === slug);
    const source = sourceBySlug.get(slug);
    if (!decision || !source) throw new Error(`${slug}: proposal decision or source missing`);
    return candidateSpec({ source, decision, accountTemplate: accountTemplateByName.get(decision.account)!,
      operatorId: operator.id, proposalId });
  });
  const specs = normalizeUnderlyingPriorities({ specs: [...existing, ...additions],
    baseBySlug: bySlug, proposalId, operatorId: operator.id });
  const policies = policiesFor(active.manifest.admissionPolicies, specs);
  const flat = context.live.complete && context.live.openOrders === 0 && context.live.positions.length === 0;
  const candidate = compileReleaseManifest({ ...active.manifest,
    id: `manifest:proposal:${proposalId}`, releaseId: `release:proposal:${proposalId}`,
    cohortId: `weekend-monday:${proposalId}`, admissionPolicyVersion: WEEKEND_MONDAY_ROSTER_VERSION,
    rollbackTargetManifestId: active.manifest.id, parentManifestId: active.manifest.id,
    createdBy: `operator:${operator.id}`, createdAt: GENERATED_AT, status: "draft",
    channelSpecs: specs, admissionPolicies: policies,
  }, {
    replaySufficiency: { ok: true,
      fact: "Paired chronological two- and three-week replays include manager, displacement, recent-window, and without-best-session checks.",
      evidenceRefs: ["monday-roster-tournament:2026-08-22", "channel-phenotype-study:2026-08-22"] },
    evidenceReadiness: { ok: true,
      fact: "Every paper channel has a native decision, shadow control, independent rollback condition, and bounded evidence purpose.",
      evidenceRefs: [WEEKEND_MONDAY_ROSTER_VERSION] },
    safeBoundary: { ok: flat,
      fact: flat ? "All supplied paper-account, order, and position observations are complete and flat."
        : "Activation remains blocked until a complete flat paper boundary is observed.",
      evidenceRefs: flat ? [`portfolio-flat:${context.live.observedAt}`] : [] },
  });
  const paperSlugs = candidate.channelSpecs.filter((row) => (row.executionPosture ?? "paper") === "paper")
    .map((row) => row.slug).sort();
  const intended = WEEKEND_MONDAY_ROSTER.map((row) => row.channel).sort();
  if (JSON.stringify(paperSlugs) !== JSON.stringify(intended)) throw new Error("candidate manifest paper roster differs from the ten-channel decision");
  const capacity = evaluatePortfolioCapacity({ specs: candidate.channelSpecs,
    admissionPolicies: candidate.manifest.admissionPolicies, envelope: context.envelope, live: context.live });
  const candidateBySlug = new Map(candidate.channelSpecs.map((row) => [row.slug, row]));
  const registrations = TRIALS.map((slug) => {
    const source = sourceBySlug.get(slug)!;
    const finalSpec = candidateBySlug.get(slug)!;
    const registrationSpec: ChannelSpecVersionDraft = { ...withoutHash(finalSpec),
      id: `spec:research:${slug}:weekend-monday-v1`, executionPosture: "observe-only",
      status: "validated", validFrom: GENERATED_AT, createdAt: GENERATED_AT };
    const row = registerResearchChannel({ id: `research:${slug}:qualified-${contentHash(registrationSpec).slice(7, 23)}`,
      channelId: source.id, slug, cartridge: cartridge(source, registrationSpec),
      candidateSpec: registrationSpec, declaredBlockers: [], registeredBy: `operator:${operator.id}`,
      registeredAt: GENERATED_AT });
    if (row.state !== "paper-eligible") throw new Error(`${slug}: local registration not paper-eligible: ${row.blockers.join("; ")}`);
    return { slug, state: row.state, contentHash: row.contentHash,
      sourceContentHash: sourceHash(source), productionWrites: 0 };
  });
  const changes = candidate.channelSpecs.flatMap((after) => {
    const fields = diff(bySlug.get(after.slug), after);
    return fields.length ? [{ channel: after.slug, fields }] : [];
  });
  const sizeCurves = Object.fromEntries(WEEKEND_MONDAY_ROSTER.map((row) => {
    const spec = candidateBySlug.get(row.channel)!;
    return [row.channel, [1, 2, 3, 4, 5, 6].map((quantity) => {
      const evaluation = evaluatePortfolioCapacity({
        specs: candidate.channelSpecs.map((candidateSpec) => candidateSpec.slug === row.channel
          ? scaled(candidateSpec, quantity) : candidateSpec),
        admissionPolicies: candidate.manifest.admissionPolicies,
        envelope: context.envelope, live: context.live,
      });
      return { quantity, capacity: evaluation.state,
        wholeLotCompatible: !(spec.takeProfit.fraction === 0.5 && quantity % 2 !== 0),
        selected: quantity === row.quantity, blockers: evaluation.blockers,
        chronologicalReplay: tournament.recommendations.sizeReplay[row.channel]?.[String(quantity)] ?? null };
    })];
  }));
  const recommended = tournament.recommendations.rosterTournament.recommended;
  if (JSON.stringify(recommended.channels) !== JSON.stringify(intended)) throw new Error("frozen tournament recommendation drifted");
  const proposedExact = tournament.recommendations.proposedExact;
  if (JSON.stringify(proposedExact.channels) !== JSON.stringify(intended)) throw new Error("exact proposed replay roster drifted");
  const blockers = [...candidate.validationResults.filter((row) => row.state !== "pass")
    .map((row) => `${row.gate}:${row.code}`), ...capacity.blockers].sort();
  const dossiers = WEEKEND_MONDAY_ROSTER.map((row) => ({ ...row,
    phenotype: phenotype.channels?.find((candidateRow: any) => candidateRow.channel === row.channel) ?? null,
    openLane: tournament.recommendations.openLane.find((candidateRow: any) => candidateRow.channel === row.channel) ?? null,
    coreMarginal: tournament.recommendations.coreMarginal[row.channel] ?? null,
    sizeCurve: sizeCurves[row.channel],
  }));
  const packet = {
    schemaVersion: 1, version: WEEKEND_MONDAY_ROSTER_VERSION,
    generatedAt: GENERATED_AT, targetSession: WEEKEND_MONDAY_TARGET_SESSION,
    state: blockers.length ? "proposal-blocked" : "ready-for-separate-operator-approval",
    roster: WEEKEND_MONDAY_ROSTER, observeTransitions: WEEKEND_MONDAY_OBSERVE_TRANSITIONS,
    candidateDisposition: {
      paperPromotions: ["grind-smart-entries", "vb-curl-reversal-iwm", "vb-gap-drift-qqq",
        "vb-or-fail-iwm", "orb-trend-rider", "pb-ride"],
      observeTransitions: [...WEEKEND_MONDAY_OBSERVE_TRANSITIONS],
      holds: ["breakout-smart-entries"],
      newRetirements: [],
      existingRetirements: "unchanged",
    },
    searchCoverage: {
      phenotypeChannels: phenotype.channels?.length ?? 0,
      routeManagerScenarios: tournament.tournament?.length ?? 0,
      constrainedTenChannelRosters: tournament.recommendations.rosterTournament.evaluated,
      selectedRawRank: tournament.recommendations.rosterTournament.top.findIndex((row: any) =>
        JSON.stringify(row.channels) === JSON.stringify(intended)) + 1,
      scope: "active, observe, dark, retired, and sibling phenotype inventory",
    },
    portfolioReplay: { twoWeek: proposedExact.windows["two-week"],
      threeWeek: proposedExact.windows["three-week"],
      conservativeLastPriorityReplay: recommended.windows,
      selectionWarning: "The roster was selected on these same windows; forward paper validation remains required." },
    openLaneReplay: tournament.recommendations.combinedOpenLanes,
    registrations, dossiers,
    base: { manifestId: active.manifest.id, manifestContentHash: active.manifest.contentHash,
      specCount: active.channelSpecs.length },
    candidate, manifestDiff: { changes, beforeSpecCount: active.channelSpecs.length,
      afterSpecCount: candidate.channelSpecs.length, paperChannels: paperSlugs.length,
      observeChannels: candidate.channelSpecs.length - paperSlugs.length },
    capacity, blockers,
    collisionPolicy: { crossAccountSameOcc: "permitted with independent exits",
      withinAccountSameOcc: "enforced", withinAccountFamily: "enforced",
      priorities: Object.fromEntries(["Account 1", "Account 2", "Account 3"].map((account) => [account,
        WEEKEND_MONDAY_ROSTER.filter((row) => row.account === account)
          .sort((left, right) => left.priority - right.priority).map((row) => row.channel)])) },
    rollback: { manifestId: active.manifest.id, manifestContentHash: active.manifest.contentHash,
      independentlyReversible: true,
      perChannel: Object.fromEntries(WEEKEND_MONDAY_ROSTER.map((row) => [row.channel, row.rollbackCondition])) },
    dashboardCleanup: { newSurface: false, canonicalRosterVersion: WEEKEND_MONDAY_ROSTER_VERSION,
      firstGlance: ["TRADING or OBSERVING", "current executed or historical virtual",
        "typical profit conversion", "next decision", "evidence freshness"],
      progressiveDisclosure: ["full manager comparisons", "methodology", "hashes", "provenance"] },
    goNoGo: { recommendation: blockers.length ? "NO-GO until blockers clear" : "GO after separate approval",
      activationGates: ["fresh complete flat boundary", "exact candidate hash approved",
        "compatible worker commit deployed", "all three paper accounts reachable",
        "zero open orders and congruent books", "authenticated dashboard smoke"] },
    limitations: [
      "Historical virtual paths are comparative research, not executable portfolio P&L.",
      "Current WIDE20/50 evidence for vb-macd-state lacks a like-for-like historical-native replay and remains a protected forward test.",
      "Recent-window and without-best-session checks reduce but do not remove selection bias.",
      "New trials require forward independent sessions before sizing or manager conclusions.",
      "Capacity checks are envelope projections; exact Monday quotes and fills remain unknown.",
    ],
    authority: { productionWrites: 0, registrationWrites: 0, manifestWrites: 0,
      activation: false, push: false, merge: false, deploy: false,
      workerMutation: false, orderAuthority: false },
    inputs: { tournamentSha256: createHash("sha256").update(tournamentText).digest("hex"),
      phenotypeSha256: createHash("sha256").update(phenotypeText).digest("hex") },
  };
  const json = `${JSON.stringify(packet, null, 2)}\n`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "sunday-decision-packet.json"), json);
  writeFileSync(resolve(outputDir, "sunday-decision-packet.md"), `${markdown(packet)}\n`);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({
    generatedAt: GENERATED_AT, baseManifestId: active.manifest.id,
    baseManifestContentHash: active.manifest.contentHash,
    candidateManifestId: candidate.manifest.id,
    candidateManifestContentHash: candidate.manifest.contentHash,
    candidateValidationReady: candidate.validationReady,
    capacityState: capacity.state, paperChannels: paperSlugs.length,
    registrationStates: registrations.map((row) => ({ slug: row.slug, state: row.state,
      contentHash: row.contentHash })), packetSha256: createHash("sha256").update(json).digest("hex"),
    productionWrites: 0, activation: false, push: false, merge: false, deploy: false,
    orderAuthority: false,
  }, null, 2)}\n`);
  console.log(`prepare-weekend-monday-roster: ${blockers.length ? "BLOCKED" : "PASS"}`);
  console.log(`  candidate: ${candidate.manifest.contentHash}`);
  console.log(`  paper: ${paperSlugs.length} · observe: ${candidate.channelSpecs.length - paperSlugs.length}`);
  console.log(`  capacity: ${capacity.state} · local registrations: ${registrations.map((row) => row.state).join(",")}`);
  console.log(`  production writes: 0 · output: ${outputDir}`);
  if (blockers.length) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
