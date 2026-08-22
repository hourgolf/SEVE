// SELECT-only reconciliation of live control-plane membership against the
// intended Monday roster, followed by a chronological open-lane tournament.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadStoredReceiptBoundControlPlane } from "../lib/channels/channelControlPlanePersistence.js";
import { NEXT_WEEK_OBSERVE_ONLY, NEXT_WEEK_ROSTER_DECISIONS } from "../lib/channels/nextWeekRoster20260824.js";
import { WEEKEND_MONDAY_ROSTER, validateWeekendMondayRoster } from "../lib/channels/weekendMondayRoster20260824.js";
import { replayDeskSameClockCapacity, type DeskReplayCandidate, type DeskReplayPolicy } from "../lib/research/deskSameClockCapacityReplay.js";
import { createServerSupabaseClient } from "./serverSupabase.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const envFile = resolve(arg("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const snapshotFile = resolve(arg("snapshot-file", "data/weekend-optimization/2026-08-22/phenotype-atlas/snapshot.json"));
const pathFile = resolve(arg("path-results-file", "data/weekend-optimization/2026-08-22/phenotype-paths/path-results.json"));
const phenotypeFile = resolve(arg("phenotype-file", "data/weekend-optimization/2026-08-22/channel-phenotypes/phenotypes.json"));
const outputDir = resolve(arg("output-dir", "data/weekend-optimization/2026-08-22/monday-roster-tournament"));

interface SignalRow { id: string; strategist_id: string; created_at: string; acted_on: boolean; direction: string | null; rationale?: Record<string, any> }
interface VirtualRow { signal_id: string; exit_at: string | null; pnl_per_contract: number | null }
interface Snapshot {
  strategists: Array<{ id: string; slug: string }>;
  signals: SignalRow[];
  virtualTrades: VirtualRow[];
}
interface ExactPath { logicalOpportunityId: string; channel: string; candidateId: string; state: string; exitAt: string | null; modeledPnlUsd: number | null; quantity: number }
interface SourceRow { slug: string; status: string | null; is_active: boolean | null; executor: string | null; account_id: string | null }
interface ChannelSpec {
  slug: string; accountId: string; collisionDomain: string; familyId: string; symbolScope: string[];
  quantity: number; priority: number; executionPosture: "paper" | "observe-only";
  entryParameters: { maxEntriesPerSession?: number };
}

const correctedRoster = [
  "momo-shape-2", "vb-level-break", "breakout", "grind-smart-entries",
  "orb-ustop-ctl", "vb-macd-state", "breakout-alt-v3-itm", "vb-rsi-revert-iwm",
] as const;
const baselineManagers: Record<string, string> = {
  "momo-shape-2": "BANK30-R50-K67",
  "vb-level-break": "TP-30",
  breakout: "FULL-R35-K67",
  "grind-smart-entries": "FULL-R50-K75",
  "orb-ustop-ctl": "BANK30-R50-K67",
};
const candidateManagers: Record<string, string | null> = {
  "orb-trend-rider": "TP-50",
  "breakout-smart-entries": "FULL-R35-K67",
  "breakout-alt-v3": "BANK30-BE-R50-K67",
  "vb-level-break-qqq": "BANK20-BE-R50-K67",
  "vb-or-fail-qqq": "BANK30-BE-R50-K67",
  "momo-shape": "FULL-R20-K50",
  "qqq-thrust-trail": null,
  "vb-curl-reversal": null,
  "vb-squeeze-break-qqq": null,
  "vb-gap-drift-qqq": null,
  "pb-ride-2": null,
  "vb-vwap-revert-iwm": null,
};
const candidateFamilies: Record<string, string> = {
  "orb-trend-rider": "SPY-ORB",
  "breakout-smart-entries": "RESEARCH-SPY-BREAKOUT",
  "breakout-alt-v3": "RESEARCH-SPY-BREAKOUT-ALT-V3",
  "vb-level-break-qqq": "VB-LEVEL-BREAK-QQQ",
  "vb-or-fail-qqq": "VB-OR-FAIL-QQQ",
  "momo-shape": "SPY-MOMO",
  "qqq-thrust-trail": "QQQ-THRUST",
  "vb-curl-reversal": "SPY-CURL-REVERSAL",
  "vb-squeeze-break-qqq": "VB-SQUEEZE-BREAK-QQQ",
  "vb-gap-drift-qqq": "VB-GAP-DRIFT-QQQ",
  "pb-ride-2": "SPY-PB",
  "vb-vwap-revert-iwm": "VB-VWAP-REVERT-IWM",
};

