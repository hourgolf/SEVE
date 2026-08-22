// Build the exact, reversible next-week paper roster candidate. This command is
// SELECT/GET-only: it writes local packet artifacts, never production state.

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
  type ChannelSpecVersion,
  type ChannelSpecVersionDraft,
} from "../lib/channels/channelControlPlane";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { evaluatePortfolioCapacity } from "../lib/channels/channelPortfolioCapacity";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import {
  NEXT_WEEK_BASE_MANIFEST_HASH,
  NEXT_WEEK_BASE_MANIFEST_ID,
  NEXT_WEEK_OBSERVE_ONLY,
  NEXT_WEEK_ROSTER_DECISIONS,
  NEXT_WEEK_ROSTER_SESSION,
  NEXT_WEEK_ROSTER_VERSION,
  boundedWeekReplay,
  validateNextWeekDecisionPlan,
} from "../lib/channels/nextWeekRoster20260824";
import { createServerSupabaseClient } from "./serverSupabase";

const ACCOUNT_1 = "cd817549-e025-4d38-805e-d32e607052f7";

const value = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1])
    : fallback;
};

const envFile = resolve(value(
  "env-file",
  process.env.SEVE_ENV_FILE ?? ".env.local",
));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const outputDir = resolve(value(
  "output-dir",
  `data/next-week-roster/${NEXT_WEEK_ROSTER_SESSION}`,
));
const weekReviewFile = resolve(value(
  "week-review-file",
  "/private/tmp/seve-week-review-20260821/week-review.json",
));
if (!existsSync(weekReviewFile)) {
  throw new Error(`week review not found: ${weekReviewFile}`);
}

interface SourceRow {
  id: string;
  slug: string;
  name: string;
  underlying: string;
  executor: string;
  account_id: string;
  status: string;
  is_active: boolean;
  spec_json: unknown;
  strategist_config: Record<string, unknown> | Record<string, unknown>[] | null;
}

interface WeeklyRow {
  channel: string;
  actualPnl: number;
  bestManager?: { id: string; totalDelta: number } | null;
}

interface WeekReview {
  start: string;
  end: string;
  channels: WeeklyRow[];
}

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex")
    .slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const joined = chars.join("");
  return [
    joined.slice(0, 8), joined.slice(8, 12), joined.slice(12, 16),
    joined.slice(16, 20), joined.slice(20),
  ].join("-");
}

function withoutHash(spec: ChannelSpecVersion): ChannelSpecVersionDraft {
  const { contentHash: _contentHash, ...draft } = spec;
  return draft;
}

function config(source: SourceRow): Record<string, unknown> {
  const row = Array.isArray(source.strategist_config)
    ? source.strategist_config[0]
    : source.strategist_config;
  if (!row) throw new Error(`${source.slug}: strategist configuration missing`);
  return row;
}

function sourceHash(source: SourceRow): string {
  return contentHash({
    id: source.id,
    slug: source.slug,
    name: source.name,
    underlying: source.underlying,
    executor: source.executor,
    accountId: source.account_id,
    status: source.status,
    isActive: source.is_active,
    specJson: source.spec_json,
    strategistConfig: config(source),
  });
}

async function exactOperator(
  sb: ReturnType<typeof createServerSupabaseClient>,
): Promise<User> {
  const result = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (result.error) throw new Error(`operator inventory failed: ${result.error.message}`);
  const operators = result.data.users.filter(isDeskOperator);
  if (operators.length !== 1) {
    throw new Error(`expected one desk operator, observed ${operators.length}`);
  }
  return operators[0];
}

