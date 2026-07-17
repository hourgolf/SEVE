// Prospective-only scorer for Weekend Day 1. This contract intentionally does
// not alter or reinterpret phase1k-e-family-preregister-v1 results.

export const DAY1_PROSPECTIVE_SCORER_VERSION = "weekend-day1-prospective-scorer-v2" as const;
export const DAY1_PROSPECTIVE_COHORT_START_ET = "2026-07-20" as const;
export const DAY1_ZERO_DELTA_RULE = "all_complete_groups_including_zero_delta" as const;
export const DAY1_OPPORTUNITY_CLUSTER_RULE = "session_date_et_plus_clock_id" as const;
export const DAY1_PORTFOLIO_RULE = "separate_policy_comparisons_no_portfolio_weighting_preregistered" as const;
export const DAY1_EVIDENCE_FLOOR = Object.freeze({
  independentOpportunities: 10,
  independentSessions: 5,
});

export interface ProspectiveOpportunityClusterMetric {
  opportunityKey: string;
  sessionDateEt: string;
  clockId: string;
  comparisonGroups: number;
}

export interface ProspectivePolicyIdentity {
  channelSlug: string;
  channelVersion: string;
  managerVersion: string;
  configurationEpoch: string;
}

export interface ProspectiveMatchedPairInput {
  testId: string;
  comparisonId: string;
  sessionDateEt: string;
  clockId: string;
  provenanceId: string;
  controlIdentity: ProspectivePolicyIdentity;
  challengerIdentity: ProspectivePolicyIdentity;
  controlPnl: number;
  challengerPnl: number;
  eligible?: boolean;
}

