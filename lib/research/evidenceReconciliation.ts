import { createHash } from "node:crypto";
import type { AtlasOpportunity, DecisionAtlas } from "./decisionAtlas";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import type { GateShadowCatchupManifest } from "./gateShadowCatchupAuthorization";
import { gateShadowTraversal } from "./gateShadowPolicy";

export const EVIDENCE_RECONCILIATION_VERSION = "evidence-reconciliation-v1" as const;

export type EvidenceCoverageState = "complete" | "partial" | "missing" | "not_applicable";

export interface EvidenceCoverage {
  source: "logical opportunities" | "execution trail" | "virtual native paths" | "manager paths" | "configuration stamps";
  expected: number;
  observed: number;
  missing: number;
  state: EvidenceCoverageState;
  fact: string;
}

export interface EvidenceRecoveryProposal {
  kind: "virtual_trades_only" | "virtual_trade_payload_repair";
  session: string;
  signalIds: string[];
  rowCount: number;
  allowedTables: ["virtual_trades"];
  eventInserts: 0;
  requiresExplicitWriteApproval: true;
  requiresIndependentReadback: true;
  localPayloadSha256?: string;
  remotePayloadSha256?: string;
  proposalSha256: string;
}

export interface IndependentShadowVerification {
  version: "gate-shadow-independent-verification-v1";
  session: string;
  localRows: number;
  remoteRows: number;
  scopedRemoteRows: number;
  localPayloadSha256: string;
  remotePayloadSha256: string;
  duplicateLocalIds: number;
  duplicateRemoteIds: number;
  missingRemoteIds: string[];
  unscopedRemoteIds?: string[];
  extraRemoteIds?: string[];
  payloadMismatches: Array<{ signalId: string; fields?: string[] }>;
  receiptIssues: string[];
  passed: boolean;
  guarantees: { remoteSelectOnly: boolean; productionWrites: number; orderAuthority: boolean };
}

export interface ChannelEvidenceReconciliation {
  channel: string;
  state: "ready" | "needs_recovery" | "limited";
  coverage: EvidenceCoverage[];
  missingVirtualSignalIds: string[];
  independentVerifierIssues: string[];
  limitations: string[];
}

export interface EvidenceReconciliation {
  schemaVersion: 1;
  reconciliationVersion: typeof EVIDENCE_RECONCILIATION_VERSION;
  generatedAt: string;
  throughSession: string;
  state: "ready" | "recovery_proposed" | "limited";
  channels: Record<string, ChannelEvidenceReconciliation>;
  recoveryProposals: EvidenceRecoveryProposal[];
  summary: {
    readyChannels: number;
    channelsNeedingRecovery: number;
    limitedChannels: number;
    missingVirtualRows: number;
    mismatchedVirtualRows: number;
    unscopedVirtualRows: number;
    virtualRowsNeedingRepair: number;
    failedIndependentVerifications: number;
  };
  guarantees: {
    productionReads: 0;
    productionWrites: 0;
    automaticProductionRecovery: false;
    orderAuthority: false;
    configurationAuthority: false;
  };
  receiptSha256: string;
}

const sha256 = (value: unknown): string => `sha256:${createHash("sha256")
  .update(JSON.stringify(value)).digest("hex")}`;

const signalId = (row: AtlasOpportunity): string | null => {
  const ref = row.sourceRefs.find((value) => value.startsWith("signals:"));
  return ref ? ref.slice("signals:".length) : null;
};

const hasRef = (row: AtlasOpportunity, prefix: string): boolean =>
  row.sourceRefs.some((value) => value.startsWith(prefix));

const coverage = (source: EvidenceCoverage["source"], expected: number, observed: number, fact: string): EvidenceCoverage => {
  const missing = Math.max(0, expected - observed);
  const state: EvidenceCoverageState = expected === 0 ? "not_applicable"
    : observed === expected ? "complete" : observed === 0 ? "missing" : "partial";
  return { source, expected, observed, missing, state, fact };
};