function proposalSpec(input: {
  source: ChannelSpecVersion;
  proposalId: string;
  operatorId: string;
  createdAt: string;
  quantity?: number;
  priority?: number;
  executionPosture?: "paper" | "observe-only";
  manager?: "WIDE20/50" | "LOCK50/30";
}): ChannelSpecVersionDraft {
  const source = input.source;
  const quantity = input.quantity ?? source.quantity;
  const premiumCap = Number(source.entryParameters.premiumCap);
  const maxDebitUsd = Math.round(premiumCap * quantity * 10000) / 100;
  const priorRiskRatio = source.maxDebitUsd > 0
    ? source.riskLimits.maxRiskUsd / source.maxDebitUsd
    : 0;
  let takeProfit = structuredClone(source.takeProfit);
  let stopLoss = structuredClone(source.stopLoss);
  let ratchetParameters = structuredClone(source.ratchetParameters);
  let managerProfileId = source.managerProfileId;
  let managerVersion = source.managerVersion;
  let exitParameters = structuredClone(source.exitParameters);
  let maxRiskUsd = Math.round(maxDebitUsd * priorRiskRatio * 100) / 100;
  if (input.manager) {
    const targetPct = input.manager === "WIDE20/50" ? 20 : 50;
    const stopPct = input.manager === "WIDE20/50" ? 50 : 30;
    managerProfileId = input.manager === "WIDE20/50"
      ? "VB-MACD-WIDE20-50"
      : "VB-LEVEL-LOCK50-30";
    takeProfit = { kind: "bank", targetPct, fraction: 0 };
    stopLoss = {
      catastrophePct: stopPct,
      priceBasis: "executable-option-bid",
    };
    ratchetParameters = {
      kind: "none", engageReturnPct: null, givebackPct: null,
      retainGainPct: null, fixedTargetPct: null,
    };
    exitParameters = {
      ...exitParameters,
      managerLabel: `ALL OUT +${targetPct}% · STOP -${stopPct}%`,
    };
    managerVersion = managerPolicyContentHash({
      managerProfileId,
      takeProfit,
      stopLoss,
      ratchetParameters,
      liquidationEt: exitParameters.eodEt ?? "15:25",
    });
    maxRiskUsd = Math.round(maxDebitUsd * stopPct) / 100;
  }
  return {
    ...withoutHash(source),
    id: `spec:proposal:${input.proposalId}:${source.slug}`,
    parentVersionId: source.id,
    quantity,
    priority: input.priority ?? source.priority,
    maxDebitUsd,
    riskLimits: {
      maxContracts: quantity,
      maxDebitUsd,
      maxRiskUsd,
    },
    managerProfileId,
    managerVersion,
    takeProfit,
    stopLoss,
    ratchetParameters,
    exitParameters,
    executionPosture: input.executionPosture
      ?? source.executionPosture ?? "paper",
    validFrom: input.createdAt,
    validUntil: null,
    createdAt: input.createdAt,
    createdBy: `operator:${input.operatorId}`,
    status: "draft",
  };
}

