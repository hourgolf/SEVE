import type { DarkCandidateFreeze } from "./darkCandidateFreeze.js";
import type { VbCandidateScorecard } from "./vbCandidateEvidence.js";
import { managerIdsForChannel } from "../../engine/managerPolicy.js";

export const DARK_EVIDENCE_COMPLETENESS_VERSION = "dark-evidence-completeness-v1" as const;

export type DarkEvidenceState =
  | "no_candidates"
  | "exact_pending"
  | "complete"
  | "partial"
  | "censored";

export type DarkEvidenceTone = "green" | "amber" | "red" | "neutral";

export interface DarkEvidenceChannelSummary {
  channelSlug: string;
  frozen: number;
  exactEligible: number;
  exactCensored: number;
  exactMissing: number;
  completedManagerArms: number;
  expectedManagerArms: number;
}

export interface DarkEvidenceCompleteness {
  version: typeof DARK_EVIDENCE_COMPLETENESS_VERSION;
  sessionDateEt: string;
  state: DarkEvidenceState;
  tone: DarkEvidenceTone;
  gateReady: boolean;
  gateReadyAt: string;
  counts: {
    sourceSignals: number;
    frozenCandidates: number;
    freezeCensors: number;
    exactContracts: number;
    exactScorecards: number;
    exactEligible: number;
    exactCensored: number;
    exactMissing: number;
    completedManagerArms: number;
    expectedManagerArms: number;
  };
  blockers: string[];
  byChannel: DarkEvidenceChannelSummary[];
  externalWrites: false;
  orderPathAuthorized: false;
  policyChangeAuthorized: false;
}

const unique = (values: readonly string[]): string[] => [...new Set(values)].sort();

export function deriveDarkEvidenceCompleteness(input: {
  freeze: DarkCandidateFreeze;
  scorecards?: readonly VbCandidateScorecard[];
  nowMs: number;
  exactGateReadyAtMs: number;
  expectedManagerArms?: number;
}): DarkEvidenceCompleteness {
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.exactGateReadyAtMs) || (input.expectedManagerArms != null && input.expectedManagerArms <= 0)) {
    throw new Error("invalid dark evidence completeness clock or manager-arm count");
  }
  const gateReady = input.nowMs >= input.exactGateReadyAtMs;
  const candidateIds = new Set(input.freeze.candidates.map((row) => row.candidateId));
  const scorecardGroups = new Map<string, VbCandidateScorecard[]>();
  const blockers: string[] = [];
  for (const scorecard of input.scorecards ?? []) {
    if (!candidateIds.has(scorecard.candidateId)) {
      blockers.push(`unexpected-scorecard:${scorecard.candidateId}`);
      continue;
    }
    const rows = scorecardGroups.get(scorecard.candidateId) ?? [];
    rows.push(scorecard);
    scorecardGroups.set(scorecard.candidateId, rows);
  }

  let exactEligible = 0;
  let exactCensored = 0;
  let exactMissing = 0;
  let completedManagerArms = 0;
  const byChannel = new Map<string, DarkEvidenceChannelSummary>();
  let expectedManagerArms = 0;
  for (const candidate of input.freeze.candidates) {
    const expectedPerCandidate = input.expectedManagerArms ?? managerIdsForChannel(candidate.channelSlug).length;
    expectedManagerArms += expectedPerCandidate;
    const channel = byChannel.get(candidate.channelSlug) ?? {
      channelSlug: candidate.channelSlug,
      frozen: 0,
      exactEligible: 0,
      exactCensored: 0,
      exactMissing: 0,
      completedManagerArms: 0,
      expectedManagerArms: 0,
    };
    channel.frozen++;
    channel.expectedManagerArms += expectedPerCandidate;
    const rows = scorecardGroups.get(candidate.candidateId) ?? [];
    if (rows.length === 0) {
      exactMissing++;
      channel.exactMissing++;
      if (gateReady) blockers.push(`exact-missing:${candidate.candidateId}`);
    } else if (rows.length > 1) {
      exactCensored++;
      channel.exactCensored++;
      blockers.push(`conflicting-scorecards:${candidate.candidateId}`);
    } else {
      const scorecard = rows[0];
      const armIds = unique(scorecard.exactArms.map((arm) => arm.managerId));
      completedManagerArms += armIds.length;
      channel.completedManagerArms += armIds.length;
      if (scorecard.eligible && scorecard.censors.length === 0
          && scorecard.exactEntryAsk != null && scorecard.exactEntryAsk > 0
          && armIds.length === expectedPerCandidate) {
        exactEligible++;
        channel.exactEligible++;
      } else {
        exactCensored++;
        channel.exactCensored++;
        const codes = scorecard.censors.length ? unique(scorecard.censors) : ["incomplete-manager-arms"];
        blockers.push(...codes.map((code) => `exact-censored:${candidate.candidateId}:${code}`));
      }
    }
    byChannel.set(candidate.channelSlug, channel);
  }
  if (input.freeze.censors.length) blockers.push(...Object.entries(input.freeze.summary.byCensor).map(([code, count]) => `freeze-censored:${code}:${count}`));

  const frozenCandidates = input.freeze.candidates.length;
  const freezeCensors = input.freeze.censors.length;
  let state: DarkEvidenceState;
  let tone: DarkEvidenceTone;
  if (frozenCandidates === 0 && freezeCensors === 0) {
    state = "no_candidates";
    tone = "neutral";
  } else if (frozenCandidates === 0) {
    state = "censored";
    tone = "red";
  } else if (exactEligible === frozenCandidates && freezeCensors === 0 && blockers.length === 0) {
    state = "complete";
    tone = "green";
  } else if (!gateReady && exactMissing === frozenCandidates && exactCensored === 0 && freezeCensors === 0) {
    state = "exact_pending";
    tone = "amber";
  } else if (exactEligible === 0 && (exactCensored > 0 || freezeCensors > 0 || (gateReady && exactMissing > 0))) {
    state = "censored";
    tone = "red";
  } else {
    state = "partial";
    tone = gateReady ? "red" : "amber";
  }

  return {
    version: DARK_EVIDENCE_COMPLETENESS_VERSION,
    sessionDateEt: input.freeze.sessionDateEt,
    state,
    tone,
    gateReady,
    gateReadyAt: new Date(input.exactGateReadyAtMs).toISOString(),
    counts: {
      sourceSignals: input.freeze.sourceCounts.signals,
      frozenCandidates,
      freezeCensors,
      exactContracts: input.freeze.contractRequests.length,
      exactScorecards: [...scorecardGroups.values()].reduce((sum, rows) => sum + rows.length, 0),
      exactEligible,
      exactCensored,
      exactMissing,
      completedManagerArms,
      expectedManagerArms,
    },
    blockers: unique(blockers),
    byChannel: [...byChannel.values()].sort((a, b) => a.channelSlug.localeCompare(b.channelSlug)),
    externalWrites: false,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
}
