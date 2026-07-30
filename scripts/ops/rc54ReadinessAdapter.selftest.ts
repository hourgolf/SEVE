import assert from "node:assert/strict";
import type { MarketEvent } from "@/lib/types";
import { buildRc54NoopConfigurationCanary } from "@/lib/channels/rc54NoopConfigurationCanary";
import {
  buildProductionReceiptBoundRuntimeConfiguration,
} from "@/worker/src/channelConfigurationRuntimeAdapter";
import { buildReceiptBoundRc54StartupReceipt } from "@/worker/src/temporaryRc54RuntimeAdapter";
import {
  observeRc54ReleaseReceipt,
  receiptBoundRc54OperationalContract,
} from "./rc54ReadinessAdapter";

const canary = buildRc54NoopConfigurationCanary();
const compiled = canary.simulation.candidate.compiled;
const projection = canary.simulation.candidate.projection;
const activationReceipt = canary.simulation.receipt;
assert.ok(compiled);
assert.ok(projection);
assert.ok(activationReceipt);
const runtime = buildProductionReceiptBoundRuntimeConfiguration({
  compiled,
  projection,
  activationReceipt,
  databaseIdentity: {
    releaseManifestDatabaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    channelSpecDatabaseIdsByVersionKey: Object.fromEntries(
      compiled.channelSpecs.map((spec, index) => [
        spec.id,
        `bbbbbbbb-bbbb-4bbb-8bb${index}-bbbbbbbbbbb${index}`,
      ]),
    ),
  },
});
const contract = receiptBoundRc54OperationalContract(runtime);
const startup = buildReceiptBoundRc54StartupReceipt({
  runtime,
  operationalReceipt: {
    alpacaPaperOrigin: contract.paperOrigin,
    stockFeed: contract.stockFeed,
    optionFeed: contract.optionFeed,
    dryRun: false,
    liveTrading: true,
    heldCapture: {
      enabled: true,
      targetSamples: contract.capture.targetSamples,
      maxAgeMs: contract.capture.maxAgeMs,
    },
    managerShadow: {
      enabled: true,
      quoteMaxAgeMs: contract.managerObserver.quoteMaxAgeMs,
    },
  },
});

const event = (
  id: string,
  createdAt: string,
  message: string,
  meta: unknown,
): MarketEvent => ({
  id,
  level: "EXEC",
  strategist_id: null,
  message,
  meta,
  created_at: createdAt,
});

const oldSealed = event(
  "old",
  "2026-07-29T23:00:00.000Z",
  `stream: rc54-release ACTIVE week2-2026-07-27-rc5.4 config=${"a".repeat(64)}`,
  {},
);
const current = event(
  "current",
  "2026-07-30T02:25:37.849Z",
  `stream: rc54-release ACTIVE ${runtime.releaseId} config=${runtime.manifestContentHash}`,
  {
    ...startup,
    runtimeReadiness: {
      heldCaptureReady: true,
      heldCaptureStartedBeforeBootDecision: true,
      flatEraBoundaryProven: false,
      mixedEpochOpenPositionPoliciesValidated: true,
    },
  },
);

let checks = 0;
const check = (name: string, run: () => void): void => {
  run();
  checks++;
  void name;
};

check("receipt-bound contract uses immutable manifest authority", () => {
  assert.equal(contract.authoritySource, "immutable-activation-receipt");
  assert.equal(contract.releaseId, runtime.releaseId);
  assert.equal(
    contract.configurationSha256,
    runtime.manifestContentHash.replace(/^sha256:/, ""),
  );
  assert.equal(contract.flatBoundaryReceiptRequired, false);
  assert.equal(contract.roots.length, runtime.roots.length);
});

check("current receipt-bound startup supersedes the older sealed receipt", () => {
  const observed = observeRc54ReleaseReceipt([oldSealed, current], contract);
  assert.ok(observed);
  assert.equal(observed.releaseId, runtime.releaseId);
  assert.equal(observed.configurationSha256, contract.configurationSha256);
  assert.equal(observed.strategyWorkerVersion, runtime.workerCompatibilityVersion);
  assert.equal(observed.heldCaptureReady, true);
  assert.equal(observed.flatEraBoundaryProven, false);
});

check("malformed current receipt fails closed instead of falling back", () => {
  const malformed = {
    ...current,
    id: "malformed",
    created_at: "2026-07-30T02:26:00.000Z",
    meta: {
      ...(current.meta as Record<string, unknown>),
      activationReceiptId: null,
    },
  };
  const observed = observeRc54ReleaseReceipt([oldSealed, malformed], contract);
  assert.ok(observed);
  assert.equal(observed.releaseId, "");
  assert.equal(observed.configurationSha256, "");
  assert.equal(observed.strategyWorkerVersion, null);
});

check("sealed baseline remains supported when it is the active contract", () => {
  const observed = observeRc54ReleaseReceipt([oldSealed]);
  assert.ok(observed);
  assert.equal(observed.releaseId, "week2-2026-07-27-rc5.4");
  assert.equal(observed.configurationSha256, "a".repeat(64));
});

console.log(`RC5.4 readiness adapter self-test passed (${checks} checks)`);
