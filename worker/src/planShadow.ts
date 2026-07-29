// Phase 1C runtime adapter. Evidence writes are serialized and deliberately not
// awaited by the trading path. A persistence failure can only lose observability;
// it cannot block or alter an order.

import { ACTIVE_WORKER_VERSION, config, policy } from "./config.js";
import { warn } from "./log.js";
import { insertObservedPolicyEpoch, insertObservedPositionPlan, type ChannelConfig } from "./store.js";
import type { ShadowDecision } from "./decide.js";
import { buildShadowPlanEvidence, type ShadowPlanEvidence } from "./planShadowModel.js";
import { day1ExecutableGivebackTrail } from "./day1ReleasePolicy.js";
import type { ReleaseEvidenceContext } from "./releaseEvidenceContext.js";
import type {
  ReceiptBoundConfigurationWriteStamp,
} from "./channelConfigurationRuntimeAdapter.js";

const seen = new Set<string>();
const pending = new Set<string>();
let seenDate = "";
let queue: Promise<void> = Promise.resolve();

export function captureObservedPositionPlan(args: {
  channel: ChannelConfig;
  decision: ShadowDecision;
  accountId: string;
  decisionAtMs: number;
  executableManagerProfile?: string | null;
  releaseEvidenceContext?: ReleaseEvidenceContext | null;
  configurationWriteStamp?: Readonly<ReceiptBoundConfigurationWriteStamp> | null;
}): string | null {
  let evidence: ShadowPlanEvidence | null;
  try {
    evidence = buildShadowPlanEvidence({
      ...args,
      workerVersion: ACTIVE_WORKER_VERSION,
      defaultPremiumStopPct: policy.PREMIUM_STOP_PCT,
      executableGivebackTrail: config.day1ReleaseEnabled
        ? day1ExecutableGivebackTrail(args.channel.slug)
        : null,
      executableManagerProfile: args.executableManagerProfile ?? null,
      releaseEvidenceContext: args.releaseEvidenceContext,
    });
  } catch (e) {
    warn(`plan-shadow: draft rejected — ${(e as Error).message}`);
    return null;
  }
  if (!evidence) return null;

  const day = evidence.plan.plan_json.createdAt.slice(0, 10);
  if (day !== seenDate) { seenDate = day; seen.clear(); pending.clear(); }
  if (seen.has(evidence.plan.opportunity_id) || pending.has(evidence.plan.opportunity_id)) return evidence.plan.opportunity_id;
  pending.add(evidence.plan.opportunity_id);

  queue = queue.then(async () => {
    const epochReady = await insertObservedPolicyEpoch(evidence.epoch);
    if (epochReady && await insertObservedPositionPlan(evidence.plan)) seen.add(evidence.plan.opportunity_id);
  }).catch((e) => warn(`plan-shadow: persistence failed — ${(e as Error).message}`))
    .finally(() => pending.delete(evidence.plan.opportunity_id));
  return evidence.plan.opportunity_id;
}
