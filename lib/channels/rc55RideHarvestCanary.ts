import {
  buildImmutableActivationReceipt,
  buildRollbackPlan,
  buildShadowRuntimeProjection,
  buildShadowActivationCandidate,
  buildWorkerActivationAcknowledgement,
  resolveOpenPositionPolicy,
  reviewActivation,
  stampEntryPolicy,
} from "./channelActivation";
import {
  canonicalJson,
  contentHash,
  maxEntriesPerSessionForSpec,
  type ChannelRatchetPolicy,
  type ChannelSpecVersion,
  type CompiledReleaseManifest,
  type DynamicReadinessEvidence,
} from "./channelControlPlane";
import {
  buildOperatorProposal,
  proposalDraftRpcName,
} from "./channelProposalWrite";

export const RC55_RIDE_HARVEST_CANARY_VERSION =
  "rc55-ride-harvest-canary-v1" as const;

const LOCAL_OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const PROFITABILITY_LEDGER_RECEIPT =
  "sha256:c0f9ed868332746667e521b639dffde53bb23762d62cd49018a0cd608f12a97a";
const EXACT_STUDY_RECEIPT =
  "sha256:11b3916e355ace0ff11ceed96a033e10ee8c84da8c9fa090858dd4f2457f8cb9";
const EXACT_FREEZE_RECEIPT =
  "sha256:2511cbab2167b87c1b4957f3648e6b70987ba45829b2c4817878894779c9b996";

const A13: ChannelRatchetPolicy = {
  kind: "a13",
  engageReturnPct: 50,
  givebackPct: 33,
  retainGainPct: 67,
  fixedTargetPct: null,
};

const A13_SEMANTICS = Object.freeze({
  description:
    "Arm after a +50% executable-bid peak, then exit the runner after it gives back 33% of peak gain, retaining 67% of peak gain.",
  priceBasis: "executable-option-bid" as const,
  engageReturnPct: 50,
  givebackPct: 33,
  retainGainPct: 67,
});

const SELECTIONS = [
  {
    slug: "pb-ride",
    targetPct: 50,
    managerProfileId: "RC55-PB-B50-A13",
    managerLabel: "BANK 1 @ +50% · RUN 1 ON A13",
    evidenceStrength: "exact-cap-aware-supported",
    evidenceSummary: {
      durableTrades: 90,
      durableSessions: 29,
      durableExpectancyUsd: 31.04,
      durableProfitFactor: 1.17,
      durableAverageMfePct: 64.4,
      exactPaths: 16,
      exactSessions: 10,
      exactExpectancyPerContractUsd: 1.19,
      exactProfitFactor: 1.03,
      exactMaxDrawdownUsd: -781,
      exactFullRideExpectancyPerContractUsd: -20.15,
      exactFullRideProfitFactor: 0.60,
    },
    rationale:
      "The +50 bank/A13 split is the strongest positive cap-aware A13 point in the frozen exact grid while preserving one contract for the tail.",
  },
  {
    slug: "grind-v3",
    targetPct: 25,
    managerProfileId: "RC55-GRIND-B25-A13",
    managerLabel: "BANK 1 @ +25% · RUN 1 ON A13",
    evidenceStrength: "exact-cap-aware-defensive",
    evidenceSummary: {
      durableTrades: 101,
      durableSessions: 30,
      durableExpectancyUsd: -10.13,
      durableProfitFactor: 0.84,
      durableAverageMfePct: 46.5,
      exactPaths: 11,
      exactSessions: 6,
      exactExpectancyPerContractUsd: -0.95,
      exactProfitFactor: 0.95,
      exactMaxDrawdownUsd: -305,
      exactFullRideExpectancyPerContractUsd: -38.20,
      exactFullRideProfitFactor: 0,
    },
    rationale:
      "The +25 bank/A13 split is the least-destructive conservative exact point and sharply improves the frozen full-RIDE replay without claiming the channel is already profitable.",
  },
  {
    slug: "breakout-alt-v3-iwm",
    targetPct: 20,
    managerProfileId: "RC55-IWM-B20-A13",
    managerLabel: "BANK 1 @ +20% · RUN 1 ON A13",
    evidenceStrength: "bounded-forward-canary",
    evidenceSummary: {
      durableTrades: 10,
      durableSessions: 6,
      durableExpectancyUsd: 18.20,
      durableProfitFactor: 1.11,
      durableAverageMfePct: 34.7,
      exactPaths: 4,
      exactSessions: 4,
      exactExpectancyPerContractUsd: -21.75,
      exactProfitFactor: 0,
      exactMaxDrawdownUsd: -174,
      exactFullRideExpectancyPerContractUsd: -21.75,
      exactFullRideProfitFactor: 0,
    },
    rationale:
      "The four older exact paths never reached +20, so this is intentionally a small forward canary based on the broader ten-trade MFE and newer manager-shadow evidence, not an optimized historical claim.",
  },
] as const;

