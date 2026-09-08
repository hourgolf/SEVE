import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import { managerPolicyContentHash } from "../../lib/channels/channelControlPlane.js";
import { fixedContractAdmissionPolicy } from "../../lib/channels/fixedContractAdmission.js";
import { buildReceiptBoundRuntimeConfiguration } from "./channelConfigurationRuntimeAdapter.js";
import { buildReceiptBoundEntryPolicy } from "./receiptBoundEntryPolicy.js";
import { buildFixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { buildFixedEntryExecutionPlan } from "./fixedEntryExecutionPlan.js";

/** Synthetic sealed identities for hermetic tests, never activation authority. */
export function fixedEntryIntentFixture() {
  const canary = buildRc54NoopConfigurationCanary();
  const runtime = buildReceiptBoundRuntimeConfiguration({ compiled: canary.simulation.candidate.compiled!,
    projection: canary.simulation.candidate.projection!, activationReceipt: canary.simulation.receipt! });
  const root = { ...structuredClone(runtime.roots.find(r => r.slug === "vb-macd-state")!) };
  root.quantity = 4;
  root.managerProfileId = "VB-MACD-WIDE20-50";
  root.takeProfit = { kind: "bank", targetPct: 20, fraction: 0 };
  root.stopLoss = { catastrophePct: 50, priceBasis: "executable-option-bid" };
  root.ratchetParameters = { kind: "none", engageReturnPct: null, givebackPct: null,
    retainGainPct: null, fixedTargetPct: null };
  const managerVersion = managerPolicyContentHash({ managerProfileId: root.managerProfileId,
    takeProfit: root.takeProfit, stopLoss: root.stopLoss, ratchetParameters: root.ratchetParameters, liquidationEt: "15:25" });
  root.configuration = { ...root.configuration, managerProfileId: root.managerProfileId, managerVersion };
  root.fixedContractAdmission = fixedContractAdmissionPolicy();
  const entryPolicy = buildReceiptBoundEntryPolicy(root);
  return buildFixedEntryIntent({ attempt: 0, predecessorIntentId: null,
    predecessorSettlementHash: null, sessionDateEt: "2026-09-08",
    strategistId: root.strategistId, accountId: root.accountId,
    slug: "vb-macd-state", underlying: "SPY", occ: "SPY260908C00640000", optionSide: "call", quantity: 4,
    sourceBarAt: "2026-09-08T14:30:00.000Z", createdAt: "2026-09-08T14:30:01.000Z",
    reason: "macd_bull", opportunityId: null, evidence: { fixture: true },
    executionPlan: buildFixedEntryExecutionPlan({ spreadCapture: false,
      ladder: { frac: 0.35, rungs: 3, rungSec: 1 }, quote: { bid: 1.9, ask: 2, observedAt: "2026-09-08T14:30:00.000Z" } }),
    writeStamp: { channel_spec_version_id: "00000000-0000-4000-8000-000000000001",
      release_manifest_id: "00000000-0000-4000-8000-000000000002",
      configuration_epoch_id: root.configuration.configurationEpochId,
      configuration_identity: root.configuration, entry_policy: entryPolicy } });
}
