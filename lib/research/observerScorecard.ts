// Pure Phase 1J review model. It grades observation-only Phase 1I receipts;
// it cannot subscribe, write evidence, alter strategy policy, or place orders.

export const OBSERVER_SCORECARD_SCHEMA_VERSION = 1 as const;
export const PB2_MANAGER_ID = "PB2-BANK15/HALF-GIVEBACK" as const;

export interface AdmissionCandidateReceipt {
  opportunityId: string;
  channelSlug: string;
  requestedQty: number;
  posture?: "native-accepted" | "day1-paper-root" | "day1-dark-candidate";
  releaseId?: string | null;
  configurationSha256?: string | null;
  occSymbol?: string;
}

export interface AdmissionArmReceipt {
  keepOpportunityId: string;
  rejectOpportunityIds: string[];
}

export interface FamilyAdmissionReceipt {
  id: string;
  familyId: string;
  sourceBarAt: string;
  candidates: AdmissionCandidateReceipt[];
  admissionArms: AdmissionArmReceipt[];
}

export interface OpportunityOutcomeReceipt {
  opportunityId: string;
  realizedPnl: number;
}

export interface Pb2ShadowReceipt {
  id: string;
  sessionDateEt: string;
  status: "active" | "terminal" | "censored";
  terminalPnl: number | null;
  actualRealizedPnl: number | null;
  bankReturnPct: number | null;
  censorCode: string | null;
}

export interface EvidenceThresholds {
  pb2CompletedPaths: number;
  familyCompletedGroups: number;
  independentSessions: number;
}

export const DEFAULT_EVIDENCE_THRESHOLDS: Readonly<EvidenceThresholds> = {
  pb2CompletedPaths: 20,
  familyCompletedGroups: 10,
  independentSessions: 5,
};

export interface AdmissionArmScore {
  keepOpportunityId: string;
  keepChannelSlug: string;
  armPnl: number;
  deltaVsNative: number;
}

export interface FamilyGroupScore {
  observationId: string;
  familyId: string;
  sessionDateEt: string;
  nativePnl: number;
  arms: AdmissionArmScore[];
}

export interface FamilyAdmissionScorecard {
  observedGroups: number;
  completedGroups: number;
  censoredGroups: number;
  independentSessions: number;
  nativeWinningGroups: number;
  nativeLosingGroups: number;
  groups: FamilyGroupScore[];
  channels: Array<{
    familyId: string;
    channelSlug: string;
    completedGroups: number;
    survivorPnl: number;
    deltaVsNative: number;
  }>;
  evidenceFloorMet: boolean;
  blockers: string[];
}

export interface Pb2Scorecard {
  observedPaths: number;
  completedPaths: number;
  censoredPaths: number;
  activePaths: number;
  bankTriggeredPaths: number;
  independentSessions: number;
  actualWinningPaths: number;
  actualLosingPaths: number;
  actualPnl: number;
  modeledPnl: number;
  deltaVsActual: number;
  evidenceFloorMet: boolean;
  blockers: string[];
}