function candidateSpec(input: {
  source: SourceRow;
  proposalId: string;
  operatorId: string;
  createdAt: string;
  priority: number;
}): ChannelSpecVersionDraft {
  const source = input.source;
  const settings = config(source);
  const expected = source.slug === "vb-curl-reversal-qqq"
    ? { underlying: "QQQ", target: 20, family: "QQQ-CURL-REVERSAL", manager: "VB-CURL-QQQ-ALL-OUT-20" }
    : source.slug === "vb-rsi-revert-iwm"
      ? { underlying: "IWM", target: 15, family: "IWM-RSI-REVERT", manager: "VB-RSI-IWM-ALL-OUT-15" }
      : null;
  if (!expected || source.underlying !== expected.underlying
      || source.executor !== "stream" || source.is_active !== true
      || source.spec_json == null
      || Number(settings.entry_dte) !== 0
      || Number(settings.strike_offset) !== 0
      || Number(settings.take_profit_pct) !== expected.target
      || Number(settings.premium_stop_pct) !== 30
      || (settings.event_policy ?? "standdown") !== "standdown") {
    throw new Error(`${source.slug}: candidate source identity or settings drifted`);
  }
  const takeProfit = {
    kind: "bank" as const,
    targetPct: expected.target,
    fraction: 0 as const,
  };
  const stopLoss = {
    catastrophePct: 30,
    priceBasis: "executable-option-bid" as const,
  };
  const ratchetParameters = {
    kind: "none" as const,
    engageReturnPct: null,
    givebackPct: null,
    retainGainPct: null,
    fixedTargetPct: null,
  };
  return {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: `spec:proposal:${input.proposalId}:${source.slug}`,
    channelId: source.id,
    slug: source.slug,
    strategyIdentity: `strategists/${source.id}/compiled-spec`,
    strategyVersion: sourceHash(source),
    signalVersion: `next-week:${sourceHash(source)}`,
    managerProfileId: expected.manager,
    managerVersion: managerPolicyContentHash({
      managerProfileId: expected.manager,
      takeProfit,
      stopLoss,
      ratchetParameters,
      liquidationEt: "15:25",
    }),
    accountId: ACCOUNT_1,
    accountRole: "FIRST-TEAM",
    accountMode: "paper",
    symbolScope: [expected.underlying],
    familyId: expected.family,
    cohort: "control",
    priority: input.priority,
    quantity: 2,
    maxDebitUsd: 600,
    entryParameters: {
      entryDte: 0,
      strikeOffset: 0,
      premiumCap: 3,
      eventPolicy: "standdown",
      maxEntriesPerSession: 1,
    },
    exitParameters: {
      accountName: "FIRST-TEAM",
      managerLabel: `ALL OUT +${expected.target}% · STOP -30%`,
      eodEt: "15:25",
      priceBasis: "executable-option-bid",
    },
    takeProfit,
    stopLoss,
    ratchetParameters,
    reentryPolicy: "disabled",
    scalePolicy: { adds: 0, pyramiding: "disabled" },
    collisionDomain: "rc54-control",
    riskLimits: {
      maxContracts: 2,
      maxDebitUsd: 600,
      maxRiskUsd: 180,
    },
    executionPosture: "paper",
    validFrom: input.createdAt,
    validUntil: null,
    createdBy: `operator:${input.operatorId}`,
    createdAt: input.createdAt,
    parentVersionId: null,
    status: "draft",
  };
}

function policiesFor(
  activePolicies: readonly AdmissionPolicySpec[],
  specs: readonly ChannelSpecVersionDraft[],
): AdmissionPolicySpec[] {
  return projectAdmissionPolicyReentry(activePolicies.map((policy) => ({
    ...structuredClone(policy),
    priorityBySlug: Object.fromEntries(specs
      .filter((spec) => spec.collisionDomain === policy.id)
      .map((spec) => [spec.slug, spec.priority])),
  })), specs);
}

function money(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : "-"}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

