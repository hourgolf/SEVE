import type { AtlasChannelDossier, DecisionAtlas } from "./decisionAtlas";

const cell = (value: unknown): string => String(value ?? "—").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");

export function renderDecisionAtlasMarkdown(atlas: DecisionAtlas): string {
  const lines = [
    `# SEVE Decision Atlas — through ${atlas.throughSession}`,
    "",
    "**READ ONLY · NO ORDER, CONFIGURATION, ROSTER, OR DEPLOYMENT AUTHORITY**",
    "",
    "The default table answers what is working, what is not, and what deserves the next controlled investigation. Each row uses one declared evidence layer and configuration era; other evidence remains separate below.",
    "",
    "| Channel | Disposition | Typical result | Best move | Gave back | Additional opportunity | Evidence | Basis |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const dossier of Object.values(atlas.channels).sort((a, b) => a.channel.localeCompare(b.channel))) {
    const metrics = Object.fromEntries(dossier.firstGlance.map((metric) => [metric.label, metric.value]));
    lines.push(`| ${[
      dossier.channel, dossier.disposition.replaceAll("_", " "), metrics["typical result"],
      metrics["best move"], metrics["gave back"], metrics["additional opportunity"],
      metrics.evidence, `${dossier.decisionCohort.evidenceLayer} · ${dossier.decisionCohort.configurationEra}`,
    ].map(cell).join(" | ")} |`);
  }
  lines.push("", "## Channel dossiers", "");
  for (const dossier of Object.values(atlas.channels).sort((a, b) => a.channel.localeCompare(b.channel))) {
    lines.push(
      `<details><summary><strong>${cell(dossier.channel)}</strong> · ${cell(dossier.disposition.replaceAll("_", " "))}</summary>`,
      "",
      dossier.summary,
      "",
      `- Decision cohort: ${dossier.decisionCohort.fact}`,
      `- Opportunity path: ${dossier.waterfall.opportunities} signals → ${dossier.waterfall.contractSelected}/${dossier.waterfall.coverage.contractSelectedObserved} observed contracts → ${dossier.waterfall.quoteEligible}/${dossier.waterfall.coverage.quoteEligibilityObserved} observed eligible quotes → ${dossier.waterfall.admitted}/${dossier.waterfall.coverage.admissionObserved} observed admissions → ${dossier.waterfall.filled}/${dossier.waterfall.coverage.fillObserved} observed fills → ${dossier.waterfall.scored} scored outcomes.`,
      `- Supported size: ${dossier.capacity.bestSupportedContracts ?? "not established"} contract(s).`,
      `- Portfolio behavior: ${dossier.lifecycle.uniqueness.replaceAll("_", " ")}.`,
      `- More evidence: ${dossier.lifecycle.additionalIndependentSessions == null ? "unresolved" : `${dossier.lifecycle.additionalIndependentSessions} independent session(s) estimated`}.`,
      "",
    );
    if (dossier.waterfall.blocked.length) {
      lines.push("Blocked opportunities:", "", "| Reason | Count | Counterfactual scored | Typical counterfactual |", "|---|---:|---:|---:|");
      for (const item of dossier.waterfall.blocked) lines.push(`| ${cell(item.reason)} | ${item.opportunities} | ${item.counterfactualScored} | ${item.typicalCounterfactualUsd ?? "—"} |`);
      lines.push("");
    }
    lines.push("Evidence layers:", "", "| Layer | Opportunities | Sessions | Configuration eras |", "|---|---:|---:|---|");
    for (const layer of dossier.evidenceLayers) lines.push(`| ${cell(layer.layer)} | ${layer.opportunities} | ${layer.sessions} | ${cell(layer.configurationEras.join(", "))} |`);
    lines.push("", "</details>", "");
  }
  lines.push(
    "## Portfolio collision and redundancy",
    "",
    "Overlap is evidence, not an automatic veto. Same-OCC positions in different accounts retain independent exits.",
    "",
    "| Pair | Same clock | Same OCC | Same-account occupancy | Paired loss sessions | Return relationship | Redundancy |",
    "|---|---:|---:|---:|---:|---:|---|",
  );
  for (const edge of atlas.collisionGraph
    .filter((item) => item.redundancy === "high" || item.redundancy === "moderate")
    .slice(0, 25)) lines.push(`| ${cell(`${edge.left} ↔ ${edge.right}`)} | ${edge.sameClock} | ${edge.sameOcc} | ${edge.accountOccupancy} | ${edge.pairedLossSessions}/${edge.comparableSessions} | ${edge.returnCorrelation ?? "—"} | ${edge.redundancy} |`);
  lines.push(
    "",
    "## Evidence and limitations",
    "",
    `- Logical opportunities: ${atlas.evidence.logicalOpportunities} (${atlas.evidence.duplicateRowsRemoved} duplicate evidence rows removed).`,
    `- Manager paths: ${atlas.evidence.managerPaths}.`,
    `- Configuration eras: ${atlas.evidence.configurationEras.join(", ") || "none"}.`,
    ...atlas.evidence.limitations.map((limitation) => `- ${limitation}`),
    "- Full source references, hashes, capacity points, manager pairings, and uncertainty fields are preserved in `atlas.json`.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export interface PendingAtlasReview {
  channel: string;
  change: "size" | "manager" | "promotion" | "retirement" | "hold";
  target: string;
}

export const DECISION_ATLAS_PENDING_REVIEWS: readonly PendingAtlasReview[] = [
  { channel: "orb-ustop-ctl", change: "size", target: "2 → 4 contracts" },
  { channel: "vb-macd-state", change: "size", target: "2 → 4 contracts" },
  { channel: "vb-gap-drift", change: "manager", target: "LOCK50/30" },
  { channel: "orb-qqq-trail", change: "manager", target: "LOCK50/30" },
  { channel: "vb-vwap-revert", change: "retirement", target: "retire collection" },
  { channel: "vb-pm-trend-iwm", change: "retirement", target: "retire collection" },
  { channel: "vb-vwap-revert-qqq", change: "retirement", target: "retire collection" },
  { channel: "vb-vwap-revert-iwm", change: "hold", target: "continue evidence review" },
  { channel: "momo-shape-2", change: "hold", target: "leave unchanged" },
] as const;

function recommendation(review: PendingAtlasReview, dossier: AtlasChannelDossier | undefined): {
  state: "GO" | "NO-GO" | "HOLD";
  reason: string;
} {
  if (!dossier) return { state: "HOLD", reason: "No Decision Atlas dossier is available." };
  if (review.change === "hold") return { state: "GO", reason: `The requested no-change posture preserves ${dossier.lifecycle.evidenceSessions} sessions of evidence.` };
  if (review.change === "size") return dossier.disposition === "size"
    && (dossier.capacity.bestSupportedContracts ?? 0) >= 4
    ? { state: "GO", reason: "The bounded replay supports four contracts after capital use and displaced opportunities." }
    : dossier.capacity.bestSupportedContracts != null && dossier.capacity.bestSupportedContracts >= 4
      ? { state: "HOLD", reason: `Four contracts fit the replay, but ${dossier.lifecycle.evidenceSessions} independent current-cohort sessions do not clear the evidence floor.` }
      : { state: "HOLD", reason: `The replay supports ${dossier.capacity.bestSupportedContracts ?? "no verified"} contract level; four is not yet defensible.` };
  if (review.change === "retirement") return dossier.disposition === "retire"
    ? { state: "GO", reason: "Typical evidence is negative and the portfolio graph finds substantial duplication." }
    : { state: "HOLD", reason: `The lifecycle result is ${dossier.disposition.replaceAll("_", " ")}, not retirement.` };
  if (review.change === "promotion") return dossier.disposition === "promote"
    ? { state: "GO", reason: "The current cohort supports a bounded promotion review." }
    : { state: "HOLD", reason: `The current lifecycle result is ${dossier.disposition.replaceAll("_", " ")}.` };
  const manager = dossier.frontiers.flatMap((frontier) => frontier.managers)
    .filter((item) => item.managerId === review.target)
    .sort((a, b) => b.sessions - a.sessions)[0];
  return manager && manager.typicalBenefitPct != null && manager.typicalBenefitPct > 0
    && manager.pairedOpportunities >= 10 && manager.sessions >= 5
    && manager.improvementFrequency != null && manager.improvementFrequency >= 0.6
    && manager.benefitInterval95.lower != null && manager.benefitInterval95.lower > 0
    && manager.leaveSessionOutStable === true && manager.chronologicalStable === true
    ? { state: "GO", reason: `${review.target} improves the typical paired opportunity with stable chronological and leave-session-out checks.` }
    : { state: "HOLD", reason: `${review.target} does not yet clear paired benefit, session uncertainty, and stability together.` };
}

export function renderDecisionAtlasProposalPacket(
  atlas: DecisionAtlas,
  pending: readonly PendingAtlasReview[] = DECISION_ATLAS_PENDING_REVIEWS,
): string {
  const lines = [
    `# Decision Atlas proposal packet — through ${atlas.throughSession}`,
    "",
    "**PROPOSALS ONLY · NOTHING APPLIED · SEPARATE APPROVAL REQUIRED**",
    "",
    "| Channel | Pending review | Atlas recommendation | Why |",
    "|---|---|---|---|",
  ];
  for (const review of pending) {
    const result = recommendation(review, atlas.channels[review.channel]);
    lines.push(`| ${cell(review.channel)} | ${cell(`${review.change}: ${review.target}`)} | ${result.state} | ${cell(result.reason)} |`);
  }
  lines.push(
    "",
    "## Sequence if separately approved",
    "",
    "1. Apply only one independently reversible channel change at a time unless an atomic roster receipt is explicitly chosen.",
    "2. Preserve the exact pre-change manifest and configuration epoch as the rollback target.",
    "3. Re-run capacity and collision checks against the final account arrangement.",
    "4. Activate only at a verified flat, zero-open-order boundary.",
    "5. Stop and roll back on receipt mismatch, unexpected account routing, same-account OCC rejection, missing manager coverage, or capacity breach.",
    "",
    "No merge, deployment, schedule activation, production research write, or trading change is authorized by this packet.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
