import type { ChannelPassport, FleetEvidenceAudit } from "./fleetEvidenceAudit";

export interface FleetEvidenceWindow {
  label: string;
  fromDateEt: string;
  throughDateEt: string;
  audit: FleetEvidenceAudit;
}

export interface ChannelEvidenceWindowPoint {
  label: string;
  rootTrades: number;
  nativeRows: number;
  nativeWinRate: number | null;
  nativePnlUsd: number | null;
  bookedPct: number | null;
  entryBrokerPct: number | null;
  exitBrokerPct: number | null;
  managerComparisonPositions: number;
}

export interface ChannelEvidenceReadinessRow {
  slug: string;
  familyId: string;
  posture: "active" | "dark" | "operator_twin";
  latestActivity: "traded" | "signals_only" | "unobserved";
  evidenceState: "complete" | "partial" | "pending";
  pairedExitState: "observed" | "not_observed" | "ineligible";
  gaps: {
    bookedOutcomes: number;
    entryDecisions: number;
    entryBrokerResults: number;
    exitBrokerResults: number;
    legacyUnattributed: number;
  };
  windows: ChannelEvidenceWindowPoint[];
}

export interface FleetEvidenceReadiness {
  schemaVersion: 1;
  generatedAt: string;
  latestWindow: { label: string; fromDateEt: string; throughDateEt: string };
  state: "pass" | "warn" | "pending";
  summary: {
    channels: number;
    activeChannels: number;
    darkChannels: number;
    latestTradedChannels: number;
    completeLatestTradedChannels: number;
    partialLatestTradedChannels: number;
    pairedExitObservedChannels: number;
  };
  unmappedEvidence: FleetEvidenceAudit["unmappedEvidence"];
  blockers: string[];
  notes: string[];
  channels: ChannelEvidenceReadinessRow[];
  decisionBoundary: string;
}

const difference = (eligible: number, covered: number): number => Math.max(0, eligible - covered);
const point = (label: string, channel: ChannelPassport): ChannelEvidenceWindowPoint => {
  const nativeDecided = channel.outcomeProvenance.nativeWinningRows
    + channel.outcomeProvenance.nativeLosingRows
    + channel.outcomeProvenance.nativeFlatRows;
  return {
    label,
    rootTrades: channel.ledger.rootTrades,
    nativeRows: channel.outcomeProvenance.nativeRows,
    nativeWinRate: nativeDecided
      ? Math.round(channel.outcomeProvenance.nativeWinningRows * 10_000 / nativeDecided) / 100
      : null,
    nativePnlUsd: channel.economics.nativeOutcomePnl,
    bookedPct: channel.durableLineage.bookedReceiptCoverage.pct,
    entryBrokerPct: channel.durableLineage.entryBrokerResultCoverage.pct,
    exitBrokerPct: channel.durableLineage.exitBrokerResultCoverage.pct,
    managerComparisonPositions: channel.managerObservation.completeComparisonPositions,
  };
};