export interface ObserverScorecard {
  schemaVersion: typeof OBSERVER_SCORECARD_SCHEMA_VERSION;
  familyAdmission: FamilyAdmissionScorecard;
  pb2: Pb2Scorecard;
  promotionEligible: false;
  promotionReason: string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const round2 = (value: number): number => Math.round(value * 100) / 100;

function etDate(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function familyScorecard(
  observations: readonly FamilyAdmissionReceipt[],
  outcomes: readonly OpportunityOutcomeReceipt[],
  thresholds: EvidenceThresholds,
): FamilyAdmissionScorecard {
  const pnlByOpportunity = new Map<string, number>();
  for (const outcome of outcomes) {
    if (!outcome.opportunityId || !finite(outcome.realizedPnl)) continue;
    pnlByOpportunity.set(
      outcome.opportunityId,
      round2((pnlByOpportunity.get(outcome.opportunityId) ?? 0) + outcome.realizedPnl),
    );
  }

  const groups: FamilyGroupScore[] = [];
  let censoredGroups = 0;
  for (const observation of observations) {
    const sessionDateEt = etDate(observation.sourceBarAt);
    const candidates = observation.candidates.filter((candidate) => candidate.opportunityId && candidate.channelSlug);
    const uniqueIds = new Set(candidates.map((candidate) => candidate.opportunityId));
    if (!sessionDateEt || candidates.length < 2 || uniqueIds.size !== candidates.length
        || candidates.some((candidate) => !pnlByOpportunity.has(candidate.opportunityId))) {
      censoredGroups += 1;
      continue;
    }
    const nativePnl = round2(candidates.reduce((sum, candidate) => sum + (pnlByOpportunity.get(candidate.opportunityId) ?? 0), 0));
    const candidateById = new Map(candidates.map((candidate) => [candidate.opportunityId, candidate]));
    const arms = observation.admissionArms.flatMap((arm): AdmissionArmScore[] => {
      const keep = candidateById.get(arm.keepOpportunityId);
      const rejected = new Set(arm.rejectOpportunityIds);
      if (!keep || rejected.size !== candidates.length - 1
          || candidates.some((candidate) => candidate.opportunityId !== keep.opportunityId && !rejected.has(candidate.opportunityId))) return [];
      const armPnl = pnlByOpportunity.get(keep.opportunityId) ?? 0;
      return [{
        keepOpportunityId: keep.opportunityId,
        keepChannelSlug: keep.channelSlug,
        armPnl: round2(armPnl),
        deltaVsNative: round2(armPnl - nativePnl),
      }];
    });
    if (arms.length !== candidates.length) {
      censoredGroups += 1;
      continue;
    }
    groups.push({
      observationId: observation.id,
      familyId: observation.familyId,
      sessionDateEt,
      nativePnl,
      arms: arms.sort((a, b) => b.deltaVsNative - a.deltaVsNative || a.keepChannelSlug.localeCompare(b.keepChannelSlug)),
    });
  }

  const channelMap = new Map<string, { familyId: string; channelSlug: string; completedGroups: number; survivorPnl: number; deltaVsNative: number }>();
  for (const group of groups) {
    for (const arm of group.arms) {
      const key = `${group.familyId}|${arm.keepChannelSlug}`;
      const row = channelMap.get(key) ?? { familyId: group.familyId, channelSlug: arm.keepChannelSlug, completedGroups: 0, survivorPnl: 0, deltaVsNative: 0 };
      row.completedGroups += 1;
      row.survivorPnl = round2(row.survivorPnl + arm.armPnl);
      row.deltaVsNative = round2(row.deltaVsNative + arm.deltaVsNative);
      channelMap.set(key, row);
    }
  }

  const independentSessions = new Set(groups.map((group) => group.sessionDateEt)).size;
  const nativeWinningGroups = groups.filter((group) => group.nativePnl > 0).length;
  const nativeLosingGroups = groups.filter((group) => group.nativePnl < 0).length;
  const blockers: string[] = [];
  if (groups.length < thresholds.familyCompletedGroups) blockers.push(`need ${thresholds.familyCompletedGroups - groups.length} more completed collision groups`);
  if (independentSessions < thresholds.independentSessions) blockers.push(`need ${thresholds.independentSessions - independentSessions} more independent sessions`);
  if (nativeWinningGroups === 0) blockers.push("need at least one native winning collision path");
  if (nativeLosingGroups === 0) blockers.push("need at least one native losing collision path");

  return {
    observedGroups: observations.length,
    completedGroups: groups.length,
    censoredGroups,
    independentSessions,
    nativeWinningGroups,
    nativeLosingGroups,
    groups: groups.sort((a, b) => a.sessionDateEt.localeCompare(b.sessionDateEt) || a.observationId.localeCompare(b.observationId)),
    channels: [...channelMap.values()].sort((a, b) => a.familyId.localeCompare(b.familyId) || b.deltaVsNative - a.deltaVsNative || a.channelSlug.localeCompare(b.channelSlug)),
    evidenceFloorMet: blockers.length === 0,
    blockers,
  };
}

function pb2Scorecard(runs: readonly Pb2ShadowReceipt[], thresholds: EvidenceThresholds): Pb2Scorecard {
  const completed = runs.filter((run) => run.status === "terminal" && finite(run.terminalPnl) && finite(run.actualRealizedPnl));
  const censoredPaths = runs.filter((run) => run.status === "censored" || (run.status === "terminal" && (!finite(run.terminalPnl) || !finite(run.actualRealizedPnl)))).length;
  const actualPnl = round2(completed.reduce((sum, run) => sum + (run.actualRealizedPnl ?? 0), 0));
  const modeledPnl = round2(completed.reduce((sum, run) => sum + (run.terminalPnl ?? 0), 0));
  const independentSessions = new Set(completed.map((run) => run.sessionDateEt)).size;
  const actualWinningPaths = completed.filter((run) => (run.actualRealizedPnl ?? 0) > 0).length;
  const actualLosingPaths = completed.filter((run) => (run.actualRealizedPnl ?? 0) < 0).length;
  const blockers: string[] = [];
  if (completed.length < thresholds.pb2CompletedPaths) blockers.push(`need ${thresholds.pb2CompletedPaths - completed.length} more completed PB2 paths`);
  if (independentSessions < thresholds.independentSessions) blockers.push(`need ${thresholds.independentSessions - independentSessions} more independent sessions`);
  if (actualWinningPaths === 0) blockers.push("need at least one native winning PB2 path");
  if (actualLosingPaths === 0) blockers.push("need at least one native losing PB2 path");
  return {
    observedPaths: runs.length,
    completedPaths: completed.length,
    censoredPaths,
    activePaths: runs.filter((run) => run.status === "active").length,
    bankTriggeredPaths: completed.filter((run) => finite(run.bankReturnPct)).length,
    independentSessions,
    actualWinningPaths,
    actualLosingPaths,
    actualPnl,
    modeledPnl,
    deltaVsActual: round2(modeledPnl - actualPnl),
    evidenceFloorMet: blockers.length === 0,
    blockers,
  };
}

export function buildObserverScorecard(input: {
  familyObservations: readonly FamilyAdmissionReceipt[];
  opportunityOutcomes: readonly OpportunityOutcomeReceipt[];
  pb2Runs: readonly Pb2ShadowReceipt[];
  thresholds?: Partial<EvidenceThresholds>;
}): ObserverScorecard {
  const thresholds: EvidenceThresholds = { ...DEFAULT_EVIDENCE_THRESHOLDS, ...(input.thresholds ?? {}) };
  if (!Number.isInteger(thresholds.pb2CompletedPaths) || thresholds.pb2CompletedPaths < 1
      || !Number.isInteger(thresholds.familyCompletedGroups) || thresholds.familyCompletedGroups < 1
      || !Number.isInteger(thresholds.independentSessions) || thresholds.independentSessions < 1) {
    throw new Error("observer scorecard thresholds must be positive integers");
  }
  return {
    schemaVersion: OBSERVER_SCORECARD_SCHEMA_VERSION,
    familyAdmission: familyScorecard(input.familyObservations, input.opportunityOutcomes, thresholds),
    pb2: pb2Scorecard(input.pb2Runs, thresholds),
    promotionEligible: false,
    promotionReason: "Evidence floors are review gates only; strategy promotion always requires an explicit operator decision.",
  };
}