export function buildEvidenceReconciliation(input: {
  atlas: DecisionAtlas;
  snapshot: DecisionAtlasSourceSnapshot;
  opportunities: readonly AtlasOpportunity[];
  catchupManifests?: readonly GateShadowCatchupManifest[];
  independentShadowVerifications?: readonly IndependentShadowVerification[];
}): EvidenceReconciliation {
  const channelNames = [...new Set([
    ...Object.keys(input.atlas.channels),
    ...input.snapshot.strategists.map((row) => row.slug),
    ...input.opportunities.map((row) => row.channel),
  ])].sort();
  const managerChannels = new Set(input.snapshot.managerRuns.map((row) => row.channel_slug));
  const sourceSignalById = new Map(input.snapshot.signals.map((row) => [row.id, row]));
  const strategistById = new Map(input.snapshot.strategists.map((row) => [row.id, row.slug]));
  const verifications = [...(input.independentShadowVerifications ?? [])];
  for (const verification of verifications) {
    if (verification.version !== "gate-shadow-independent-verification-v1"
      || !/^\d{4}-\d{2}-\d{2}$/.test(verification.session)
      || verification.session > input.atlas.throughSession
      || verification.guarantees.remoteSelectOnly !== true
      || verification.guarantees.productionWrites !== 0
      || verification.guarantees.orderAuthority !== false) {
      throw new Error("independent shadow verification failed evidence-boundary validation");
    }
  }
  const failedVerifications = verifications.filter((row) => !row.passed);
  const channelForSignal = (id: string): string | null => {
    const source = sourceSignalById.get(id);
    return source ? strategistById.get(source.strategist_id) ?? null : null;
  };
  const channels = Object.fromEntries(channelNames.map((channel) => {
    const rows = input.opportunities.filter((row) => row.channel === channel);
    const logical = new Set(rows.map((row) => row.logicalOpportunityId));
    const signalRows = rows.filter((row) => hasRef(row, "signals:"));
    const executionExpected = signalRows.filter((row) => {
      const id = signalId(row);
      const source = id ? sourceSignalById.get(id) : null;
      return !!source?.configuration_epoch_id && (row.admissionAllowed === true || row.filled != null);
    });
    const executionObserved = executionExpected.filter((row) => hasRef(row, "execution_observations:"));
    // Every cost/stale/premium gate is an independent forgone opportunity. Dark,
    // collision, and re-entry signals are a bar stream: gate-shadow walks those
    // sequentially and cannot infer a missing trade from each raw signal row.
    // Those require the bounded after-close preflight rather than a false
    // 1-signal=1-trade assumption here.
    const virtualExpected = signalRows.filter((row) => !!row.blockedReason
      && gateShadowTraversal(row.blockedReason) === "every-opportunity");
    const sequentialCandidates = signalRows.filter((row) => !!row.blockedReason
      && gateShadowTraversal(row.blockedReason) === "sequential");
    const virtualObserved = virtualExpected.filter((row) => hasRef(row, "virtual_trades:"));
    const missingVirtualSignalIds = virtualExpected
      .filter((row) => !hasRef(row, "virtual_trades:"))
      .map(signalId).filter((value): value is string => !!value).sort();
    const independentVerifierIssues = failedVerifications.flatMap((verification) => {
      const missing = verification.missingRemoteIds.filter((id) => channelForSignal(id) === channel);
      const mismatched = verification.payloadMismatches.map((row) => row.signalId)
        .filter((id) => channelForSignal(id) === channel);
      const unscoped = (verification.unscopedRemoteIds ?? verification.extraRemoteIds ?? [])
        .filter((id) => channelForSignal(id) === channel);
      return [
        ...(missing.length ? [`${verification.session}: independent verifier found ${missing.length} missing payload(s).`] : []),
        ...(mismatched.length ? [`${verification.session}: independent verifier found ${mismatched.length} mismatched payload(s).`] : []),
        ...(unscoped.length ? [`${verification.session}: independent verifier found ${unscoped.length} unscoped payload(s).`] : []),
        ...(verification.receiptIssues.length ? [`${verification.session}: verifier receipt issues: ${verification.receiptIssues.join(", ")}.`] : []),
      ];
    });
    const closed = input.snapshot.ledger.logicalTrades.filter((row) => row.channelSlug === channel && row.status === "closed");
    const firstStampedAt = closed.filter((row) => row.configuration.kind !== "legacy_unstamped")
      .map((row) => row.openedAt).sort()[0] ?? null;
    const stampEligible = firstStampedAt ? closed.filter((row) => row.openedAt >= firstStampedAt) : [];
    const stamped = stampEligible.filter((row) => row.configuration.kind !== "legacy_unstamped");
    const managerRows = input.snapshot.managerRuns.filter((row) => row.channel_slug === channel);
    const firstManagerAt = managerRows.map((row) => row.entry_at).filter(Boolean).sort()[0] ?? null;
    const managerEligible = firstManagerAt ? closed.filter((row) => row.openedAt >= firstManagerAt) : [];
    const managerExpected = managerEligible.length;
    const managerObserved = managerChannels.has(channel)
      ? new Set(input.snapshot.managerRuns.filter((row) => row.channel_slug === channel).map((row) => row.position_id)).size : 0;
    const rowsCoverage = [
      coverage("logical opportunities", logical.size, logical.size,
        "Logical opportunities are deduplicated before any result or capacity calculation."),
      coverage("execution trail", executionExpected.length, executionObserved.length,
        "Admitted signals should retain their decision and broker trail."),
      coverage("virtual native paths", virtualExpected.length, virtualObserved.length,
        "Reconstructible blocked signals should retain one native virtual path."),
      coverage("manager paths", managerExpected, Math.min(managerExpected, managerObserved),
        "Closed positions are paired with manager counterfactuals when the manager collector covered them."),
      coverage("configuration stamps", stampEligible.length, stamped.length,
        "Trades created after configuration stamping began need an era before current and historical evidence can be separated."),
    ];
    const nonVirtualGap = rowsCoverage.some((row) => row.source !== "virtual native paths"
      && row.state !== "complete" && row.state !== "not_applicable");
    const state: ChannelEvidenceReconciliation["state"] = missingVirtualSignalIds.length || independentVerifierIssues.length
      ? "needs_recovery" : nonVirtualGap ? "limited" : "ready";
    const limitations = [
      ...rowsCoverage.filter((row) => row.state === "partial" || row.state === "missing")
        .map((row) => `${row.source}: ${row.missing} expected row${row.missing === 1 ? "" : "s"} are not linked.`),
      ...(sequentialCandidates.length ? [
        `${sequentialCandidates.length} sequential dark/collision/re-entry signal rows require the bounded gate-shadow preflight; they are not treated as one trade each.`,
      ] : []),
      ...independentVerifierIssues,
    ];
    return [channel, { channel, state, coverage: rowsCoverage, missingVirtualSignalIds,
      independentVerifierIssues, limitations }];
  }));

  const sessionBySignal = new Map(input.opportunities.flatMap((row) => {
    const id = signalId(row);
    return id ? [[id, row.session] as const] : [];
  }));
  const bySession = new Map<string, string[]>();
  for (const channel of Object.values(channels)) {
    for (const id of channel.missingVirtualSignalIds) {
      const session = sessionBySignal.get(id);
      if (!session) continue;
      bySession.set(session, [...(bySession.get(session) ?? []), id]);
    }
  }
  for (const manifest of input.catchupManifests ?? []) {
    const valid = manifest.version === "gate-shadow-catchup-manifest-v1"
      && !!manifest.session
      && (manifest.mode === "read-only-select-audit" || manifest.mode === "publish-and-verify")
      && manifest.allowedWriteTableIfSeparatelyAuthorized === "virtual_trades"
      && manifest.productionWrites >= 0;
    if (!valid) throw new Error("gate-shadow catch-up manifest failed evidence reconciliation validation");
    if (manifest.missingSignalIds.length) {
      if (manifest.mode !== "read-only-select-audit" || manifest.productionWrites !== 0 || !manifest.exactWriteRequired) {
        throw new Error("only a zero-write read-only catch-up manifest can propose recovery");
      }
      bySession.set(manifest.session!, [...(bySession.get(manifest.session!) ?? []), ...manifest.missingSignalIds]);
    }
  }
  for (const verification of failedVerifications) {
    if (verification.missingRemoteIds.length) {
      bySession.set(verification.session, [...(bySession.get(verification.session) ?? []), ...verification.missingRemoteIds]);
    }
  }
  const missingProposals = [...bySession].sort(([left], [right]) => left.localeCompare(right)).map(([session, ids]) => {
    const signalIds = [...new Set(ids)].sort();
    const body = { kind: "virtual_trades_only" as const, session, signalIds, rowCount: signalIds.length,
      allowedTables: ["virtual_trades"] as ["virtual_trades"], eventInserts: 0 as const };
    return { ...body, requiresExplicitWriteApproval: true as const, requiresIndependentReadback: true as const,
      proposalSha256: sha256(body) };
  });
  const mismatchProposals = failedVerifications.filter((row) => row.payloadMismatches.length).map((verification) => {
    const signalIds = [...new Set(verification.payloadMismatches.map((row) => row.signalId))].sort();
    const body = { kind: "virtual_trade_payload_repair" as const, session: verification.session,
      signalIds, rowCount: signalIds.length, allowedTables: ["virtual_trades"] as ["virtual_trades"],
      eventInserts: 0 as const, localPayloadSha256: verification.localPayloadSha256,
      remotePayloadSha256: verification.remotePayloadSha256 };
    return { ...body, requiresExplicitWriteApproval: true as const, requiresIndependentReadback: true as const,
      proposalSha256: sha256(body) };
  });
  const recoveryProposals = [...missingProposals, ...mismatchProposals]
    .sort((left, right) => left.session.localeCompare(right.session) || left.kind.localeCompare(right.kind));
  const values = Object.values(channels);
  const missingIds = new Set(missingProposals.flatMap((row) => row.signalIds));
  const mismatchIds = new Set(mismatchProposals.flatMap((row) => row.signalIds));
  const unscopedIds = new Set(failedVerifications.flatMap((row) => row.unscopedRemoteIds ?? row.extraRemoteIds ?? []));
  const summary = {
    readyChannels: values.filter((row) => row.state === "ready").length,
    channelsNeedingRecovery: values.filter((row) => row.state === "needs_recovery").length,
    limitedChannels: values.filter((row) => row.state === "limited").length,
    missingVirtualRows: missingIds.size,
    mismatchedVirtualRows: mismatchIds.size,
    unscopedVirtualRows: unscopedIds.size,
    virtualRowsNeedingRepair: new Set([...missingIds, ...mismatchIds]).size,
    failedIndependentVerifications: failedVerifications.length,
  };
  const state: EvidenceReconciliation["state"] = recoveryProposals.length || failedVerifications.length ? "recovery_proposed"
    : summary.limitedChannels ? "limited" : "ready";
  const receiptBody = { generatedAt: input.atlas.generatedAt, throughSession: input.atlas.throughSession,
    state, channels, recoveryProposals, summary };
  return {
    schemaVersion: 1,
    reconciliationVersion: EVIDENCE_RECONCILIATION_VERSION,
    ...receiptBody,
    guarantees: { productionReads: 0, productionWrites: 0, automaticProductionRecovery: false,
      orderAuthority: false, configurationAuthority: false },
    receiptSha256: sha256(receiptBody),
  };
}

export function renderEvidenceReconciliation(value: EvidenceReconciliation): string {
  return [
    `# Evidence health · through ${value.throughSession}`,
    "",
    value.state === "ready" ? "All expected nightly evidence is linked."
      : value.state === "recovery_proposed"
        ? `${value.summary.virtualRowsNeedingRepair} virtual path${value.summary.virtualRowsNeedingRepair === 1 ? "" : "s"} require bounded recovery after independent verification.`
        : "No recoverable virtual-path gap was found, but some evidence remains limited.",
    "",
    "| Channel | State | Execution | Virtual | Managers | Config |",
    "|---|---|---:|---:|---:|---:|",
    ...Object.values(value.channels).map((row) => {
      const cell = (name: EvidenceCoverage["source"]): string => {
        const item = row.coverage.find((entry) => entry.source === name)!;
        return `${item.observed}/${item.expected}`;
      };
      return `| ${row.channel} | ${row.state.replaceAll("_", " ")} | ${cell("execution trail")} | ${cell("virtual native paths")} | ${cell("manager paths")} | ${cell("configuration stamps")} |`;
    }),
    "",
    "Production writes: 0. Recovery proposals require separate approval and an independent payload readback.",
  ].join("\n");
}
