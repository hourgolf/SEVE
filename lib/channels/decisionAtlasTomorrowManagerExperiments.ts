import type {
  ChannelRatchetPolicy,
  ChannelTakeProfitPolicy,
  CompiledReleaseManifest,
} from "./channelControlPlane";
import type { OperatorProposalRequest } from "./channelProposalWrite";

export const DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS_VERSION =
  "decision-atlas-tomorrow-manager-experiments-v1" as const;

const NONE: ChannelRatchetPolicy = Object.freeze({
  kind: "none",
  engageReturnPct: null,
  givebackPct: null,
  retainGainPct: null,
  fixedTargetPct: null,
});

const A13: ChannelRatchetPolicy = Object.freeze({
  kind: "a13",
  engageReturnPct: 50,
  givebackPct: 33,
  retainGainPct: 67,
  fixedTargetPct: null,
});

export interface TomorrowManagerExperimentDefinition {
  slug: string;
  managerProfileId: string;
  managerLabel: string;
  takeProfit: ChannelTakeProfitPolicy;
  ratchetParameters: ChannelRatchetPolicy;
  plain: string;
  evidenceRef: string;
}

export const DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS = Object.freeze([
  {
    slug: "orb-ustop-ctl",
    managerProfileId: "ORB-ALL-OUT-50",
    managerLabel: "ALL OUT @ +50% · -30% STOP",
    takeProfit: { kind: "bank", targetPct: 50, fraction: 0 },
    ratchetParameters: NONE,
    plain: "Take the full position at +50%; keep the current entry and size.",
    evidenceRef:
      "decision-atlas:exit-frontier:orb-ustop-ctl:through-2026-08-11",
  },
  {
    slug: "orb-qqq-trail",
    managerProfileId: "QQQ-B30-A13",
    managerLabel: "BANK HALF @ +30% · RUN HALF ON A13",
    takeProfit: { kind: "bank", targetPct: 30, fraction: 0.5 },
    ratchetParameters: A13,
    plain:
      "Bank half at +30%; let the other half use the +50% / keep-67% trail.",
    evidenceRef:
      "decision-atlas:exit-frontier:orb-qqq-trail:through-2026-08-11",
  },
  {
    slug: "breakout",
    managerProfileId: "BREAKOUT-ALL-OUT-17",
    managerLabel: "ALL OUT @ +17%",
    takeProfit: { kind: "bank", targetPct: 17, fraction: 0 },
    ratchetParameters: NONE,
    plain: "Take the full position at +17%; preserve the exact breakout entry.",
    evidenceRef: "decision-atlas:exit-frontier:breakout:through-2026-08-11",
  },
  {
    slug: "breakout-alt-v3-iwm",
    managerProfileId: "IWM-ALL-OUT-20",
    managerLabel: "ALL OUT @ +20%",
    takeProfit: { kind: "bank", targetPct: 20, fraction: 0 },
    ratchetParameters: NONE,
    plain: "Take the full position at +20%; preserve the exact IWM entry.",
    evidenceRef:
      "decision-atlas:exit-frontier:breakout-alt-v3-iwm:through-2026-08-11",
  },
  {
    slug: "pb-ride",
    managerProfileId: "PB-ALL-OUT-12",
    managerLabel: "ALL OUT @ +12%",
    takeProfit: { kind: "bank", targetPct: 12, fraction: 0 },
    ratchetParameters: NONE,
    plain: "Take the full position at +12%; preserve the exact pullback entry.",
    evidenceRef: "decision-atlas:exit-frontier:pb-ride:through-2026-08-11",
  },
  {
    slug: "vb-macd-state",
    managerProfileId: "VB-MACD-ALL-OUT-18",
    managerLabel: "ALL OUT @ +18%",
    takeProfit: { kind: "bank", targetPct: 18, fraction: 0 },
    ratchetParameters: NONE,
    plain: "Take the full position at +18%; do not size up during the exit test.",
    evidenceRef:
      "decision-atlas:exit-frontier:vb-macd-state:through-2026-08-11",
  },
] satisfies TomorrowManagerExperimentDefinition[]);

export type TomorrowManagerExperimentSlug =
  typeof DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS[number]["slug"];

export function tomorrowManagerExperimentBySlug(
  slug: string,
): TomorrowManagerExperimentDefinition | null {
  return DECISION_ATLAS_TOMORROW_MANAGER_EXPERIMENTS.find((row) =>
    row.slug === slug) ?? null;
}

export function buildTomorrowManagerProposalRequest(input: {
  active: CompiledReleaseManifest;
  slug: TomorrowManagerExperimentSlug;
}): OperatorProposalRequest {
  const selection = tomorrowManagerExperimentBySlug(input.slug);
  const base = input.active.channelSpecs.find((spec) => spec.slug === input.slug);
  if (!selection || !base) {
    throw new Error(`manager proposal base is missing: ${input.slug}`);
  }
  if (base.managerProfileId === selection.managerProfileId) {
    throw new Error(`manager proposal is already active: ${input.slug}`);
  }
  return {
    baseSpecVersionId: base.id,
    baseSpecContentHash: base.contentHash,
    proposedPatch: {
      managerPolicy: {
        managerProfileId: selection.managerProfileId,
        managerLabel: selection.managerLabel,
        takeProfit: selection.takeProfit,
        stopLoss: base.stopLoss,
        ratchetParameters: selection.ratchetParameters,
      },
    },
    reason:
      `${selection.plain} This is a one-axis paper exit experiment; preserve entry, quantity, route, priority, collision policy, and the displaced native as the paired shadow control.`,
    evidenceRefs: [
      selection.evidenceRef,
      "decision-atlas:channel-native-shadow-evaluation:2026-08-11",
    ],
    changeClass: "bounded-parameter",
  };
}