export interface ProspectiveMatchedPairScore {
  scorerVersion: typeof DAY1_PROSPECTIVE_SCORER_VERSION;
  cohortStartEt: typeof DAY1_PROSPECTIVE_COHORT_START_ET;
  positiveDeltaShareDenominator: typeof DAY1_ZERO_DELTA_RULE;
  testId: string;
  controlIdentity: ProspectivePolicyIdentity;
  challengerIdentity: ProspectivePolicyIdentity;
  policyKey: string;
  completedGroups: number;
  censoredGroups: number;
  independentSessions: number;
  independentOpportunities: number;
  opportunityClusterRule: typeof DAY1_OPPORTUNITY_CLUSTER_RULE;
  opportunityClusters: ProspectiveOpportunityClusterMetric[];
  opportunityClusterInvariantSatisfied: boolean;
  evidenceFloor: typeof DAY1_EVIDENCE_FLOOR;
  evidenceFloorMet: boolean;
  evidenceFloorBlockers: string[];
  exactDuplicatesIgnored: number;
  conflictingDuplicateGroups: number;
  totalDelta: number;
  medianDelta: number | null;
  positiveDelta: number;
  negativeDelta: number;
  zeroDelta: number;
  positiveDeltaShare: number | null;
  portfolioRule: typeof DAY1_PORTFOLIO_RULE;
  portfolioWeightingRule: null;
  portfolioClaimAuthorized: false;
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

export interface ProspectiveScorecard {
  scorerVersion: typeof DAY1_PROSPECTIVE_SCORER_VERSION;
  cohortStartEt: typeof DAY1_PROSPECTIVE_COHORT_START_ET;
  positiveDeltaShareDenominator: typeof DAY1_ZERO_DELTA_RULE;
  opportunityClusterRule: typeof DAY1_OPPORTUNITY_CLUSTER_RULE;
  evidenceFloor: typeof DAY1_EVIDENCE_FLOOR;
  portfolioRule: typeof DAY1_PORTFOLIO_RULE;
  portfolioWeightingRule: null;
  portfolioClaimAuthorized: false;
  scores: ProspectiveMatchedPairScore[];
  censoredRows: number;
  exactDuplicatesIgnored: number;
  conflictingDuplicateGroups: number;
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clean = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const round = (value: number, digits = 4): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

function validEtDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function prospectivePolicyIdentityKey(identity: ProspectivePolicyIdentity): string {
  if (![identity.channelSlug, identity.channelVersion, identity.managerVersion, identity.configurationEpoch].every(clean)) {
    throw new Error("Prospective policy identity requires channel slug/version, manager version, and configuration epoch");
  }
  return [identity.channelSlug, identity.channelVersion, identity.managerVersion, identity.configurationEpoch]
    .map((part) => encodeURIComponent(part))
    .join("|");
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return round(ordered.length % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
}

interface CanonicalRow {
  row: ProspectiveMatchedPairInput;
  policyKey: string;
  controlKey: string;
  challengerKey: string;
  identityKey: string;
  fingerprint: string;
  inputRows: number;
  exactDuplicates: number;
  conflict: boolean;
}

export function buildDay1ProspectiveScorecard(rows: readonly ProspectiveMatchedPairInput[]): ProspectiveScorecard {
  const canonical = new Map<string, CanonicalRow>();
  let invalidRows = 0;

  for (const row of rows) {
    if (!validEtDate(row.sessionDateEt)) { invalidRows++; continue; }
    if (row.sessionDateEt < DAY1_PROSPECTIVE_COHORT_START_ET) {
      throw new Error(`Prospective scorer rejects pre-${DAY1_PROSPECTIVE_COHORT_START_ET} row ${row.comparisonId}`);
    }
    let controlKey: string;
    let challengerKey: string;
    try {
      controlKey = prospectivePolicyIdentityKey(row.controlIdentity);
      challengerKey = prospectivePolicyIdentityKey(row.challengerIdentity);
    } catch { invalidRows++; continue; }
    if (!clean(row.testId) || !clean(row.comparisonId) || !clean(row.clockId) || !clean(row.provenanceId)
        || !finite(row.controlPnl) || !finite(row.challengerPnl)) {
      invalidRows++;
      continue;
    }
    const policyKey = `${encodeURIComponent(row.testId)}::${controlKey}::${challengerKey}`;
    const identityKey = [row.testId, row.comparisonId, row.clockId, row.sessionDateEt, controlKey, challengerKey]
      .map(encodeURIComponent).join("::");
    const fingerprint = JSON.stringify({
      provenanceId: row.provenanceId,
      controlPnl: row.controlPnl,
      challengerPnl: row.challengerPnl,
      eligible: row.eligible !== false,
    });
    const prior = canonical.get(identityKey);
    if (!prior) {
      canonical.set(identityKey, {
        row, policyKey, controlKey, challengerKey, identityKey, fingerprint,
        inputRows: 1, exactDuplicates: 0, conflict: false,
      });
      continue;
    }
    prior.inputRows++;
    if (prior.fingerprint === fingerprint) prior.exactDuplicates++;
    else prior.conflict = true;
  }

  const groups = new Map<string, {
    testId: string;
    controlIdentity: ProspectivePolicyIdentity;
    challengerIdentity: ProspectivePolicyIdentity;
    complete: ProspectiveMatchedPairInput[];
    censoredGroups: number;
    censoredRows: number;
    exactDuplicates: number;
    conflictingGroups: number;
  }>();
  for (const item of canonical.values()) {
    const group = groups.get(item.policyKey) ?? {
      testId: item.row.testId,
      controlIdentity: item.row.controlIdentity,
      challengerIdentity: item.row.challengerIdentity,
      complete: [], censoredGroups: 0, censoredRows: 0, exactDuplicates: 0, conflictingGroups: 0,
    };
    if (item.conflict) {
      group.censoredGroups++;
      group.censoredRows += item.inputRows;
      group.conflictingGroups++;
    } else if (item.row.eligible === false) {
      group.censoredGroups++;
      group.censoredRows++;
      group.exactDuplicates += item.exactDuplicates;
    } else {
      group.complete.push(item.row);
      group.exactDuplicates += item.exactDuplicates;
    }
    groups.set(item.policyKey, group);
  }

  const scores = [...groups.entries()].map(([policyKey, group]): ProspectiveMatchedPairScore => {
    const deltas = group.complete.map((row) => round(row.challengerPnl - row.controlPnl, 2));
    const positiveDelta = deltas.filter((delta) => delta > 0).length;
    const opportunityMap = new Map<string, ProspectiveOpportunityClusterMetric>();
    for (const row of group.complete) {
      const opportunityKey = `${row.sessionDateEt}|${row.clockId}`;
      const cluster = opportunityMap.get(opportunityKey) ?? {
        opportunityKey,
        sessionDateEt: row.sessionDateEt,
        clockId: row.clockId,
        comparisonGroups: 0,
      };
      cluster.comparisonGroups++;
      opportunityMap.set(opportunityKey, cluster);
    }
    const opportunityClusters = [...opportunityMap.values()]
      .sort((left, right) => left.opportunityKey.localeCompare(right.opportunityKey));
    const independentSessions = new Set(group.complete.map((row) => row.sessionDateEt)).size;
    const independentOpportunities = opportunityClusters.length;
    const evidenceFloorBlockers = [
      ...(independentOpportunities < DAY1_EVIDENCE_FLOOR.independentOpportunities
        ? [`independent_opportunities_${independentOpportunities}_below_${DAY1_EVIDENCE_FLOOR.independentOpportunities}`]
        : []),
      ...(independentSessions < DAY1_EVIDENCE_FLOOR.independentSessions
        ? [`independent_sessions_${independentSessions}_below_${DAY1_EVIDENCE_FLOOR.independentSessions}`]
        : []),
    ];
    return {
      scorerVersion: DAY1_PROSPECTIVE_SCORER_VERSION,
      cohortStartEt: DAY1_PROSPECTIVE_COHORT_START_ET,
      positiveDeltaShareDenominator: DAY1_ZERO_DELTA_RULE,
      testId: group.testId,
      controlIdentity: group.controlIdentity,
      challengerIdentity: group.challengerIdentity,
      policyKey,
      completedGroups: group.complete.length,
      censoredGroups: group.censoredGroups,
      independentSessions,
      independentOpportunities,
      opportunityClusterRule: DAY1_OPPORTUNITY_CLUSTER_RULE,
      opportunityClusters,
      opportunityClusterInvariantSatisfied:
        opportunityClusters.reduce((sum, cluster) => sum + cluster.comparisonGroups, 0) === group.complete.length,
      evidenceFloor: DAY1_EVIDENCE_FLOOR,
      evidenceFloorMet: evidenceFloorBlockers.length === 0,
      evidenceFloorBlockers,
      exactDuplicatesIgnored: group.exactDuplicates,
      conflictingDuplicateGroups: group.conflictingGroups,
      totalDelta: round(deltas.reduce((sum, delta) => sum + delta, 0), 2),
      medianDelta: median(deltas),
      positiveDelta,
      negativeDelta: deltas.filter((delta) => delta < 0).length,
      zeroDelta: deltas.filter((delta) => delta === 0).length,
      positiveDeltaShare: deltas.length ? round(positiveDelta / deltas.length) : null,
      portfolioRule: DAY1_PORTFOLIO_RULE,
      portfolioWeightingRule: null,
      portfolioClaimAuthorized: false,
      policyChangeAuthorized: false,
      productionChangeAuthorized: false,
    };
  }).sort((left, right) => left.policyKey.localeCompare(right.policyKey));

  return {
    scorerVersion: DAY1_PROSPECTIVE_SCORER_VERSION,
    cohortStartEt: DAY1_PROSPECTIVE_COHORT_START_ET,
    positiveDeltaShareDenominator: DAY1_ZERO_DELTA_RULE,
    opportunityClusterRule: DAY1_OPPORTUNITY_CLUSTER_RULE,
    evidenceFloor: DAY1_EVIDENCE_FLOOR,
    portfolioRule: DAY1_PORTFOLIO_RULE,
    portfolioWeightingRule: null,
    portfolioClaimAuthorized: false,
    scores,
    censoredRows: invalidRows + [...groups.values()].reduce((sum, group) => sum + group.censoredRows, 0),
    exactDuplicatesIgnored: scores.reduce((sum, score) => sum + score.exactDuplicatesIgnored, 0),
    conflictingDuplicateGroups: scores.reduce((sum, score) => sum + score.conflictingDuplicateGroups, 0),
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
  };
}