function markdown(packet: any): string {
  const rows = packet.decisions as typeof NEXT_WEEK_ROSTER_DECISIONS;
  const replay = packet.weekReplay as ReturnType<typeof boundedWeekReplay>;
  return [
    "# Next-week roster candidate · Monday 2026-08-24",
    "",
    "**PREVIEW ONLY · READ-ONLY PREPARATION · NO PRODUCTION WRITES OR ACTIVATION**",
    "",
    "## Verdict",
    "",
    "Use a 10-channel paper roster: eight retained channels plus one new QQQ trial and one new IWM trial. Return eight weak trials to observe-only so their virtual and manager evidence continues without consuming paper capacity.",
    "",
    "## Paper roster",
    "",
    "| Account | Channel | Size | Native manager | Change |",
    "|---|---|---:|---|---|",
    ...rows.map((row) => `| ${row.account} | ${row.channel} | ${row.proposedQuantity} | ${row.proposedManager} | ${row.action.replaceAll("_", " ")} |`),
    "",
    "## Return to observe-only",
    "",
    NEXT_WEEK_OBSERVE_ONLY.map((slug) => `- ${slug}`).join("\n"),
    "",
    "## What changes",
    "",
    "- momo-shape-2, orb-ustop-ctl, and grind-v3: reduce 6/4/4 contracts to 2; entry and exit stay fixed.",
    "- vb-macd-state: WIDE20/50 becomes native at four contracts; +18/-30 becomes the paired shadow control.",
    "- vb-level-break: LOCK50/30 becomes native at two contracts; +25/-30 becomes the paired shadow control.",
    "- Account 3 remains orb-ustop-ctl → breakout-alt-v3-itm → grind-v3. Only breakout-alt-v3-itm retains bounded overflow eligibility.",
    "- Cross-account same-OCC remains permitted with independent exits; within-account same-OCC protection remains unchanged.",
    "",
    "## Directional replay of last week",
    "",
    `- Actual desk: ${money(replay.actualDeskPnlUsd)}.`,
    `- Moving eight losing trials to observe-only: ${money(replay.observeOnlyAvoidanceUsd)} difference.`,
    `- Contract reductions: ${money(replay.sizingDifferenceUsd)} difference.`,
    `- Two matched-trade manager changes: ${money(replay.managerDifferenceUsd)} difference.`,
    `- Directional replay: **${money(replay.directionalReplayUsd)}**, before capacity/displacement and with no profit credited to the new QQQ/IWM trials.`,
    "",
    "This is not a forecast. It is a bounded attribution check using the same week's actual trades and matched manager paths.",
    "",
    "## Activation order after approval",
    "",
    "1. Publish exact research registrations for vb-curl-reversal-qqq and vb-rsi-revert-iwm.",
    "2. Publish the two native-manager swaps and their displaced shadow controls.",
    "3. Publish the quantity/posture/priority candidate manifest.",
    "4. Activate only at a complete flat boundary; require worker acknowledgement of the exact manifest hash.",
    "5. Verify all three paper accounts, zero open orders, receipt-bound routes, dashboard projections, and next-session shadow coverage.",
    "",
    `Rollback target: \`${packet.base.manifestId}\`.`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  validateNextWeekDecisionPlan();
  const generatedAt = new Date().toISOString();
  const sb = createServerSupabaseClient("prepare-next-week-roster-2026-08-24");
  const [activeRead, operator, sourceRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    exactOperator(sb),
    sb.from("strategists")
      .select("id,slug,name,underlying,executor,account_id,status,is_active,spec_json,strategist_config(*)")
      .in("slug", ["vb-curl-reversal-qqq", "vb-rsi-revert-iwm"])
      .order("slug"),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active manifest is required");
  }
  if (sourceRead.error) throw new Error(`candidate source read failed: ${sourceRead.error.message}`);
  const active = activeRead.compiled;
  if (active.manifest.id !== NEXT_WEEK_BASE_MANIFEST_ID
      || active.manifest.contentHash !== NEXT_WEEK_BASE_MANIFEST_HASH) {
    throw new Error("active manifest drifted from the frozen next-week base");
  }
  const context = await loadChannelRosterBundleServerContext({
    sb,
    active,
    now: generatedAt,
  });
  const proposalId = deterministicUuid([
    NEXT_WEEK_ROSTER_VERSION,
    active.manifest.contentHash,
    JSON.stringify(NEXT_WEEK_ROSTER_DECISIONS),
    JSON.stringify(NEXT_WEEK_OBSERVE_ONLY),
  ].join(":"));
  const bySlug = new Map(active.channelSpecs.map((spec) => [spec.slug, spec]));
  const decisions = new Map(NEXT_WEEK_ROSTER_DECISIONS.map((row) => [row.channel, row]));
  for (const decision of NEXT_WEEK_ROSTER_DECISIONS) {
    if (decision.currentQuantity == null) continue;
    const current = bySlug.get(decision.channel);
    if (!current || current.quantity !== decision.currentQuantity
        || current.managerProfileId !== decision.currentManager
        || (current.executionPosture ?? "paper") !== "paper") {
      throw new Error(`${decision.channel}: live receipt drifted from the reviewed configuration`);
    }
  }
  for (const channel of NEXT_WEEK_OBSERVE_ONLY) {
    const current = bySlug.get(channel);
    if (!current || (current.executionPosture ?? "paper") !== "paper") {
      throw new Error(`${channel}: expected current paper posture`);
    }
  }
  const changedExisting = active.channelSpecs.map((spec) => {
    const decision = decisions.get(spec.slug);
    const observe = NEXT_WEEK_OBSERVE_ONLY.includes(
      spec.slug as typeof NEXT_WEEK_OBSERVE_ONLY[number],
    );
    const transitionPriority: Record<string, number> = {
      "orb-qqq-trail": 2,
      "breakout-alt-v3-iwm": 2,
      "grind-v3-2": 5,
      "vb-gap-drift": 6,
    };
    const priority = decision?.priority
      ?? transitionPriority[spec.slug]
      ?? spec.priority;
    const manager = decision?.action === "change_manager"
      ? decision.channel === "vb-macd-state" ? "WIDE20/50" as const
        : "LOCK50/30" as const
      : undefined;
    const semanticChange = observe
      || decision?.proposedQuantity !== decision?.currentQuantity
      || (decision != null && decision.priority !== spec.priority)
      || manager != null
      || priority !== spec.priority;
    return semanticChange ? proposalSpec({
      source: spec,
      proposalId,
      operatorId: operator.id,
      createdAt: generatedAt,
      quantity: decision?.proposedQuantity,
      priority,
      executionPosture: observe ? "observe-only"
        : decision ? "paper" : undefined,
      manager,
    }) : withoutHash(spec);
  });
  const sources = (sourceRead.data ?? []) as SourceRow[];
  if (sources.length !== 2) throw new Error(`expected two trial sources, observed ${sources.length}`);
  const sourceBySlug = new Map(sources.map((source) => [source.slug, source]));
  const additions = ["vb-curl-reversal-qqq", "vb-rsi-revert-iwm"].map((slug) => {
    if (bySlug.has(slug)) throw new Error(`${slug}: unexpectedly already in active manifest`);
    const source = sourceBySlug.get(slug);
    const decision = decisions.get(slug);
    if (!source || !decision) throw new Error(`${slug}: proposal source missing`);
    return candidateSpec({
      source,
      proposalId,
      operatorId: operator.id,
      createdAt: generatedAt,
      priority: decision.priority,
    });
  });
  const specs = [...changedExisting, ...additions];
  const policies = policiesFor(active.manifest.admissionPolicies, specs);
  const flat = context.live.complete && context.live.openOrders === 0
    && context.live.positions.length === 0;
  const candidate = compileReleaseManifest({
    ...active.manifest,
    id: `manifest:proposal:${proposalId}`,
    releaseId: `release:proposal:${proposalId}`,
    cohortId: `next-week-roster:${proposalId}`,
    admissionPolicyVersion: NEXT_WEEK_ROSTER_VERSION,
    rollbackTargetManifestId: active.manifest.id,
    parentManifestId: active.manifest.id,
    createdBy: `operator:${operator.id}`,
    createdAt: generatedAt,
    status: "draft",
    channelSpecs: specs,
    admissionPolicies: policies,
  }, {
    replaySufficiency: {
      ok: true,
      fact: "The packet uses the completed 2026-08-17 through 2026-08-21 logical-trade ledger, matched manager paths, and Decision Atlas evidence.",
      evidenceRefs: [
        "week-review:2026-08-17:2026-08-21",
        "decision-atlas:through-2026-08-21",
      ],
    },
    evidenceReadiness: {
      ok: true,
      fact: "Every native change is channel-specific, paired to its displaced control, and independently reversible.",
      evidenceRefs: [
        "manager-frontier:through-2026-08-21",
        "entry-atlas:through-2026-08-21",
      ],
    },
    safeBoundary: {
      ok: flat,
      fact: flat
        ? "All supplied paper-account, order, and position observations are complete and flat."
        : "Activation remains blocked until a complete flat paper boundary is observed.",
      evidenceRefs: flat ? [`portfolio-flat:${context.live.observedAt}`] : [],
    },
  });
  const capacity = evaluatePortfolioCapacity({
    specs: candidate.channelSpecs,
    admissionPolicies: candidate.manifest.admissionPolicies,
    envelope: context.envelope,
    live: context.live,
  });
  const weekReviewText = readFileSync(weekReviewFile, "utf8");
  const weekReview = JSON.parse(weekReviewText) as WeekReview;
  if (weekReview.start !== "2026-08-17" || weekReview.end !== "2026-08-21") {
    throw new Error("weekly review window drifted");
  }
  const weekReplay = boundedWeekReplay(weekReview.channels);
  const blockers = [
    ...candidate.validationResults.filter((row) => row.state !== "pass")
      .map((row) => `${row.gate}:${row.code}`),
    ...capacity.blockers,
  ].sort();
  const packet = {
    schemaVersion: 1,
    version: NEXT_WEEK_ROSTER_VERSION,
    generatedAt,
    targetSession: NEXT_WEEK_ROSTER_SESSION,
    state: blockers.length ? "blocked" : "ready-for-operator-approval",
    base: {
      manifestId: active.manifest.id,
      manifestContentHash: active.manifest.contentHash,
    },
    decisions: NEXT_WEEK_ROSTER_DECISIONS,
    observeOnly: NEXT_WEEK_OBSERVE_ONLY,
    trialSources: sources.map((source) => ({
      channel: source.slug,
      channelId: source.id,
      sourceContentHash: sourceHash(source),
      underlying: source.underlying,
      exactSpecAvailable: source.spec_json != null,
    })),
    weekReplay,
    candidate,
    capacity,
    blockers,
    sequencing: [
      "publish exact trial registrations",
      "publish native-manager swaps and displaced shadow controls",
      "publish roster candidate",
      "activate at complete flat boundary",
      "require exact worker acknowledgement and authenticated dashboard smoke",
    ],
    rollback: {
      manifestId: active.manifest.id,
      manifestContentHash: active.manifest.contentHash,
      independentlyReversible: true,
    },
    authority: {
      productionWrites: 0,
      registrationWrites: 0,
      manifestWrites: 0,
      activation: false,
      workerMutation: false,
      orderAuthority: false,
    },
    inputs: {
      weekReviewSha256: createHash("sha256").update(weekReviewText).digest("hex"),
    },
  };
  const json = `${JSON.stringify(packet, null, 2)}\n`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "packet.json"), json);
  writeFileSync(resolve(outputDir, "packet.md"), `${markdown(packet)}\n`);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({
    generatedAt,
    targetSession: NEXT_WEEK_ROSTER_SESSION,
    baseManifestId: active.manifest.id,
    baseManifestContentHash: active.manifest.contentHash,
    candidateManifestId: candidate.manifest.id,
    candidateManifestContentHash: candidate.manifest.contentHash,
    candidateValidationReady: candidate.validationReady,
    capacityState: capacity.state,
    packetSha256: createHash("sha256").update(json).digest("hex"),
    productionWrites: 0,
    activation: false,
    orderAuthority: false,
  }, null, 2)}\n`);
  console.log(`prepare-next-week-roster-2026-08-24: ${blockers.length ? "BLOCKED" : "PASS"}`);
  console.log(`  paper channels: ${NEXT_WEEK_ROSTER_DECISIONS.length}`);
  console.log(`  observe-only transitions: ${NEXT_WEEK_OBSERVE_ONLY.length}`);
  console.log(`  candidate manifest: ${candidate.manifest.contentHash}`);
  console.log(`  capacity: ${capacity.state} · production writes: 0`);
  console.log(`  output: ${outputDir}`);
  if (blockers.length) {
    console.error(`  blockers: ${blockers.join("; ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`prepare-next-week-roster-2026-08-24: FAIL · ${
    error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