export function buildFleetEvidenceReadiness(
  windows: readonly FleetEvidenceWindow[],
  generatedAt: string,
): FleetEvidenceReadiness {
  if (!windows.length) throw new Error("at least one fleet evidence window is required");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generatedAt must be an ISO timestamp");
  const labels = new Set<string>();
  for (const window of windows) {
    if (!window.label || labels.has(window.label)) throw new Error("fleet evidence window labels must be unique");
    labels.add(window.label);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(window.fromDateEt)
      || !/^\d{4}-\d{2}-\d{2}$/.test(window.throughDateEt)
      || window.fromDateEt > window.throughDateEt) throw new Error(`invalid fleet evidence window: ${window.label}`);
  }
  const latest = windows.at(-1)!;
  const latestBySlug = new Map(latest.audit.channels.map((channel) => [channel.identity.slug, channel]));
  const allSlugs = [...new Set(windows.flatMap((window) => window.audit.channels.map((channel) => channel.identity.slug)))].sort();
  const channels = allSlugs.map((slug): ChannelEvidenceReadinessRow => {
    const latestChannel = latestBySlug.get(slug);
    if (!latestChannel) throw new Error(`latest fleet evidence window is missing channel ${slug}`);
    const traded = latestChannel.ledger.rootTrades > 0;
    const signalsOnly = !traded && latestChannel.signals.observed > 0;
    const gaps = {
      bookedOutcomes: difference(latestChannel.durableLineage.bookedReceiptCoverage.eligible, latestChannel.durableLineage.bookedReceiptCoverage.covered),
      entryDecisions: difference(latestChannel.durableLineage.entryDecisionCoverage.eligible, latestChannel.durableLineage.entryDecisionCoverage.covered),
      entryBrokerResults: difference(latestChannel.durableLineage.entryBrokerResultCoverage.eligible, latestChannel.durableLineage.entryBrokerResultCoverage.covered),
      exitBrokerResults: difference(latestChannel.durableLineage.exitBrokerResultCoverage.eligible, latestChannel.durableLineage.exitBrokerResultCoverage.covered),
      legacyUnattributed: latestChannel.outcomeProvenance.legacyUnattributedRows,
    };
    const gapCount = Object.values(gaps).reduce((sum, value) => sum + value, 0);
    return {
      slug,
      familyId: latestChannel.identity.familyId,
      posture: latestChannel.identity.mode === "operator_twin"
        ? "operator_twin"
        : latestChannel.identity.active && latestChannel.identity.muted === false ? "active" : "dark",
      latestActivity: traded ? "traded" : signalsOnly ? "signals_only" : "unobserved",
      evidenceState: !traded ? "pending" : gapCount === 0 ? "complete" : "partial",
      // Manager evidence is reported from actual enrolled paths. Do not turn
      // the old four-contract enrollment convention into a new eligibility
      // rule; one-contract trades remain valid evidence when a paired path was
      // durably observed.
      pairedExitState: latestChannel.managerObservation.completeComparisonPositions > 0
        ? "observed"
        : traded ? "not_observed" : "ineligible",
      gaps,
      windows: windows.flatMap((window) => {
        const channel = window.audit.channels.find((candidate) => candidate.identity.slug === slug);
        return channel ? [point(window.label, channel)] : [];
      }),
    };
  });
  const traded = channels.filter((channel) => channel.latestActivity === "traded");
  const partial = traded.filter((channel) => channel.evidenceState === "partial");
  const unmapped = latest.audit.unmappedEvidence;
  const unmappedCount = Object.values(unmapped).reduce((sum, value) => sum + value, 0);
  const blockers = [
    ...partial.map((channel) => `${channel.slug}: ${Object.entries(channel.gaps).filter(([, value]) => value > 0).map(([key, value]) => `${key}=${value}`).join(", ")}`),
    ...(unmappedCount ? [`latest window has ${unmappedCount} unmapped evidence row(s)`] : []),
  ];
  const notes = latest.audit.summary.executionCorrectionRows > 0
    ? [`${latest.audit.summary.executionCorrectionRows} reconciliation correction row(s) excluded from native outcomes and broker-exit receipt eligibility.`]
    : [];
  return {
    schemaVersion: 1,
    generatedAt,
    latestWindow: { label: latest.label, fromDateEt: latest.fromDateEt, throughDateEt: latest.throughDateEt },
    state: traded.length === 0 ? "pending" : blockers.length ? "warn" : "pass",
    summary: {
      channels: channels.length,
      activeChannels: channels.filter((channel) => channel.posture === "active").length,
      darkChannels: channels.filter((channel) => channel.posture === "dark").length,
      latestTradedChannels: traded.length,
      completeLatestTradedChannels: traded.filter((channel) => channel.evidenceState === "complete").length,
      partialLatestTradedChannels: partial.length,
      pairedExitObservedChannels: channels.filter((channel) => channel.pairedExitState === "observed").length,
    },
    unmappedEvidence: unmapped,
    blockers,
    notes,
    channels,
    decisionBoundary: "Evidence completeness determines which comparisons are admissible; it never authorizes a roster, manager, risk, or execution change.",
  };
}