const PRESERVED_FIELDS = [
  "accountId",
  "accountMode",
  "accountRole",
  "cohort",
  "collisionDomain",
  "entryParameters",
  "familyId",
  "maxDebitUsd",
  "priority",
  "quantity",
  "reentryPolicy",
  "riskLimits",
  "scalePolicy",
  "signalVersion",
  "strategyIdentity",
  "strategyVersion",
  "symbolScope",
] as const satisfies readonly (keyof ChannelSpecVersion)[];

function deterministicUuid(value: unknown): string {
  const hex = contentHash(value).slice("sha256:".length);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function nextTimestamp(generatedAt: string, index: number): string {
  return new Date(Date.parse(generatedAt) + index * 1_000).toISOString();
}

function offsetTimestamp(timestamp: string, offsetMs: number): string {
  return new Date(Date.parse(timestamp) + offsetMs).toISOString();
}

function requireRideBaseline(spec: ChannelSpecVersion): void {
  const blockers: string[] = [];
  if (spec.quantity !== 2) blockers.push(`quantity:${spec.quantity}`);
  if (spec.takeProfit.kind !== "ride"
      || spec.takeProfit.targetPct !== null
      || spec.takeProfit.fraction !== 0) {
    blockers.push("take_profit:not_full_ride");
  }
  if (spec.ratchetParameters.kind !== "none") blockers.push("ratchet:not_none");
  if (spec.stopLoss.catastrophePct !== 30
      || spec.stopLoss.priceBasis !== "executable-option-bid") {
    blockers.push("stop_loss:not_sealed_30pct_bid_threshold");
  }
  if (spec.accountMode !== "paper") blockers.push("account:not_paper");
  if (blockers.length) {
    throw new Error(`${spec.slug}: active baseline drifted (${blockers.join(",")})`);
  }
}

function requirePreservation(
  before: ChannelSpecVersion,
  after: ChannelSpecVersion,
): Record<string, true> {
  const receipt: Record<string, true> = {};
  for (const field of PRESERVED_FIELDS) {
    if (canonicalJson(before[field]) !== canonicalJson(after[field])) {
      throw new Error(`${before.slug}: manager canary changed preserved field ${field}`);
    }
    receipt[field] = true;
  }
  if (canonicalJson(before.stopLoss) !== canonicalJson(after.stopLoss)) {
    throw new Error(`${before.slug}: manager canary changed the catastrophe stop`);
  }
  receipt.stopLoss = true;
  return receipt;
}

export function buildRc55RideHarvestCanary(
  active: CompiledReleaseManifest,
  generatedAt: string,
) {
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("ride-harvest canary requires a valid generatedAt timestamp");
  }
  if (active.manifest.paperLiveAuthority !== "paper-only") {
    throw new Error("ride-harvest canary requires paper-only runtime authority");
  }
  let cumulative = active;
  const channels = [];

  for (const [index, selection] of SELECTIONS.entries()) {
    const base = cumulative.channelSpecs.find((spec) => spec.slug === selection.slug);
    if (!base) throw new Error(`ride-harvest canary missing ${selection.slug}`);
    requireRideBaseline(base);
    const createdAt = nextTimestamp(generatedAt, index);
    const baseProjection = buildShadowRuntimeProjection(cumulative);
    if (baseProjection.state !== "comparable") {
      throw new Error(`${selection.slug}: active projection is not comparable`);
    }
    const preservedOpenPosition = stampEntryPolicy({
      positionId: `position:canary:old:${selection.slug}`,
      enteredAt: new Date(Date.parse(createdAt) - 1_000).toISOString(),
      compiled: cumulative,
      projection: baseProjection,
      channelSlug: selection.slug,
    });
    const requestId = deterministicUuid({
      canaryVersion: RC55_RIDE_HARVEST_CANARY_VERSION,
      activeManifestContentHash: active.manifest.contentHash,
      slug: selection.slug,
      targetPct: selection.targetPct,
    });
    const built = buildOperatorProposal(cumulative, {
      baseSpecVersionId: base.id,
      baseSpecContentHash: base.contentHash,
      proposedPatch: {
        managerPolicy: {
          managerProfileId: selection.managerProfileId,
          managerLabel: selection.managerLabel,
          takeProfit: {
            kind: "bank",
            targetPct: selection.targetPct,
            fraction: 0.5,
          },
          stopLoss: base.stopLoss,
          ratchetParameters: A13,
        },
      },
      reason:
        `${selection.rationale} Paper-only first-shot manager canary; preserve sizing, stop, entry cap, routing, collision policy, and same-entry full-RIDE counterfactual evidence.`,
      evidenceRefs: [
        `profitability-ledger:${PROFITABILITY_LEDGER_RECEIPT}`,
        `rc54-exact-cap-study:${EXACT_STUDY_RECEIPT}`,
        `rc54-exact-freeze:${EXACT_FREEZE_RECEIPT}`,
        `evidence-strength:${selection.evidenceStrength}`,
      ],
      changeClass: "bounded-parameter",
    }, LOCAL_OPERATOR_ID, requestId, createdAt);
    const candidate = buildShadowActivationCandidate({
      active: cumulative,
      proposal: built.proposal,
    });
    if (!candidate.compiled || !candidate.proposedSpec || !candidate.projection) {
      throw new Error(`${selection.slug}: manager canary did not compile`);
    }
    const nextEntry = stampEntryPolicy({
      positionId: `position:canary:new:${selection.slug}`,
      enteredAt: new Date(Date.parse(createdAt) + 1_000).toISOString(),
      compiled: candidate.compiled,
      projection: candidate.projection,
      channelSlug: selection.slug,
    });
    const resolvedOpenPosition = resolveOpenPositionPolicy(preservedOpenPosition);
    if (resolvedOpenPosition.managerProfileId !== base.managerProfileId
        || resolvedOpenPosition.managerVersion !== base.managerVersion
        || canonicalJson(resolvedOpenPosition.takeProfit)
          !== canonicalJson(base.takeProfit)
        || canonicalJson(resolvedOpenPosition.ratchetParameters)
          !== canonicalJson(base.ratchetParameters)) {
      throw new Error(`${selection.slug}: open-position entry policy was reinterpreted`);
    }
    if (nextEntry.managerProfileId !== selection.managerProfileId
        || nextEntry.configurationEpochId
          === resolvedOpenPosition.configurationEpochId
        || nextEntry.channelSpecContentHash
          === resolvedOpenPosition.channelSpecContentHash) {
      throw new Error(`${selection.slug}: next entry did not receive the candidate epoch`);
    }
    const blockers = candidate.validationResults.filter((result) =>
      result.state === "block");
    if (blockers.length) {
      throw new Error(
        `${selection.slug}: manager canary blocked (${blockers.map((gate) => gate.code).join(",")})`,
      );
    }
    const semanticDiffFields = built.preview.diffs
      .filter((diff) => diff.before !== diff.after)
      .map((diff) => diff.field)
      .sort();
    const allowedDiffs = new Set([
      "exitParameters",
      "managerProfileId",
      "managerVersion",
      "ratchetParameters",
      "takeProfit",
    ]);
    const escaped = semanticDiffFields.filter((field) => !allowedDiffs.has(field));
    if (escaped.length) {
      throw new Error(`${selection.slug}: manager canary escaped its boundary (${escaped.join(",")})`);
    }
    const workerRoot = candidate.compiled.workerProjection.roots.find((root) =>
      root.slug === selection.slug);
    const dashboardRoot = candidate.compiled.dashboardProjection.roots.find((root) =>
      root.slug === selection.slug);
    if (!workerRoot || !dashboardRoot) {
      throw new Error(`${selection.slug}: worker/dashboard projection is incomplete`);
    }
    if (workerRoot.channelSpecContentHash !== dashboardRoot.channelSpecContentHash
        || canonicalJson(workerRoot.takeProfit) !== canonicalJson(dashboardRoot.takeProfit)
        || canonicalJson(workerRoot.ratchetParameters)
          !== canonicalJson(dashboardRoot.ratchetParameters)) {
      throw new Error(`${selection.slug}: worker/dashboard manager projection disagrees`);
    }

    const replaySummary = {
      state: "sufficient" as const,
      exactSamples: selection.evidenceSummary.exactPaths,
      censoredSamples: 0,
      limitations: [
        selection.evidenceStrength === "bounded-forward-canary"
          ? "Exact path construction is complete, but the sparse historical sample does not establish an optimal target; this value is a separately approved forward canary."
          : "Exact replay is descriptive and does not establish a globally optimal manager.",
      ],
      evidenceRefs: [
        `rc54-exact-cap-study:${EXACT_STUDY_RECEIPT}`,
        `rc54-exact-freeze:${EXACT_FREEZE_RECEIPT}`,
      ],
    };
    const capacityCollisionImpact = {
      state: "pass" as const,
      fact:
        "Manager-only patch preserves quantity, premium and risk caps, account route, entry frequency, family, collision domain, and admission policy.",
      changedCapacityFields: [] as string[],
      evidenceRefs: [
        `active-manifest:${active.manifest.contentHash}`,
        `candidate-manifest:${candidate.compiled.manifest.contentHash}`,
      ],
    };
    const rehearsalReadiness: DynamicReadinessEvidence = {
      replaySufficiency: {
        ok: true,
        fact: `Local rehearsal uses the frozen ${selection.evidenceSummary.exactPaths}-path exact replay evidence.`,
        evidenceRefs: replaySummary.evidenceRefs,
      },
      evidenceReadiness: {
        ok: true,
        fact:
          "Local protocol rehearsal supplies synthetic fresh capture receipts; production must replace every receipt immediately before activation.",
        evidenceRefs: ["local-rehearsal:capture-paths"],
      },
      safeBoundary: {
        ok: true,
        fact:
          "Local protocol rehearsal supplies a synthetic flat boundary; production must query the independent configured-paper-account inventory.",
        evidenceRefs: ["local-rehearsal:safe-boundary-observer"],
      },
    };
    const rehearsalProposal = {
      ...built.proposal,
      approvalState: "approved" as const,
      replaySummary,
      capacityCollisionImpact,
    };
    const rehearsalCandidate = buildShadowActivationCandidate({
      active: cumulative,
      proposal: rehearsalProposal,
      readiness: rehearsalReadiness,
    });
    if (!rehearsalCandidate.compiled || !rehearsalCandidate.projection
        || !rehearsalCandidate.validationReady) {
      throw new Error(`${selection.slug}: local activation rehearsal did not validate`);
    }
    const configuredPaperAccountIds = [
      ...new Set(cumulative.channelSpecs.map((spec) => spec.accountId)),
    ].sort();
    const evaluatedAt = offsetTimestamp(createdAt, 20_000);
    const compatibility = {
      workerCompatibilityVersion:
        rehearsalCandidate.projection.workerCompatibilityVersion,
      workerReleaseId: cumulative.manifest.releaseId,
      bootId: `boot:local-rehearsal:${selection.slug}`,
      paperMode: true,
      observedAt: offsetTimestamp(createdAt, 8_000),
      evidenceRef: `local-rehearsal:${selection.slug}:compatibility`,
    };
    const acknowledgement = buildWorkerActivationAcknowledgement({
      candidate: rehearsalCandidate,
      workerReleaseId: compatibility.workerReleaseId,
      bootId: compatibility.bootId,
      acknowledgedAt: offsetTimestamp(createdAt, 15_000),
      evidenceRef: `local-rehearsal:${selection.slug}:worker-ack`,
    });
    const rehearsalReview = reviewActivation({
      candidate: rehearsalCandidate,
      approval: {
        proposalId: rehearsalProposal.id,
        approvedBy: "operator:local-rehearsal",
        approvedAt: offsetTimestamp(createdAt, 5_000),
        evidenceRef: `local-rehearsal:${selection.slug}:operator-approval`,
      },
      boundary: {
        observedAt: offsetTimestamp(createdAt, 10_000),
        accountInventoryEvidenceRef:
          "local-rehearsal:configured-paper-account-inventory",
        configuredAccounts: configuredPaperAccountIds.map((accountId) => ({
          accountId,
          mode: "paper" as const,
        })),
        brokerAccounts: configuredPaperAccountIds.map((accountId) => ({
          accountId,
          openPositions: {
            state: "observed" as const,
            count: 0,
            evidenceRef: `local-rehearsal:${accountId}:broker-positions`,
          },
          openOrders: {
            state: "observed" as const,
            count: 0,
            evidenceRef: `local-rehearsal:${accountId}:broker-orders`,
          },
        })),
        deskOpenPositions: {
          state: "observed" as const,
          count: 0,
          evidenceRef: "local-rehearsal:desk-open-positions",
        },
      },
      compatibility,
      workerAcknowledgement: acknowledgement,
      evaluatedAt,
    });
    if (rehearsalReview.state !== "receipt-ready") {
      throw new Error(
        `${selection.slug}: local activation rehearsal blocked (${rehearsalReview.blockers.join(",")})`,
      );
    }
    const rehearsalReceipt = buildImmutableActivationReceipt({
      review: rehearsalReview,
      scheduledFor: offsetTimestamp(createdAt, 18_000),
      activatedAt: evaluatedAt,
    });
    const rollback = buildRollbackPlan({
      current: rehearsalCandidate.projection,
      target: baseProjection,
      openPositions: [preservedOpenPosition],
    });
    if (rollback.state !== "ready-for-review") {
      throw new Error(
        `${selection.slug}: local rollback rehearsal blocked (${rollback.blockers.join(",")})`,
      );
    }

    channels.push({
      ...selection,
      managerSemantics: {
        bankFraction: 0.5,
        runnerFraction: 0.5,
        catastropheStopPct: base.stopLoss.catastrophePct,
        a13: A13_SEMANTICS,
      },
      proposal: built.proposal,
      draftRpc: proposalDraftRpcName(built.proposal),
      semanticDiffFields,
      preservation: requirePreservation(base, candidate.proposedSpec),
      entryCapPreserved: maxEntriesPerSessionForSpec(base),
      previewEvidence: {
        replaySummary,
        capacityCollisionImpact,
        liveEvidenceTemplate: {
          maxAgeMs: 60_000,
          capturePaths: [
            "quote-capture",
            "held-capture",
            "manager-observer",
            "broker-reconciliation",
            "sentinel-evidence",
          ],
          manifestPaperAccounts: [
            ...new Set(active.channelSpecs.map((spec) => spec.accountId)),
          ].sort(),
          configuredPaperAccountInventory:
            "independent-runtime-inventory-must-be-queried-in-full",
          configuredInventoryMustContainEveryManifestAccount: true,
          requiredBoundary: {
            brokerPositions: 0,
            brokerOpenOrders: 0,
            deskPositions: 0,
          },
          refreshImmediatelyBeforePreviewAndActivation: true,
        },
      },
      entryEpochProof: {
        preservedOpenPosition: resolvedOpenPosition,
        nextEligibleEntry: nextEntry,
        openPositionPolicyChanged: false,
        nextEntryUsesCandidatePolicy: true,
      },
      localActivationRehearsal: {
        evidenceKind: "synthetic-local-protocol-rehearsal" as const,
        productionEvidenceAccepted: false,
        reviewState: rehearsalReview.state,
        validationReady: rehearsalCandidate.validationReady,
        receipt: rehearsalReceipt,
        rollback,
        configuredAccountInventorySource:
          "synthetic local inventory; production replacement required",
        activationAuthorized: false,
        persistenceAuthorized: false,
      },
      candidate: {
        manifestId: candidate.compiled.manifest.id,
        manifestContentHash: candidate.compiled.manifest.contentHash,
        configurationEpochId: candidate.projection.configurationEpochId,
        rollbackTargetManifestId: candidate.projection.rollbackTargetManifestId,
        staticBlockers: blockers,
        dynamicReadinessPending: candidate.validationResults
          .filter((result) => result.state === "not-run")
          .map((result) => result.gate)
          .sort(),
        workerRoot,
        dashboardRoot,
      },
    });
    cumulative = candidate.compiled;
  }

  const artifact = {
    canaryVersion: RC55_RIDE_HARVEST_CANARY_VERSION,
    state: "prepared-review-only" as const,
    generatedAt,
    source: {
      manifestId: active.manifest.id,
      releaseId: active.manifest.releaseId,
      manifestContentHash: active.manifest.contentHash,
      paperLiveAuthority: active.manifest.paperLiveAuthority,
    },
    evidence: {
      profitabilityLedgerReceipt: PROFITABILITY_LEDGER_RECEIPT,
      exactStudyReceipt: EXACT_STUDY_RECEIPT,
      exactFreezeReceipt: EXACT_FREEZE_RECEIPT,
      exactWindow: { startEt: "2026-06-01", endEt: "2026-07-28", sessions: 22 },
      exactCoverage: { candidateClocks: 308, entryAsks: 308, rate: 1 },
      selectionClaim:
        "Best evidence-backed bounded first shot, not a claim of globally optimal TP/SL economics.",
    },
    invariants: {
      paperOnly: true,
      preserveQuantity: true,
      preserveCatastropheStop: true,
      preservePremiumAndRiskCaps: true,
      preserveEntryFrequency: true,
      preserveAccountRouting: true,
      preserveCollisionAndFamilyPolicy: true,
      preserveOpenPositionEntryPolicy: true,
      preserveFullRideCounterfactual: true,
    },
    channels,
    finalCandidate: {
      manifestId: cumulative.manifest.id,
      manifestContentHash: cumulative.manifest.contentHash,
      releaseId: cumulative.manifest.releaseId,
      workerProjectionHash: contentHash(cumulative.workerProjection),
      dashboardProjectionHash: contentHash(cumulative.dashboardProjection),
    },
    authority: {
      persistenceAuthorized: false,
      migrationApplied: false,
      proposalCreated: false,
      activationAuthorized: false,
      orderAuthority: false,
      openPositionMutationAuthorized: false,
    },
    remainingRuntimeProofs: [
      "operator approval of the three proposed economics",
      "production manager-policy draft RPC migration and matching dashboard deployment",
      "three authenticated draft proposals created from the then-active exact base hashes",
      "deterministic replay/capacity preview attached to each proposal",
      "flat safe-boundary proof across every configured paper account",
      "worker-compatible manifest activation and fresh acknowledgement",
      "immutable activation receipt for each sequential configuration epoch",
      "post-activation quote, held, manager, broker, and Sentinel capture continuity",
    ],
  };
  return Object.freeze({
    ...artifact,
    deterministicEvidenceHash: contentHash({
      canaryVersion: artifact.canaryVersion,
      artifact,
    }),
  });
}
