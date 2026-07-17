// Prospective-only scorer for Weekend Day 1. This contract intentionally does
// not alter or reinterpret phase1k-e-family-preregister-v1 results.

export const DAY1_PROSPECTIVE_SCORER_VERSION = "weekend-day1-prospective-scorer-v1" as const;
export const DAY1_PROSPECTIVE_COHORT_START_ET = "2026-07-20" as const;
export const DAY1_ZERO_DELTA_RULE = "all_complete_groups_including_zero_delta" as const;

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
  totalDelta: number;
  medianDelta: number | null;
  positiveDelta: number;
  negativeDelta: number;
  zeroDelta: number;
  positiveDeltaShare: number | null;
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

export interface ProspectiveScorecard {
  scorerVersion: typeof DAY1_PROSPECTIVE_SCORER_VERSION;
  cohortStartEt: typeof DAY1_PROSPECTIVE_COHORT_START_ET;
  positiveDeltaShareDenominator: typeof DAY1_ZERO_DELTA_RULE;
  scores: ProspectiveMatchedPairScore[];
  censoredRows: number;
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clean = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const round = (value: number, digits = 4): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

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

export function buildDay1ProspectiveScorecard(rows: readonly ProspectiveMatchedPairInput[]): ProspectiveScorecard {
  const preCohort = rows.find((row) => row.sessionDateEt < DAY1_PROSPECTIVE_COHORT_START_ET);
  if (preCohort) {
    throw new Error(`Prospective scorer rejects pre-${DAY1_PROSPECTIVE_COHORT_START_ET} row ${preCohort.comparisonId}`);
  }

  const groups = new Map<string, {
    testId: string;
    controlIdentity: ProspectivePolicyIdentity;
    challengerIdentity: ProspectivePolicyIdentity;
    rows: ProspectiveMatchedPairInput[];
  }>();
  let censoredRows = 0;

  for (const row of rows) {
    let controlKey: string;
    let challengerKey: string;
    try {
      controlKey = prospectivePolicyIdentityKey(row.controlIdentity);
      challengerKey = prospectivePolicyIdentityKey(row.challengerIdentity);
    } catch {
      censoredRows += 1;
      continue;
    }
    if (row.eligible === false || !clean(row.testId) || !clean(row.comparisonId) || !clean(row.clockId)
      || !finite(row.controlPnl) || !finite(row.challengerPnl)) {
      censoredRows += 1;
      continue;
    }
    const key = `${encodeURIComponent(row.testId)}::${controlKey}::${challengerKey}`;
    const group = groups.get(key) ?? {
      testId: row.testId,
      controlIdentity: row.controlIdentity,
      challengerIdentity: row.challengerIdentity,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }

  const scores = [...groups.entries()].map(([policyKey, group]): ProspectiveMatchedPairScore => {
    const deltas = group.rows.map((row) => round(row.challengerPnl - row.controlPnl, 2));
    const positiveDelta = deltas.filter((delta) => delta > 0).length;
    return {
      scorerVersion: DAY1_PROSPECTIVE_SCORER_VERSION,
      cohortStartEt: DAY1_PROSPECTIVE_COHORT_START_ET,
      positiveDeltaShareDenominator: DAY1_ZERO_DELTA_RULE,
      testId: group.testId,
      controlIdentity: group.controlIdentity,
      challengerIdentity: group.challengerIdentity,
      policyKey,
      completedGroups: group.rows.length,
      censoredGroups: 0,
      independentSessions: new Set(group.rows.map((row) => row.sessionDateEt)).size,
      totalDelta: round(deltas.reduce((sum, delta) => sum + delta, 0), 2),
      medianDelta: median(deltas),
      positiveDelta,
      negativeDelta: deltas.filter((delta) => delta < 0).length,
      zeroDelta: deltas.filter((delta) => delta === 0).length,
      positiveDeltaShare: deltas.length ? round(positiveDelta / deltas.length) : null,
      policyChangeAuthorized: false,
      productionChangeAuthorized: false,
    };
  }).sort((left, right) => left.policyKey.localeCompare(right.policyKey));

  return {
    scorerVersion: DAY1_PROSPECTIVE_SCORER_VERSION,
    cohortStartEt: DAY1_PROSPECTIVE_COHORT_START_ET,
    positiveDeltaShareDenominator: DAY1_ZERO_DELTA_RULE,
    scores,
    censoredRows,
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
  };
}