const round = (value: number): number => Math.round(value * 100) / 100;
const median = (values: number[]): number => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const underlyingFor = (signal: SignalRow, slug: string): string => {
  const occ = String(signal.rationale?.occ ?? "").toUpperCase();
  if (occ.startsWith("QQQ")) return "QQQ";
  if (occ.startsWith("IWM")) return "IWM";
  if (occ.startsWith("SPY")) return "SPY";
  return slug.endsWith("-qqq") ? "QQQ" : slug.endsWith("-iwm") ? "IWM" : "SPY";
};
const windowResult = (candidates: DeskReplayCandidate[], policies: DeskReplayPolicy[], start: string, endExclusive: string) =>
  replayDeskSameClockCapacity({
    candidates: candidates.filter((row) => row.session >= start && row.session < endExclusive),
    variant: { id: `${start}-${endExclusive}`, label: "Monday roster tournament", distinctOccAtSameClock: false, policies },
  });

function combinations(values: readonly string[], count: number): string[][] {
  const rows: string[][] = [];
  const visit = (start: number, selected: string[]): void => {
    if (selected.length === count) { rows.push([...selected]); return; }
    for (let index = start; index <= values.length - (count - selected.length); index++) {
      selected.push(values[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return rows;
}

function policyWithCandidate(policies: DeskReplayPolicy[], domain: string, slug: string): DeskReplayPolicy[] {
  return structuredClone(policies).map((policy) => {
    if (policy.id !== domain) return policy;
    const last = Math.max(0, ...Object.values(policy.priorityBySlug));
    return { ...policy, priorityBySlug: { ...policy.priorityBySlug, [slug]: last + 1 } };
  });
}

function policyWithReplacement(policies: DeskReplayPolicy[], domain: string, replaced: string, replacement: string): DeskReplayPolicy[] {
  return structuredClone(policies).map((policy) => policy.id !== domain ? policy : ({
    ...policy,
    priorityBySlug: Object.fromEntries(Object.entries(policy.priorityBySlug).map(([slug, priority]) =>
      [slug === replaced ? replacement : slug, priority])),
  }));
}

function sessionDelta(baseline: ReturnType<typeof windowResult>, variant: ReturnType<typeof windowResult>) {
  const baselineBySession = new Map(baseline.sessions.map((row) => [row.session, row.modeledPnlUsd]));
  const variantBySession = new Map(variant.sessions.map((row) => [row.session, row.modeledPnlUsd]));
  const sessions = [...new Set([...baselineBySession.keys(), ...variantBySession.keys()])].sort();
  const deltas = sessions.map((session) => round((variantBySession.get(session) ?? 0) - (baselineBySession.get(session) ?? 0)));
  const total = deltas.reduce((sum, value) => sum + value, 0);
  return {
    totalUsd: round(total),
    typicalSessionUsd: round(median(deltas)),
    positiveSessions: deltas.filter((value) => value > 0).length,
    sessions: deltas.length,
    withoutBestSessionUsd: round(total - (deltas.length ? Math.max(...deltas) : 0)),
    worstSessionUsd: deltas.length ? round(Math.min(...deltas)) : 0,
  };
}

function absoluteRead(result: ReturnType<typeof windowResult>) {
  const sessionPnls = result.sessions.map((row) => row.modeledPnlUsd);
  return {
    modeledPnlUsd: result.modeledPnlUsd,
    withoutBestSessionUsd: round(result.modeledPnlUsd - (sessionPnls.length ? Math.max(...sessionPnls) : 0)),
    typicalSessionUsd: round(median(sessionPnls)),
    positiveSessions: sessionPnls.filter((value) => value > 0).length,
    sessions: sessionPnls.length,
    worstSessionUsd: sessionPnls.length ? round(Math.min(...sessionPnls)) : 0,
    admitted: result.admitted.length,
  };
}

async function main(): Promise<void> {
  validateWeekendMondayRoster();
  const snapshotText = readFileSync(snapshotFile, "utf8");
  const pathText = readFileSync(pathFile, "utf8");
  const phenotypeText = readFileSync(phenotypeFile, "utf8");
  const snapshot = JSON.parse(snapshotText) as Snapshot;
  const paths = (JSON.parse(pathText) as { generatedAt?: string; paths: ExactPath[] }).paths;
  const phenotype = JSON.parse(phenotypeText) as { channels: Array<Record<string, any>> };
  const sb = createServerSupabaseClient("monday-roster-reconciliation-tournament");
  const [control, sourceRead] = await Promise.all([
    loadStoredReceiptBoundControlPlane(sb),
    sb.from("strategists").select("slug,status,is_active,executor,account_id"),
  ]);
  if (!control.compiled || control.state === "failed") throw new Error(`active control plane unavailable: ${control.error ?? control.state}`);
  if (sourceRead.error) throw new Error(`strategists SELECT failed: ${sourceRead.error.message}`);
  const specs = control.compiled.channelSpecs as unknown as ChannelSpec[];
  const policies = control.compiled.manifest.admissionPolicies as unknown as DeskReplayPolicy[];
  const sourceBySlug = new Map((sourceRead.data as unknown as SourceRow[]).map((row) => [row.slug, row]));
  const officialPaper = new Set(NEXT_WEEK_ROSTER_DECISIONS.map((row) => row.channel));
  const officialObserve = new Set<string>(NEXT_WEEK_OBSERVE_ONLY);
  const corrected = new Set<string>(correctedRoster);
  const rosterReconciliation = specs.map((spec) => {
    const source = sourceBySlug.get(spec.slug);
    const entryAuthority = spec.executionPosture === "paper";
    const intendedClass = officialPaper.has(spec.slug) ? "official_paper_roster"
      : officialObserve.has(spec.slug) ? "official_observe_only"
        : "not_in_official_packet";
    return {
      channel: spec.slug,
      domain: spec.collisionDomain,
      accountId: spec.accountId,
      underlying: spec.symbolScope[0] ?? null,
      quantity: spec.quantity,
      priority: spec.priority,
      executionPosture: spec.executionPosture,
      intendedClass,
      correctedRoster: corrected.has(spec.slug),
      sourceState: source ? { status: source.status, isActive: source.is_active, executor: source.executor, accountId: source.account_id } : null,
      entryAuthority,
      mismatch: intendedClass === "official_observe_only" && spec.executionPosture !== "observe-only" ? "observe_channel_has_entry_authority"
        : intendedClass === "not_in_official_packet" && spec.executionPosture === "paper" ? "unplanned_entry_authority"
          : intendedClass === "official_paper_roster" && spec.executionPosture !== "paper" ? "paper_roster_lacks_entry_authority"
            : null,
    };
  }).sort((a, b) => a.domain.localeCompare(b.domain) || a.priority - b.priority || a.channel.localeCompare(b.channel));

  const slugByStrategist = new Map(snapshot.strategists.map((row) => [row.id, row.slug]));
  const virtualBySignal = new Map(snapshot.virtualTrades.map((row) => [row.signal_id, row]));
  const exactByKey = new Map(paths.filter((row) => row.state === "scored" && row.exitAt && row.modeledPnlUsd != null)
    .map((row) => [`${row.logicalOpportunityId}|${row.candidateId}`, row]));
  const specBySlug = new Map(specs.map((row) => [row.slug, row]));
  const familyControls = [
    ["orb-trend-rider", "orb-ustop-ctl"],
    ["momo-shape", "momo-shape-2"],
    ["breakout-smart-entries", "breakout"],
    ["pb-ride-2", "pb-ride"],
  ].map(([candidate, incumbent]) => {
    const incumbentFamily = specBySlug.get(incumbent)?.familyId;
    const candidateFamily = candidateFamilies[candidate];
    if (!incumbentFamily || candidateFamily !== incumbentFamily) {
      throw new Error(`${candidate}: candidate family ${candidateFamily ?? "missing"} does not match ${incumbent} family ${incumbentFamily ?? "missing"}`);
    }
    return { candidate, incumbent, familyId: candidateFamily };
  });
  const buildRows = (slug: string, spec: ChannelSpec, manager: string | null, quantity = 2, entryCap?: number): DeskReplayCandidate[] => {
    const rows: DeskReplayCandidate[] = [];
    for (const signal of snapshot.signals) {
      if (slugByStrategist.get(signal.strategist_id) !== slug) continue;
      const occ = String(signal.rationale?.occ ?? "").trim();
      const sourceBar = String(signal.rationale?.decision_source_bar_at ?? signal.created_at);
      const exact = manager ? exactByKey.get(`signal:${signal.id}|${manager}`) : null;
      const virtual = virtualBySignal.get(signal.id);
      const exitAt = exact?.exitAt ?? (!manager ? virtual?.exit_at : null);
      const pnlUsd = exact?.modeledPnlUsd != null
        ? exact.modeledPnlUsd * quantity / Math.max(1, exact.quantity)
        : !manager && virtual?.pnl_per_contract != null ? virtual.pnl_per_contract * quantity : null;
      if (!occ || !exitAt || pnlUsd == null || !Number.isFinite(Date.parse(exitAt)) || !Number.isFinite(Date.parse(sourceBar))) continue;
      rows.push({
        id: signal.id,
        session: signal.created_at.slice(0, 10),
        atMs: Date.parse(signal.created_at),
        sourceBarAtMs: Date.parse(sourceBar),
        slug,
        accountId: spec.accountId,
        domainId: spec.collisionDomain,
        familyId: spec.familyId,
        underlying: underlyingFor(signal, slug),
        occ,
        quantity,
        maxEntriesPerSession: entryCap ?? Number(spec.entryParameters.maxEntriesPerSession ?? 1),
        exitAtMs: Date.parse(exitAt),
        pnlUsd: round(pnlUsd),
        basis: "virtual-mid-basis",
        originalActed: signal.acted_on,
      });
    }
    return rows;
  };

  const baselineRows = correctedRoster.flatMap((slug) => {
    const spec = specBySlug.get(slug);
    if (!spec) throw new Error(`corrected roster spec missing from active control plane: ${slug}`);
    const cap = slug === "momo-shape-2" ? 2 : undefined;
    return buildRows(slug, spec, baselineManagers[slug] ?? null, spec.quantity, cap);
  });
  const windows = [
    { id: "three-week", start: "2026-08-03", endExclusive: "2026-08-22" },
    { id: "two-week", start: "2026-08-10", endExclusive: "2026-08-22" },
  ];
  const baseline = Object.fromEntries(windows.map((window) => {
    const result = windowResult(baselineRows, policies, window.start, window.endExclusive);
    return [window.id, { modeledPnlUsd: result.modeledPnlUsd, admitted: result.admitted.length }];
  }));

  const domainTemplates = new Map<string, ChannelSpec>();
  for (const spec of specs) if (!domainTemplates.has(spec.collisionDomain)) domainTemplates.set(spec.collisionDomain, spec);
  const phenotypeBySlug = new Map(phenotype.channels.map((row) => [String(row.channel), row]));
  const expandedCandidateManagers = new Map<string, string | null>(
    phenotype.channels
      .map((row) => String(row.channel))
      .filter((slug) => !corrected.has(slug))
      .map((slug) => [slug, null]),
  );
  for (const [slug, manager] of Object.entries(candidateManagers)) expandedCandidateManagers.set(slug, manager);
  const tournament: Array<Record<string, unknown>> = [];
  for (const [slug, manager] of expandedCandidateManagers) {
    const candidatePhenotype = phenotypeBySlug.get(slug);
    if (!candidatePhenotype) continue;
    const candidateUnderlying = slug.endsWith("-qqq") || slug === "qqq-thrust-trail" ? "QQQ"
      : slug.endsWith("-iwm") ? "IWM" : "SPY";
    for (const [domain, template] of domainTemplates) {
      const policy = policies.find((row) => row.id === domain);
      if (!policy?.enabledForNewEntries || (policy.maxOpenByUnderlying[candidateUnderlying] ?? 0) < 1) continue;
      const spec: ChannelSpec = {
        ...template,
        slug,
        collisionDomain: domain,
        accountId: template.accountId,
        familyId: specBySlug.get(slug)?.familyId ?? candidateFamilies[slug] ?? `TOURNAMENT-${candidateUnderlying}-${slug}`,
        symbolScope: [candidateUnderlying],
        quantity: 2,
        priority: 999,
        entryParameters: { maxEntriesPerSession: 1 },
      };
      const candidateRows = buildRows(slug, spec, manager, 2, 1);
      if (!candidateRows.length) continue;
      const scenarioPolicies = policyWithCandidate(policies, domain, slug);
      const reads = Object.fromEntries(windows.map((window) => {
        const baseResult = windowResult(baselineRows, scenarioPolicies, window.start, window.endExclusive);
        const variant = windowResult([...baselineRows, ...candidateRows], scenarioPolicies, window.start, window.endExclusive);
        const candidateAdmitted = variant.admitted.filter((row) => row.slug === slug);
        const incumbentAdmitted = variant.admitted.filter((row) => row.slug !== slug).length;
        return [window.id, {
          ...sessionDelta(baseResult, variant),
          candidateAdmitted: candidateAdmitted.length,
          candidatePathSumUsd: round(candidateAdmitted.reduce((sum, row) => sum + row.pnlUsd, 0)),
          displacedIncumbentPaths: Math.max(0, baseResult.admitted.length - incumbentAdmitted),
          totalAdmitted: variant.admitted.length,
        }];
      }));
      const three = reads["three-week"];
      const two = reads["two-week"];
      const robust = three.totalUsd > 0 && two.totalUsd > 0 && three.withoutBestSessionUsd > 0
        && two.withoutBestSessionUsd > 0 && three.candidateAdmitted >= 5 && two.candidateAdmitted >= 3
        && three.displacedIncumbentPaths === 0 && two.displacedIncumbentPaths === 0;
      tournament.push({
        channel: slug,
        manager: manager ?? "historical native",
        domain,
        accountId: template.accountId,
        underlying: candidateUnderlying,
        evidence: { sessions: candidatePhenotype.sessions, opportunities: candidatePhenotype.opportunities,
          typicalMfePct: candidatePhenotype.typicalMfePct, typicalNativeReturnPct: candidatePhenotype.typicalNativeReturnPct },
        windows: reads,
        robustOpenLane: robust,
        read: robust ? "portfolio_compatible_lead"
          : three.totalUsd > 0 && two.totalUsd >= 0 ? "positive_but_displacing_or_tail_dependent"
            : "does_not_improve_both_windows",
      });
    }
  }
  tournament.sort((left, right) => Number(right.robustOpenLane) - Number(left.robustOpenLane)
    || Number((right.windows as any)["two-week"].totalUsd) - Number((left.windows as any)["two-week"].totalUsd)
    || Number((right.windows as any)["three-week"].totalUsd) - Number((left.windows as any)["three-week"].totalUsd));

  const routePreference: Record<string, string[]> = {
    "vb-gap-drift-qqq": ["rc54-lab", "rc54-morgue", "rc54-control"],
    "orb-trend-rider": ["rc54-lab", "rc54-control", "rc54-morgue"],
  };
  const bestByChannel = [...new Set(tournament.map((row) => String(row.channel)))].map((channel) =>
    tournament.filter((row) => row.channel === channel).sort((left, right) => {
      const preference = routePreference[channel] ?? [];
      const leftRank = preference.indexOf(String(left.domain));
      const rightRank = preference.indexOf(String(right.domain));
      return Number(right.robustOpenLane) - Number(left.robustOpenLane)
        || Number((right.windows as any)["two-week"].withoutBestSessionUsd) - Number((left.windows as any)["two-week"].withoutBestSessionUsd)
        || (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
    })[0]).sort((left, right) => Number(right.robustOpenLane) - Number(left.robustOpenLane)
      || Number((right.windows as any)["two-week"].withoutBestSessionUsd) - Number((left.windows as any)["two-week"].withoutBestSessionUsd));

  const robustPlacements = bestByChannel.filter((row) => row.robustOpenLane);
  const leadRowsBySlug = new Map<string, DeskReplayCandidate[]>();
  for (const placement of robustPlacements) {
    const slug = String(placement.channel);
    const template = domainTemplates.get(String(placement.domain))!;
    const candidateUnderlying = String(placement.underlying);
    const spec: ChannelSpec = { ...template, slug, collisionDomain: String(placement.domain),
      accountId: String(placement.accountId), familyId: specBySlug.get(slug)?.familyId ?? candidateFamilies[slug] ?? `TOURNAMENT-${candidateUnderlying}-${slug}`,
      symbolScope: [candidateUnderlying], quantity: 2, priority: 999, executionPosture: "paper",
      entryParameters: { maxEntriesPerSession: 1 } };
    leadRowsBySlug.set(slug, buildRows(slug, spec, expandedCandidateManagers.get(slug) ?? null, 2, 1));
  }
  const combinedLeadNames = robustPlacements.slice(0, 2).map((row) => String(row.channel));
  const combinedRows = combinedLeadNames.flatMap((slug) => leadRowsBySlug.get(slug) ?? []);
  let combinedPolicies = policies;
  for (const slug of combinedLeadNames) {
    const placement = bestByChannel.find((row) => row.channel === slug && row.robustOpenLane);
    if (placement) combinedPolicies = policyWithCandidate(combinedPolicies, String(placement.domain), slug);
  }
  const combined = Object.fromEntries(windows.map((window) => {
    const baseResult = windowResult(baselineRows, combinedPolicies, window.start, window.endExclusive);
    const variant = windowResult([...baselineRows, ...combinedRows], combinedPolicies, window.start, window.endExclusive);
    return [window.id, { ...sessionDelta(baseResult, variant),
      admittedByChannel: Object.fromEntries(combinedLeadNames.map((slug) => [slug, variant.admitted.filter((row) => row.slug === slug).length])),
      displacedIncumbentPaths: Math.max(0, baseResult.admitted.length - variant.admitted.filter((row) => !combinedLeadNames.includes(row.slug)).length) }];
  }));

  const proposedRows = (quantityOverride: Record<string, number> = {}) => WEEKEND_MONDAY_ROSTER.flatMap((decision) => {
    const template = specBySlug.get(decision.channel) ?? domainTemplates.get(decision.collisionDomain);
    if (!template) throw new Error(`${decision.channel}: no replay template for ${decision.collisionDomain}`);
    const domainTemplate = domainTemplates.get(decision.collisionDomain)!;
    const quantity = quantityOverride[decision.channel] ?? decision.quantity;
    const spec: ChannelSpec = { ...template,
      slug: decision.channel,
      accountId: domainTemplate.accountId,
      collisionDomain: decision.collisionDomain,
      familyId: decision.familyId,
      symbolScope: [decision.underlying],
      priority: decision.priority,
      quantity,
      executionPosture: "paper",
      entryParameters: { maxEntriesPerSession: decision.entryCap },
    };
    const manager = baselineManagers[decision.channel] ?? expandedCandidateManagers.get(decision.channel) ?? null;
    return buildRows(decision.channel, spec, manager, quantity, decision.entryCap);
  });
  const proposedPolicies = structuredClone(policies).map((policy) => ({ ...policy,
    priorityBySlug: Object.fromEntries(WEEKEND_MONDAY_ROSTER
      .filter((row) => row.collisionDomain === policy.id)
      .map((row) => [row.channel, row.priority])),
  }));
  const proposedSelectedRows = proposedRows();
  const proposedExact = Object.fromEntries(windows.map((window) => {
    const result = windowResult(proposedSelectedRows, proposedPolicies, window.start, window.endExclusive);
    return [window.id, absoluteRead(result)];
  }));
  const selectedByWindow = Object.fromEntries(windows.map((window) => [window.id,
    windowResult(proposedSelectedRows, proposedPolicies, window.start, window.endExclusive)]));
  const sizeReplay = Object.fromEntries(WEEKEND_MONDAY_ROSTER.map((decision) => [decision.channel,
    Object.fromEntries([1, 2, 3, 4, 5, 6].map((quantity) => {
      const rows = proposedRows({ [decision.channel]: quantity });
      const reads = Object.fromEntries(windows.map((window) => {
        const selected = selectedByWindow[window.id];
        const result = windowResult(rows, proposedPolicies, window.start, window.endExclusive);
        const channelRejections = result.rejected.filter((row) => row.slug === decision.channel);
        const reasons = [...new Set(channelRejections.map((row) => row.reason))].sort();
        return [window.id, { ...absoluteRead(result), deltaVsSelected: sessionDelta(selected, result),
          admittedChannelPaths: result.admitted.filter((row) => row.slug === decision.channel).length,
          channelRejections: Object.fromEntries(reasons.map((reason) => [reason,
            channelRejections.filter((row) => row.reason === reason).length])) }];
      }));
      return [String(quantity), { quantity, selected: quantity === decision.quantity, windows: reads }];
    }))]));
  const sizingPlans = Object.fromEntries(Object.entries({
    selected: {},
    "base-2": { "grind-smart-entries": 2, "vb-level-break": 2 },
    "grind-4": { "grind-smart-entries": 4, "vb-level-break": 2 },
    "level-4": { "grind-smart-entries": 2, "vb-level-break": 4 },
    "evidence-step-4": { "grind-smart-entries": 4, "vb-level-break": 4 },
    "upper-bound-6": { "grind-smart-entries": 6, "vb-level-break": 6 },
  }).map(([id, overrides]) => [id, Object.fromEntries(windows.map((window) => {
    const result = windowResult(proposedRows(overrides), proposedPolicies, window.start, window.endExclusive);
    return [window.id, absoluteRead(result)];
  }))]));

  const coreMarginal = Object.fromEntries(correctedRoster.map((slug) => [slug, Object.fromEntries(windows.map((window) => {
    const baselineResult = windowResult(baselineRows, policies, window.start, window.endExclusive);
    const withoutResult = windowResult(baselineRows.filter((row) => row.slug !== slug), policies, window.start, window.endExclusive);
    const baselineIds = new Set(baselineResult.admitted.map((row) => row.id));
    const substitutes = withoutResult.admitted.filter((row) => !baselineIds.has(row.id));
    const channelRows = baselineResult.admitted.filter((row) => row.slug === slug);
    return [window.id, {
      ...sessionDelta(withoutResult, baselineResult),
      admitted: channelRows.length,
      channelPathSumUsd: round(channelRows.reduce((sum, row) => sum + row.pnlUsd, 0)),
      substitutePathsWhenRemoved: substitutes.length,
      substitutePathSumUsd: round(substitutes.reduce((sum, row) => sum + row.pnlUsd, 0)),
    }];
  }))]));

  const universe = [...correctedRoster, ...robustPlacements.map((row) => String(row.channel))];
  const rosterTournament = combinations(universe, 10).filter((channels) => channels.includes("vb-macd-state")
      && channels.some((slug) => (phenotypeBySlug.get(slug)?.family ?? "").includes("iwm") || slug.endsWith("-iwm"))
      && channels.some((slug) => slug.endsWith("-qqq")))
    .map((channels) => {
      let scenarioPolicies = policies;
      for (const placement of robustPlacements) if (channels.includes(String(placement.channel))) {
        scenarioPolicies = policyWithCandidate(scenarioPolicies, String(placement.domain), String(placement.channel));
      }
      const rows = [
        ...baselineRows.filter((row) => channels.includes(row.slug)),
        ...channels.flatMap((slug) => leadRowsBySlug.get(slug) ?? []),
      ];
      const reads = Object.fromEntries(windows.map((window) => {
        const result = windowResult(rows, scenarioPolicies, window.start, window.endExclusive);
        const sessionPnls = result.sessions.map((row) => row.modeledPnlUsd);
        return [window.id, {
          modeledPnlUsd: result.modeledPnlUsd,
          withoutBestSessionUsd: round(result.modeledPnlUsd - (sessionPnls.length ? Math.max(...sessionPnls) : 0)),
          typicalSessionUsd: round(median(sessionPnls)),
          positiveSessions: sessionPnls.filter((value) => value > 0).length,
          sessions: sessionPnls.length,
          worstSessionUsd: sessionPnls.length ? Math.min(...sessionPnls) : 0,
          admitted: result.admitted.length,
        }];
      }));
      return { channels: [...channels].sort(), windows: reads };
    }).sort((left, right) => right.windows["two-week"].withoutBestSessionUsd - left.windows["two-week"].withoutBestSessionUsd
      || right.windows["three-week"].withoutBestSessionUsd - left.windows["three-week"].withoutBestSessionUsd
      || right.windows["two-week"].modeledPnlUsd - left.windows["two-week"].modeledPnlUsd
      || right.windows["two-week"].worstSessionUsd - left.windows["two-week"].worstSessionUsd);
  const recommendedChannels = WEEKEND_MONDAY_ROSTER.map((row) => row.channel).sort();
  const recommendedRoster = rosterTournament.find((row) => JSON.stringify(row.channels) === JSON.stringify(recommendedChannels));
  if (!recommendedRoster) throw new Error("evidence-led Monday roster was not evaluated in the constrained tournament");

  const momo2Spec = specBySlug.get("momo-shape-2")!;
  const momoSpec: ChannelSpec = { ...momo2Spec, slug: "momo-shape", familyId: "SPY-MOMO", quantity: 2,
    executionPosture: "paper", entryParameters: { maxEntriesPerSession: 1 } };
  const momoRows = buildRows("momo-shape", momoSpec, "FULL-R20-K50", 2, 1);
  const momoPolicies = policyWithReplacement(policies, momo2Spec.collisionDomain, "momo-shape-2", "momo-shape");
  const momoReplacementBase = baselineRows.filter((row) => row.slug !== "momo-shape-2");
  const momoReplacement = Object.fromEntries(windows.map((window) => {
    const baseResult = windowResult(baselineRows, momoPolicies, window.start, window.endExclusive);
    const variant = windowResult([...momoReplacementBase, ...momoRows], momoPolicies, window.start, window.endExclusive);
    return [window.id, { ...sessionDelta(baseResult, variant), admitted: variant.admitted.filter((row) => row.slug === "momo-shape").length }];
  }));

  const report = {
    schemaVersion: 1,
    version: "monday-roster-reconciliation-tournament-2026-08-22-v1",
    generatedAt: (JSON.parse(pathText) as { generatedAt?: string }).generatedAt ?? "2026-08-22T00:00:00.000Z",
    activeManifest: { id: control.compiled.manifest.id, contentHash: control.compiled.manifest.contentHash,
      specs: specs.length, receiptState: control.state },
    intended: { officialPaper: [...officialPaper].sort(), officialObserve: [...officialObserve].sort(), correctedRoster: [...corrected].sort() },
    reconciliation: rosterReconciliation,
    reconciliationSummary: {
      activeSpecs: specs.length,
      runtimePaperSpecs: rosterReconciliation.filter((row) => row.executionPosture === "paper").length,
      runtimeObserveSpecs: rosterReconciliation.filter((row) => row.executionPosture === "observe-only").length,
      mismatches: rosterReconciliation.filter((row) => row.mismatch).length,
      unplannedSpecs: rosterReconciliation.filter((row) => row.intendedClass === "not_in_official_packet").map((row) => row.channel),
      extraCollectors: rosterReconciliation.filter((row) => row.intendedClass === "not_in_official_packet" && row.executionPosture === "observe-only").map((row) => row.channel),
      paperNotInCorrectedRoster: rosterReconciliation.filter((row) => row.executionPosture === "paper" && !row.correctedRoster).map((row) => row.channel),
      correctedRosterNotPaper: rosterReconciliation.filter((row) => row.correctedRoster && row.executionPosture !== "paper").map((row) => row.channel),
    },
    baseline: { roster: [...correctedRoster], managers: baselineManagers, entryOverrides: { "momo-shape-2": { maxEntriesPerSession: 2 } }, windows: baseline },
    familyControls,
    tournament,
    recommendations: {
      openLane: bestByChannel.filter((row) => row.robustOpenLane),
      combinedOpenLanes: combined,
      coreMarginal,
      rosterTournament: {
        universe,
        constraints: ["ten channels", "retain vb-macd-state because WIDE20/50 lacks like-for-like exact path coverage", "at least one QQQ channel", "at least one IWM channel"],
        evaluated: rosterTournament.length,
        recommended: recommendedRoster,
        top: rosterTournament.slice(0, 10),
      },
      proposedExact: {
        channels: WEEKEND_MONDAY_ROSTER.map((row) => row.channel).sort(),
        priorities: Object.fromEntries(WEEKEND_MONDAY_ROSTER.map((row) => [row.channel, row.priority])),
        windows: proposedExact,
      },
      sizeReplay,
      sizingPlans,
      momoSiblingReplacement: momoReplacement,
      hold: bestByChannel.filter((row) => row.read !== "portfolio_compatible_lead").slice(0, 8),
      boundary: "No candidate receives the lane without improving both windows, surviving removal of its best session, and avoiding incumbent displacement at last priority.",
    },
    limitations: [
      "The tournament uses exact option-path managers where named and historical virtual native paths otherwise; it is comparative research, not broker P&L.",
      "Candidates enter at the last priority in each compatible account so they must use genuinely free capacity rather than win by displacing incumbents.",
      "Known sibling candidates retain the incumbent strategy family, so same-domain family and OCC protections are not bypassed by a renamed channel.",
      "The corrected eight-channel roster is a research baseline, not proof that production currently matches it.",
      "Cross-account same-OCC is permitted according to the active admission policies; within-domain capacity and same-OCC rules remain active.",
      "No production writes, roster changes, manager changes, sizing changes, orders, or positions occur in this script.",
    ],
    authority: { productionWrites: 0, brokerWrites: 0, orderAuthority: false },
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = [
    "# Monday roster reconciliation and open-lane tournament", "",
    `**Active manifest ${report.activeManifest.contentHash} · SELECT-only · no production changes**`, "",
    `The live control plane contains ${report.reconciliationSummary.activeSpecs} specs: ${report.reconciliationSummary.runtimePaperSpecs} paper-entry specs and ${report.reconciliationSummary.runtimeObserveSpecs} observe-only collectors. ${report.reconciliationSummary.mismatches} conflict with the official paper/observe intent.`, "",
    "## Reconciliation", "",
    "| Channel | Intended | Runtime posture | Corrected roster | Mismatch |",
    "|---|---|---:|---:|---|",
    ...rosterReconciliation.map((row) => `| ${row.channel} | ${row.intendedClass.replaceAll("_", " ")} | ${row.executionPosture} | ${row.correctedRoster ? "yes" : "no"} | ${row.mismatch ?? "—"} |`),
    "", "## Open-lane tournament", "",
    "Candidates enter last in each compatible account and must use free capacity rather than displace an incumbent.", "",
    "| Candidate | Route | Exit | 3w delta | 3w without best | 2w delta | 2w without best | Displaced | Read |",
    "|---|---|---|---:|---:|---:|---:|---:|---|",
    ...tournament.map((row: any) => `| ${row.channel} | ${row.domain} | ${row.manager} | $${row.windows["three-week"].totalUsd} | $${row.windows["three-week"].withoutBestSessionUsd} | $${row.windows["two-week"].totalUsd} | $${row.windows["two-week"].withoutBestSessionUsd} | ${row.windows["three-week"].displacedIncumbentPaths}/${row.windows["two-week"].displacedIncumbentPaths} | ${row.read.replaceAll("_", " ")} |`),
    "", report.recommendations.boundary, "", "No production behavior changed.", "",
  ].join("\n");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "report.json"), body);
  writeFileSync(resolve(outputDir, "report.md"), markdown);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({
    generatedAt: report.generatedAt,
    inputs: { snapshot: `sha256:${createHash("sha256").update(snapshotText).digest("hex")}`,
      paths: `sha256:${createHash("sha256").update(pathText).digest("hex")}`,
      phenotype: `sha256:${createHash("sha256").update(phenotypeText).digest("hex")}` },
    report: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    productionWrites: 0,
    orderAuthority: false,
  }, null, 2)}\n`);
  console.log(`monday-roster-reconciliation-tournament: PASS · ${specs.length} live specs · ${report.reconciliationSummary.mismatches} intent mismatches · ${tournament.length} lane scenarios · ${report.recommendations.openLane.length} unique robust leads`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
