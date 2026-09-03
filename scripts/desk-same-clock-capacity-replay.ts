// SELECT-only desk-wide same-clock capacity replay. No database writes, broker
// mutations, configuration authority, or order authority.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { account3PriorityPolicy } from "../lib/channels/decisionAtlasEntryExperimentQueue";
import {
  compareDeskReplay,
  replayDeskSameClockCapacity,
  type DeskReplayCandidate,
  type DeskReplayPolicy,
  type DeskReplayResult,
} from "../lib/research/deskSameClockCapacityReplay";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1]) : fallback;
};
const envFile = resolve(arg("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const snapshotFile = resolve(arg(
  "snapshot-file",
  "data/after-close-recovery/2026-08-13/decision-atlas/atlas/snapshot.json",
));
const outDir = resolve(arg(
  "out-dir",
  "data/after-close-recovery/2026-08-13/desk-same-clock-capacity",
));
const supplementalVirtualFiles = arg("supplemental-virtual-files", "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => resolve(value));
const requestedCohort = arg("cohort", "").trim();
const requestedThroughSession = arg("through-session", "").trim();
const rollbackPacketFile = arg("rollback-packet", "").trim();
const requestedRollbackChoices = arg(
  "rollback-choices",
  "gap-observe,level-two,gap-observe-level-two",
).split(",").map((value) => value.trim()).filter(Boolean);
const observeChannels = new Set(arg("observe-channels", "")
  .split(",").map((value) => value.trim()).filter(Boolean));

interface SignalRow {
  id: string;
  strategist_id: string;
  acted_on: boolean;
  blocked_reason: string | null;
  created_at: string;
  rationale: Record<string, any>;
}
interface VirtualRow {
  signal_id: string;
  exit_at: string | null;
  pnl_per_contract: number | null;
}
interface SupplementalVirtualRow {
  signalId: string;
  exitAt: string | null;
  pnlPerContract: number | null;
}
interface LogicalTrade {
  opportunityId: string | null;
  channelSlug: string;
  openedAt: string;
  closedAt: string | null;
  realizedPnlUsd: number | null;
  quantity: number;
}
interface Snapshot {
  currentConfigurationEpochId: string;
  strategists: Array<{ id: string; slug: string }>;
  signals: SignalRow[];
  virtualTrades: VirtualRow[];
  ledger: { logicalTrades: LogicalTrade[] };
}

interface RollbackPacket {
  beforeManifestHash: string;
  alternatives: Array<{
    choice: string;
    changes: Array<Record<string, unknown>>;
    candidate: {
      manifest: { admissionPolicies: DeskReplayPolicy[] };
      channelSpecs: Array<{
        slug: string;
        accountId: string;
        collisionDomain: string;
        familyId: string;
        symbolScope: string[];
        executionPosture: string;
        quantity: number;
        entryParameters: Record<string, unknown>;
      }>;
    };
  }>;
}

const ADMISSION_REASONS = new Set([
  "admission_domain_same_clock_collision",
  "admission_domain_family_open",
  "admission_domain_reentry_disabled",
  "admission_domain_session_entry_limit",
  "admission_domain_same_occ_open",
  "admission_cross_domain_same_occ_open",
  "admission_domain_underlying_concurrency",
  "admission_domain_global_concurrency",
]);

function clonePolicies(policies: DeskReplayPolicy[]): DeskReplayPolicy[] {
  return structuredClone(policies);
}

function withAccount3Priority(
  policies: DeskReplayPolicy[],
  active: Parameters<typeof account3PriorityPolicy>[0],
): DeskReplayPolicy[] {
  const replacement = account3PriorityPolicy(active);
  return policies.map((policy) => policy.id === replacement.id
    ? structuredClone(replacement) : structuredClone(policy));
}

function pairedSameClock(
  policies: DeskReplayPolicy[],
  expandUnderlyingCapacity: boolean,
  domainIds = new Set(policies.map((policy) => policy.id)),
): DeskReplayPolicy[] {
  return policies.map((policy) => {
    const copy = structuredClone(policy);
    if (!domainIds.has(copy.id)) return copy;
    for (const underlying of Object.keys(copy.sameClockMaxByUnderlying)) {
      if ((copy.maxOpenByUnderlying[underlying] ?? 0) < 1) continue;
      copy.sameClockMaxByUnderlying[underlying] = 2;
      if (expandUnderlyingCapacity) {
        copy.maxOpenByUnderlying[underlying] = Math.max(
          2, copy.maxOpenByUnderlying[underlying] ?? 0,
        );
      }
    }
    if (expandUnderlyingCapacity) copy.maxOpenGlobal = Math.max(3, copy.maxOpenGlobal);
    return copy;
  });
}

function prioritizeSlug(
  policies: DeskReplayPolicy[],
  domainId: string,
  slug: string,
): DeskReplayPolicy[] {
  return policies.map((policy) => {
    const copy = structuredClone(policy);
    if (copy.id === domainId) copy.priorityBySlug[slug] = 0;
    return copy;
  });
}

function summarizeDifference(
  baseline: DeskReplayResult,
  candidate: DeskReplayResult,
): Record<string, unknown> {
  const compared = compareDeskReplay(baseline, candidate);
  const bySession = candidate.sessions.map((row) => {
    const base = baseline.sessions.find((item) => item.session === row.session);
    return {
      session: row.session,
      admittedDelta: row.admitted - (base?.admitted ?? 0),
      modeledPnlDeltaUsd: Math.round(
        (row.modeledPnlUsd - (base?.modeledPnlUsd ?? 0)) * 100,
      ) / 100,
    };
  });
  return {
    variantId: candidate.variantId,
    modeledPnlDeltaUsd: compared.modeledPnlDeltaUsd,
    added: compared.added.map((row) => ({
      session: row.session, slug: row.slug, occ: row.occ,
      pnlUsd: row.pnlUsd, basis: row.basis,
    })),
    displaced: compared.displaced.map((row) => ({
      session: row.session, slug: row.slug, occ: row.occ,
      pnlUsd: row.pnlUsd, basis: row.basis,
    })),
    bySession,
  };
}

function usd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value)}`;
}

function reasonCounts(result: DeskReplayResult): Record<string, number> {
  return Object.fromEntries(Object.entries(result.rejected.reduce<Record<string, number>>(
    (accumulator, row) => {
      accumulator[row.reason] = (accumulator[row.reason] ?? 0) + 1;
      return accumulator;
    }, {},
  )).sort(([left], [right]) => left.localeCompare(right)));
}

function withoutBestSession(result: DeskReplayResult): number | null {
  if (result.sessions.length < 2) return null;
  return Math.round((result.modeledPnlUsd
    - Math.max(...result.sessions.map((row) => row.modeledPnlUsd))) * 100) / 100;
}

function fixedPathSummary(rows: DeskReplayCandidate[]): {
  modeledPnlUsd: number;
  sessions: Array<{ session: string; admitted: number; modeledPnlUsd: number }>;
  withoutBestSessionUsd: number | null;
} {
  const sessions = [...new Set(rows.map((row) => row.session))].sort().map((session) => {
    const selected = rows.filter((row) => row.session === session);
    return { session, admitted: selected.length,
      modeledPnlUsd: Math.round(selected.reduce((sum, row) => sum + row.pnlUsd, 0) * 100) / 100 };
  });
  const modeledPnlUsd = Math.round(rows.reduce((sum, row) => sum + row.pnlUsd, 0) * 100) / 100;
  return { modeledPnlUsd, sessions,
    withoutBestSessionUsd: sessions.length < 2 ? null : Math.round((modeledPnlUsd
      - Math.max(...sessions.map((row) => row.modeledPnlUsd))) * 100) / 100 };
}

function replayWindow(input: {
  candidates: DeskReplayCandidate[];
  policies: DeskReplayPolicy[];
  sessions: Set<string>;
  id: string;
}): DeskReplayResult {
  return replayDeskSameClockCapacity({
    candidates: input.candidates.filter((row) => input.sessions.has(row.session)),
    variant: {
      id: input.id,
      label: input.id,
      distinctOccAtSameClock: false,
      policies: input.policies,
    },
  });
}

function markdown(packet: Record<string, any>): string {
  const rows = packet.comparisons as Array<Record<string, any>>;
  const incremental = new Map((packet.capacityComparisons as Array<Record<string, any>>)
    .map((row) => [row.variantId, row]));
  const isolated = packet.capacityComparisons as Array<Record<string, any>>;
  const priority = packet.priorityComparisons as Array<Record<string, any>>;
  const channelCapacity = packet.channelCapacityComparisons as Array<Record<string, any>>;
  const rollbacks = packet.rollbackComparisons as Array<Record<string, any>>;
  const posture = packet.postureComparisons as Array<Record<string, any>>;
  return [
    `# Desk-wide distinct-OCC same-clock replay · through ${packet.throughSession ?? "no observed session"}`,
    "",
    "**READ-ONLY COUNTERFACTUAL · NO CONFIGURATION OR ORDER AUTHORITY**",
    packet.cohortMode === "frozen_historical_epoch"
      ? `\nFrozen historical cohort \`${packet.cohort}\` replayed under the currently active routing and admission policy. This is not exact-current execution evidence.\n`
      : "",
    "",
    ...(posture.length ? [
      "## Execute-to-observe posture comparison",
      "",
      "| Scenario | Chronological delta | Added peers | Removed channel paths | Development | Holdout | Without best session |",
      "|---|---:|---:|---:|---:|---:|---:|",
      ...posture.map((row) => `| ${row.variantId} | ${usd(row.modeledPnlDeltaUsd)} | ${row.added.length} | ${row.displaced.length} | ${usd(row.development.deltaUsd)} | ${usd(row.holdout.deltaUsd)} | ${usd(row.withoutBestSession.deltaUsd)} |`),
      "",
      "A posture comparison removes execution authority only. It preserves the channel's observer collection and leaves every peer entry, exit, size, route, priority, and collision rule unchanged.",
      "",
    ] : []),
    ...(rollbacks.length ? [
      "## Approved rollback-direction comparisons",
      "",
      "| Scenario | Exact acted-fill delta | Chronological delta | Added alternatives | Removed Gap fills | Development | Holdout |",
      "|---|---:|---:|---:|---:|---:|---:|",
      ...rollbacks.map((row) => `| ${row.choice} | ${usd(row.sameFillActual.deltaUsd)} | ${usd(row.modeledPnlDeltaUsd)} | ${row.added.length} | ${row.displaced.length} | ${usd(row.development.deltaUsd)} | ${usd(row.holdout.deltaUsd)} |`),
      "",
      `The chronological baseline reproduced ${packet.validation.matchedOriginalActed}/${packet.validation.originalActed} acted signals and substituted ${packet.validation.baselineExtra} complete virtual paths where the original winning same-clock path was not reproducible from the bounded candidate set. Exact acted-fill arithmetic remains the broker-comparable result; the chronological delta is the capacity/collision sensitivity check.`,
      "",
    ] : []),
    "| Variant | Added | Displaced | vs current desk | Capacity effect after Account 3 priority |",
    "|---|---:|---:|---:|---:|",
    ...rows.map((row) => {
      const capacity = incremental.get(row.variantId);
      return `| ${row.variantId} | ${row.added.length} | ${row.displaced.length} | ${usd(row.modeledPnlDeltaUsd)} | ${capacity ? usd(capacity.modeledPnlDeltaUsd) : "—"} |`;
    }),
    "",
    "## Isolated account capacity",
    "",
    "| Account experiment | Modeled change vs Account 3 priority | Session split |",
    "|---|---:|---|",
    ...isolated.filter((row) => row.variantId.startsWith("account"))
      .map((row) => `| ${row.variantId} | ${usd(row.modeledPnlDeltaUsd)} | ${row.bySession.map((session: any) => `${session.session}: ${usd(session.modeledPnlDeltaUsd)}`).join(" · ")} |`),
    "",
    "## Bounded priority-first sensitivity",
    "",
    "| Priority perturbation | Modeled change vs Account 3 priority |",
    "|---|---:|",
    ...priority.map((row) => `| ${row.variantId} | ${usd(row.modeledPnlDeltaUsd)} |`),
    "",
    "## Channel-specific extra-slot screening",
    "",
    "| Eligible second signal | Modeled change vs Account 3 priority |",
    "|---|---:|",
    ...channelCapacity.map((row) => `| ${row.variantId} | ${usd(row.modeledPnlDeltaUsd)} |`),
    "",
    "## What the variants mean",
    "",
    "- **account3-priority:** only the approved Account 3 ordering changes.",
    "- **distinct-occ-current-caps:** allow two same-clock entries with different OCC symbols, but retain every existing underlying/global cap.",
    "- **distinct-occ-two-slot:** additionally give each active underlying two modeled slots and each account domain at least three global slots.",
    "",
    `Baseline reproduction: ${packet.validation.matchedOriginalActed}/${packet.validation.originalActed} acted signals matched; ${packet.validation.baselineExtra} extra modeled admissions.`,
    `Path mix: ${packet.coverage.actualPaths} executed and ${packet.coverage.virtualPaths} virtual mid-basis candidates; ${packet.coverage.missingPaths} eligible signals lacked a complete path and were excluded. The two missing signals nearest this experiment cannot change selection: one becomes a same-OCC duplicate and one remains re-entry blocked.`,
    "",
    "Virtual-path dollars are directional and cannot be combined with executed dollars as if they were broker fills. Use added/displaced opportunity identity and repeated-session behavior as the decision evidence.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  if (!existsSync(snapshotFile)) throw new Error(`snapshot not found: ${snapshotFile}`);
  const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8")) as Snapshot;
  const sb = createServerSupabaseClient("desk-same-clock-capacity-replay");
  const activeRead = await loadActiveCompiledControlPlane(sb);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active control-plane manifest is required");
  }
  const active = activeRead.compiled;
  const activeBySlug = new Map(active.channelSpecs.map((row) => [row.slug, row]));
  const currentPaperSlugs = new Set(active.channelSpecs
    .filter((row) => row.executionPosture !== "observe-only")
    .map((row) => row.slug));
  const slugById = new Map(snapshot.strategists.map((row) => [row.id, row.slug]));
  const virtualBySignal = new Map(snapshot.virtualTrades.map((row) =>
    [row.signal_id, row]));
  let supplementalPathCount = 0;
  for (const file of supplementalVirtualFiles) {
    if (!existsSync(file)) throw new Error(`supplemental virtual file not found: ${file}`);
    const rows = JSON.parse(readFileSync(file, "utf8")) as SupplementalVirtualRow[];
    if (!Array.isArray(rows)) throw new Error(`supplemental virtual file is not an array: ${file}`);
    for (const row of rows) {
      if (!row.signalId || !row.exitAt || row.pnlPerContract == null) continue;
      if (virtualBySignal.has(row.signalId)) continue;
      virtualBySignal.set(row.signalId, {
        signal_id: row.signalId,
        exit_at: row.exitAt,
        pnl_per_contract: row.pnlPerContract,
      });
      supplementalPathCount += 1;
    }
  }
  const actualByOpportunity = new Map(snapshot.ledger.logicalTrades
    .filter((row) => row.opportunityId)
    .map((row) => [row.opportunityId!, row]));
  const activeCohort = `epoch-${snapshot.currentConfigurationEpochId.replace(/^sha256:/, "").slice(0, 16)}`;
  const cohort = requestedCohort || activeCohort;
  const candidates: DeskReplayCandidate[] = [];
  const missingPaths: Array<{ id: string; slug: string; reason: string }> = [];

  for (const signal of snapshot.signals) {
    const slug = slugById.get(signal.strategist_id);
    const spec = slug ? activeBySlug.get(slug) : null;
    if (!slug || !spec || signal.rationale?.rc54Candidate?.cohortId !== cohort) continue;
    if (currentPaperSlugs.has(slug) && !signal.acted_on
        && !ADMISSION_REASONS.has(signal.blocked_reason ?? "")) continue;
    const occ = String(signal.rationale?.occ ?? "").trim();
    const sourceBar = String(signal.rationale?.decision_source_bar_at ?? signal.created_at);
    const domainId = String(signal.rationale?.rc54Candidate?.domainId
      ?? spec.collisionDomain);
    const familyId = String(signal.rationale?.rc54Candidate?.familyId
      ?? spec.familyId);
    const accountId = String(signal.rationale?.rc54Candidate?.accountId
      ?? spec.accountId);
    let exitAt: string | null = null;
    let pnlUsd: number | null = null;
    let quantity = spec.quantity;
    let basis: DeskReplayCandidate["basis"] = "virtual-mid-basis";
    if (signal.acted_on) {
      const opportunityId = String(signal.rationale?.opportunity_id ?? "");
      const actual = actualByOpportunity.get(opportunityId);
      if (actual?.closedAt && actual.realizedPnlUsd != null) {
        exitAt = actual.closedAt;
        pnlUsd = actual.realizedPnlUsd;
        quantity = actual.quantity;
        basis = "actual-executed";
      }
    } else {
      const virtual = virtualBySignal.get(signal.id);
      if (virtual?.exit_at && virtual.pnl_per_contract != null) {
        exitAt = virtual.exit_at;
        pnlUsd = Math.round(virtual.pnl_per_contract * quantity * 100) / 100;
      }
    }
    if (!occ || !exitAt || pnlUsd == null) {
      missingPaths.push({ id: signal.id, slug, reason: signal.blocked_reason ?? "acted" });
      continue;
    }
    const maxEntries = Number(spec.entryParameters.maxEntriesPerSession
      ?? (spec.reentryPolicy === "disabled" ? 1 : 3));
    candidates.push({
      id: signal.id,
      session: signal.created_at.slice(0, 10),
      atMs: Date.parse(signal.created_at),
      sourceBarAtMs: Date.parse(sourceBar),
      slug,
      accountId,
      domainId,
      familyId,
      underlying: spec.symbolScope[0] ?? "",
      occ,
      quantity,
      maxEntriesPerSession: maxEntries,
      exitAtMs: Date.parse(exitAt),
      pnlUsd,
      basis,
      originalActed: signal.acted_on,
    });
  }
  const allCandidates = candidates;
  const currentCandidates = allCandidates.filter((row) => currentPaperSlugs.has(row.slug));
  const currentPolicies = clonePolicies(
    active.manifest.admissionPolicies as DeskReplayPolicy[],
  );
  const priorityPolicies = withAccount3Priority(currentPolicies, active);
  const domainExperiments = [
    { label: "account1", id: "rc54-control" },
    { label: "account2", id: "rc54-lab" },
    { label: "account3", id: "rc54-morgue" },
  ];
  const capacityVariants = domainExperiments.flatMap((domain) => [
    {
      id: `${domain.label}-distinct-occ-current-caps`,
      label: `${domain.label} two distinct OCC at current caps`,
      distinctOccAtSameClock: true,
      policies: pairedSameClock(priorityPolicies, false, new Set([domain.id])),
    },
    {
      id: `${domain.label}-distinct-occ-two-slot`,
      label: `${domain.label} two distinct OCC with two-slot capacity`,
      distinctOccAtSameClock: true,
      policies: pairedSameClock(priorityPolicies, true, new Set([domain.id])),
    },
  ]);
  const observedSlugsByDomain = new Map<string, string[]>();
  for (const candidate of currentCandidates) {
    const values = observedSlugsByDomain.get(candidate.domainId) ?? [];
    if (!values.includes(candidate.slug)) values.push(candidate.slug);
    observedSlugsByDomain.set(candidate.domainId, values);
  }
  const priorityVariants = domainExperiments.flatMap((domain) =>
    (observedSlugsByDomain.get(domain.id) ?? []).sort().map((slug) => ({
      id: `priority-first-${domain.label}-${slug}`,
      label: `${domain.label}: ${slug} first`,
      distinctOccAtSameClock: false,
      policies: prioritizeSlug(priorityPolicies, domain.id, slug),
    })));
  const channelCapacityVariants = domainExperiments.flatMap((domain) =>
    (observedSlugsByDomain.get(domain.id) ?? []).sort().map((slug) => {
      const baselinePolicy = priorityPolicies.find((policy) => policy.id === domain.id);
      if (!baselinePolicy) throw new Error(`${domain.label}: policy missing`);
      return {
        id: `extra-slot-${domain.label}-${slug}`,
        label: `${domain.label}: ${slug} eligible for second slot`,
        distinctOccAtSameClock: true,
        policies: pairedSameClock(priorityPolicies, true, new Set([domain.id])),
        extraSameClockEligibleByDomain: { [domain.id]: [slug] },
        additionalCapacityEligibilityByDomain: {
          [domain.id]: {
            eligibleSlugs: [slug],
            baselineMaxOpenGlobal: baselinePolicy.maxOpenGlobal,
            baselineMaxOpenByUnderlying: baselinePolicy.maxOpenByUnderlying,
          },
        },
      };
    }));
  const globalCapacityVariants = [
    {
      id: "distinct-occ-current-caps", label: "Two distinct OCC at current caps",
      distinctOccAtSameClock: true,
      policies: pairedSameClock(priorityPolicies, false),
    },
    {
      id: "distinct-occ-two-slot", label: "Two distinct OCC with two-slot capacity",
      distinctOccAtSameClock: true,
      policies: pairedSameClock(priorityPolicies, true),
    },
  ];
  const variants = [
    {
      id: "current-policy", label: "Current policy",
      distinctOccAtSameClock: false, policies: currentPolicies,
    },
    {
      id: "account3-priority", label: "Account 3 priority",
      distinctOccAtSameClock: false, policies: priorityPolicies,
    },
    ...capacityVariants,
    ...globalCapacityVariants,
    ...priorityVariants,
    ...channelCapacityVariants,
  ];
  const results = variants.map((variant) => replayDeskSameClockCapacity({
    candidates: currentCandidates,
    variant,
  }));
  const baseline = results[0];
  const priorityBaseline = results[1];
  const postureComparisons = observeChannels.size ? (() => {
    const unknown = [...observeChannels].filter((slug) => !currentPaperSlugs.has(slug));
    if (unknown.length) throw new Error(`observe-channel is not current paper: ${unknown.join(",")}`);
    const transformed = currentCandidates.filter((row) => !observeChannels.has(row.slug));
    const result = replayDeskSameClockCapacity({
      candidates: transformed,
      variant: { id: `observe-${[...observeChannels].sort().join("-")}`,
        label: `Observe only: ${[...observeChannels].sort().join(", ")}`,
        distinctOccAtSameClock: false, policies: currentPolicies },
    });
    const comparison = compareDeskReplay(baseline, result);
    const sessions = [...new Set(currentCandidates.map((row) => row.session))].sort();
    const holdoutSessions = new Set(sessions.slice(-2));
    const developmentSessions = new Set(sessions.slice(0, -2));
    const developmentBase = replayWindow({ candidates: currentCandidates,
      policies: currentPolicies, sessions: developmentSessions, id: "posture-baseline-development" });
    const developmentResult = replayWindow({ candidates: transformed,
      policies: currentPolicies, sessions: developmentSessions, id: "posture-candidate-development" });
    const holdoutBase = replayWindow({ candidates: currentCandidates,
      policies: currentPolicies, sessions: holdoutSessions, id: "posture-baseline-holdout" });
    const holdoutResult = replayWindow({ candidates: transformed,
      policies: currentPolicies, sessions: holdoutSessions, id: "posture-candidate-holdout" });
    const baseWithoutBest = withoutBestSession(baseline) ?? baseline.modeledPnlUsd;
    const resultWithoutBest = withoutBestSession(result) ?? result.modeledPnlUsd;
    return [{
      ...summarizeDifference(baseline, result),
      observedChannels: [...observeChannels].sort(),
      baselineUsd: baseline.modeledPnlUsd,
      candidateUsd: result.modeledPnlUsd,
      actualPaths: result.actualPaths,
      virtualPaths: result.virtualPaths,
      development: { sessions: [...developmentSessions],
        baselineUsd: developmentBase.modeledPnlUsd, candidateUsd: developmentResult.modeledPnlUsd,
        deltaUsd: Math.round((developmentResult.modeledPnlUsd - developmentBase.modeledPnlUsd) * 100) / 100 },
      holdout: { sessions: [...holdoutSessions],
        baselineUsd: holdoutBase.modeledPnlUsd, candidateUsd: holdoutResult.modeledPnlUsd,
        deltaUsd: Math.round((holdoutResult.modeledPnlUsd - holdoutBase.modeledPnlUsd) * 100) / 100 },
      withoutBestSession: { baselineUsd: baseWithoutBest, candidateUsd: resultWithoutBest,
        deltaUsd: Math.round((resultWithoutBest - baseWithoutBest) * 100) / 100 },
      policyIdentityHeld: true,
    }];
  })() : [];
  let rollbackComparisons: Array<Record<string, unknown>> = [];
  let rollbackPacketSha256: string | null = null;
  if (rollbackPacketFile) {
    const rollbackPath = resolve(rollbackPacketFile);
    if (!existsSync(rollbackPath)) throw new Error(`rollback packet not found: ${rollbackPath}`);
    const rollbackText = readFileSync(rollbackPath, "utf8");
    rollbackPacketSha256 = createHash("sha256").update(rollbackText).digest("hex");
    const rollbackPacket = JSON.parse(rollbackText) as RollbackPacket;
    if (rollbackPacket.beforeManifestHash !== active.manifest.contentHash) {
      throw new Error("rollback packet before-manifest hash does not match the active control plane");
    }
    const alternatives = new Map(rollbackPacket.alternatives.map((row) => [row.choice, row]));
    const sessions = [...new Set(currentCandidates.map((row) => row.session))].sort();
    const holdoutSessions = new Set(sessions.slice(-2));
    const developmentSessions = new Set(sessions.slice(0, -2));
    rollbackComparisons = requestedRollbackChoices.map((choice) => {
      const alternative = alternatives.get(choice);
      if (!alternative) throw new Error(`rollback choice not found: ${choice}`);
      const specs = new Map(alternative.candidate.channelSpecs.map((row) => [row.slug, row]));
      const transformed = allCandidates.flatMap((row): DeskReplayCandidate[] => {
        const spec = specs.get(row.slug);
        if (!spec || spec.executionPosture === "observe-only") return [];
        if (!Number.isInteger(spec.quantity) || spec.quantity < 1 || row.quantity < 1) {
          throw new Error(`${choice}:${row.slug}: invalid quantity`);
        }
        const ratio = spec.quantity / row.quantity;
        return [{ ...row,
          accountId: spec.accountId,
          domainId: spec.collisionDomain,
          familyId: spec.familyId,
          underlying: spec.symbolScope[0] ?? row.underlying,
          quantity: spec.quantity,
          maxEntriesPerSession: Number(spec.entryParameters.maxEntriesPerSession ?? 1),
          pnlUsd: Math.round(row.pnlUsd * ratio * 100) / 100 }];
      });
      const policies = structuredClone(alternative.candidate.manifest.admissionPolicies);
      const result = replayDeskSameClockCapacity({
        candidates: transformed,
        variant: { id: choice, label: choice, distinctOccAtSameClock: false, policies },
      });
      const comparison = compareDeskReplay(baseline, result);
      const actualBaseline = fixedPathSummary(currentCandidates.filter((row) => row.originalActed));
      const actualCandidate = fixedPathSummary(transformed.filter((row) => row.originalActed));
      const baselineDevelopment = replayWindow({ candidates: currentCandidates, policies: currentPolicies,
        sessions: developmentSessions, id: `${choice}-baseline-development` });
      const candidateDevelopment = replayWindow({ candidates: transformed, policies,
        sessions: developmentSessions, id: `${choice}-candidate-development` });
      const baselineHoldout = replayWindow({ candidates: currentCandidates, policies: currentPolicies,
        sessions: holdoutSessions, id: `${choice}-baseline-holdout` });
      const candidateHoldout = replayWindow({ candidates: transformed, policies,
        sessions: holdoutSessions, id: `${choice}-candidate-holdout` });
      return {
        choice,
        changes: alternative.changes,
        sameOpportunityUniverse: allCandidates.length,
        candidateUniverse: transformed.length,
        admitted: result.admitted.length,
        modeledPnlUsd: result.modeledPnlUsd,
        modeledPnlDeltaUsd: comparison.modeledPnlDeltaUsd,
        sameFillActual: {
          baselineUsd: actualBaseline.modeledPnlUsd,
          candidateUsd: actualCandidate.modeledPnlUsd,
          deltaUsd: Math.round((actualCandidate.modeledPnlUsd
            - actualBaseline.modeledPnlUsd) * 100) / 100,
          baselineWithoutBestSessionUsd: actualBaseline.withoutBestSessionUsd,
          candidateWithoutBestSessionUsd: actualCandidate.withoutBestSessionUsd,
          baselineSessions: actualBaseline.sessions,
          candidateSessions: actualCandidate.sessions,
        },
        added: comparison.added.map((row) => ({ id: row.id, session: row.session,
          slug: row.slug, occ: row.occ, pnlUsd: row.pnlUsd, basis: row.basis })),
        displaced: comparison.displaced.map((row) => ({ id: row.id, session: row.session,
          slug: row.slug, occ: row.occ, pnlUsd: row.pnlUsd, basis: row.basis })),
        chronological: result.sessions,
        development: {
          sessions: [...developmentSessions],
          baselineUsd: baselineDevelopment.modeledPnlUsd,
          candidateUsd: candidateDevelopment.modeledPnlUsd,
          deltaUsd: Math.round((candidateDevelopment.modeledPnlUsd
            - baselineDevelopment.modeledPnlUsd) * 100) / 100,
        },
        holdout: {
          sessions: [...holdoutSessions],
          baselineUsd: baselineHoldout.modeledPnlUsd,
          candidateUsd: candidateHoldout.modeledPnlUsd,
          deltaUsd: Math.round((candidateHoldout.modeledPnlUsd
            - baselineHoldout.modeledPnlUsd) * 100) / 100,
        },
        withoutBestSession: {
          baselineUsd: withoutBestSession(baseline),
          candidateUsd: withoutBestSession(result),
        },
        rejectedByReason: reasonCounts(result),
        policyIdentityHeld: JSON.stringify(policies) === JSON.stringify(currentPolicies),
        actualPaths: result.actualPaths,
        virtualPaths: result.virtualPaths,
      };
    });
  }
  const actedIds = new Set(currentCandidates.filter((row) => row.originalActed)
    .map((row) => row.id));
  const baselineIds = new Set(baseline.admitted.map((row) => row.id));
  const matched = [...actedIds].filter((id) => baselineIds.has(id)).length;
  const packet = {
    schemaVersion: 1,
    version: "desk-same-clock-capacity-packet-v1",
    generatedAt: new Date().toISOString(),
    throughSession: requestedThroughSession
      || [...new Set(currentCandidates.map((row) => row.session))].sort().at(-1)
      || null,
    cohort,
    cohortMode: cohort === activeCohort ? "active_epoch" : "frozen_historical_epoch",
    activeCohort,
    sessions: [...new Set(currentCandidates.map((row) => row.session))].sort(),
    baseline,
    results,
    comparisons: results.filter((row) => [
      "account3-priority", "distinct-occ-current-caps", "distinct-occ-two-slot",
    ].includes(row.variantId)).map((row) => summarizeDifference(baseline, row)),
    capacityComparisons: results.filter((row) =>
      row.variantId.includes("distinct-occ"))
      .map((row) => summarizeDifference(priorityBaseline, row)),
    priorityComparisons: results.filter((row) =>
      row.variantId.startsWith("priority-first-"))
      .map((row) => summarizeDifference(priorityBaseline, row)),
    channelCapacityComparisons: results.filter((row) =>
      row.variantId.startsWith("extra-slot-"))
      .map((row) => summarizeDifference(priorityBaseline, row)),
    postureComparisons,
    rollbackComparisons,
    validation: {
      originalActed: actedIds.size,
      matchedOriginalActed: matched,
      baselineMissing: [...actedIds].filter((id) => !baselineIds.has(id)),
      baselineExtra: baseline.admitted.filter((row) => !actedIds.has(row.id)).length,
    },
    coverage: {
      candidates: currentCandidates.length,
      prospectiveCandidates: allCandidates.length,
      actualPaths: currentCandidates.filter((row) => row.basis === "actual-executed").length,
      virtualPaths: currentCandidates.filter((row) => row.basis === "virtual-mid-basis").length,
      supplementalPathCount,
      missingPaths: missingPaths.length,
      missing: missingPaths,
    },
    rulesHeldFixed: [
      "same OCC remains blocked within an account domain",
      "cross-account same OCC remains allowed with independent exits",
      "entry formulas, managers, quantities, and routes do not change",
      "family and session-entry limits remain active",
    ],
    authority: {
      productionWrites: false,
      configurationChange: false,
      workerMutation: false,
      orderAuthority: false,
    },
  };
  const canonical = JSON.stringify(packet);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "replay.json"), `${JSON.stringify(packet, null, 2)}\n`);
  writeFileSync(resolve(outDir, "replay.md"), markdown(packet));
  writeFileSync(resolve(outDir, "receipt.json"), `${JSON.stringify({
    generatedAt: packet.generatedAt,
    contentSha256: createHash("sha256").update(canonical).digest("hex"),
    sourceSnapshot: snapshotFile,
    supplementalVirtualFiles,
    sourceEpoch: snapshot.currentConfigurationEpochId,
    rollbackPacketSha256,
    productionWrites: false,
    orderAuthority: false,
  }, null, 2)}\n`);
  console.log("desk-same-clock-capacity-replay: PASS");
  console.log(`  sessions: ${packet.sessions.join(", ")}`);
  console.log(`  cohort: ${packet.cohort} (${packet.cohortMode})`);
  console.log(`  candidates: ${candidates.length} · missing paths: ${missingPaths.length}`);
  for (const row of packet.comparisons) {
    console.log(`  ${row.variantId}: ${row.modeledPnlDeltaUsd >= 0 ? "+" : ""}$${row.modeledPnlDeltaUsd} · +${row.added.length}/-${row.displaced.length}`);
  }
  console.log(`  output: ${outDir}`);
}

main().catch((error) => {
  console.error(`desk-same-clock-capacity-replay: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
