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
  kind: "virtual_trades_only";
  session: string;
  signalIds: string[];
  rowCount: number;
  allowedTables: ["virtual_trades"];
  eventInserts: 0;
  requiresExplicitWriteApproval: true;
  requiresIndependentReadback: true;
  proposalSha256: string;
}

export interface ChannelEvidenceReconciliation {
  channel: string;
  state: "ready" | "needs_recovery" | "limited";
  coverage: EvidenceCoverage[];
  missingVirtualSignalIds: string[];
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
}): EvidenceReconciliation {
  const channelNames = [...new Set([
    ...Object.keys(input.atlas.channels),
    ...input.snapshot.strategists.map((row) => row.slug),
    ...input.opportunities.map((row) => row.channel),
  ])].sort();
  const managerChannels = new Set(input.snapshot.managerRuns.map((row) => row.channel_slug));
  const sourceSignalById = new Map(input.snapshot.signals.map((row) => [row.id, row]));
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
    const state: ChannelEvidenceReconciliation["state"] = missingVirtualSignalIds.length
      ? "needs_recovery" : nonVirtualGap ? "limited" : "ready";
    const limitations = [
      ...rowsCoverage.filter((row) => row.state === "partial" || row.state === "missing")
        .map((row) => `${row.source}: ${row.missing} expected row${row.missing === 1 ? "" : "s"} are not linked.`),
      ...(sequentialCandidates.length ? [
        `${sequentialCandidates.length} sequential dark/collision/re-entry signal rows require the bounded gate-shadow preflight; they are not treated as one trade each.`,
      ] : []),
    ];
    return [channel, { channel, state, coverage: rowsCoverage, missingVirtualSignalIds, limitations }];
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
  const recoveryProposals = [...bySession].sort(([left], [right]) => left.localeCompare(right)).map(([session, ids]) => {
    const signalIds = [...new Set(ids)].sort();
    const body = { kind: "virtual_trades_only" as const, session, signalIds, rowCount: signalIds.length,
      allowedTables: ["virtual_trades"] as ["virtual_trades"], eventInserts: 0 as const };
    return { ...body, requiresExplicitWriteApproval: true as const, requiresIndependentReadback: true as const,
      proposalSha256: sha256(body) };
  });
  const values = Object.values(channels);
  const summary = {
    readyChannels: values.filter((row) => row.state === "ready").length,
    channelsNeedingRecovery: values.filter((row) => row.state === "needs_recovery").length,
    limitedChannels: values.filter((row) => row.state === "limited").length,
    missingVirtualRows: recoveryProposals.reduce((sum, row) => sum + row.rowCount, 0),
  };
  const state: EvidenceReconciliation["state"] = recoveryProposals.length ? "recovery_proposed"
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
        ? `${value.summary.missingVirtualRows} missing virtual path${value.summary.missingVirtualRows === 1 ? "" : "s"} packaged for bounded recovery.`
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
