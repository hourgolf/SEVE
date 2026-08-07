import type { AtlasChannelDossier, DecisionAtlas } from "./decisionAtlas";

const cell = (value: unknown): string => String(value ?? "—").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");

export function renderDecisionAtlasMarkdown(atlas: DecisionAtlas): string {
  const lines = [
    `# SEVE Decision Atlas — through ${atlas.throughSession}`,
    "",
    "**READ ONLY · NO ORDER, CONFIGURATION, ROSTER, OR DEPLOYMENT AUTHORITY**",
    "",
    "The default groups answer what can support a proposal now, what deserves one controlled experiment, and what genuinely lacks scored evidence. Channel evidence resets only when that channel specification changes; portfolio receipt eras remain separate for routing and capacity replay.",
    "“Actionable now” means enough evidence to draft a proposal—not permission to apply it. Historical unstamped evidence requires a frozen channel specification before promotion or retirement.",
    "",
    "## Decision groups",
    "",
    `- **Actionable now:** ${atlas.decisionGroups.actionable_now.length}`,
    `- **Single-variable experiment:** ${atlas.decisionGroups.single_variable_experiment.length}`,
    `- **Needs more evidence:** ${atlas.decisionGroups.needs_more_evidence.length}`,
    "",
    "### Actionable now",
    "",
    "| Channel | Proposed review | Typical path | Typical session | Positive sessions | Scored evidence | Configuration |",
    "|---|---|---:|---:|---:|---:|---|",
  ];
  const summaryRow = (dossier: AtlasChannelDossier, includeGroup: boolean): string => {
    const metrics = Object.fromEntries(dossier.firstGlance.map((metric) => [metric.label, metric.value]));
    return `| ${[
      dossier.channel,
      ...(includeGroup ? [dossier.lifecycle.decisionGroup.replaceAll("_", " ")] : []),
      dossier.disposition.replaceAll("_", " "), metrics["typical result"],
      dossier.lifecycle.typicalSessionUsd == null ? "—" : `${dossier.lifecycle.typicalSessionUsd >= 0 ? "+" : "−"}$${Math.abs(dossier.lifecycle.typicalSessionUsd).toLocaleString("en-US")}`,
      `${dossier.lifecycle.positiveSessions}/${dossier.lifecycle.evidenceSessions}`,
      `${dossier.lifecycle.scoredOpportunities} paths / ${dossier.lifecycle.evidenceSessions} sessions`,
      dossier.lifecycle.configurationCertainty.replaceAll("_", " "),
    ].map(cell).join(" | ")} |`;
  };
  for (const channel of atlas.decisionGroups.actionable_now) lines.push(summaryRow(atlas.channels[channel], false));
  for (const [group, title] of [
    ["single_variable_experiment", "Single-variable experiments"],
    ["needs_more_evidence", "Needs more evidence"],
  ] as const) {
    lines.push("", `<details><summary><strong>${title} (${atlas.decisionGroups[group].length})</strong></summary>`, "",
      "| Channel | Proposed review | Typical path | Typical session | Positive sessions | Scored evidence | Configuration |",
      "|---|---|---:|---:|---:|---:|---|");
    for (const channel of atlas.decisionGroups[group]) lines.push(summaryRow(atlas.channels[channel], false));
    lines.push("", "</details>", "");
  }
  lines.push("", "<details><summary><strong>Complete channel summary</strong></summary>", "",
    "| Channel | Group | Disposition | Typical path | Typical session | Positive sessions | Scored evidence | Configuration |",
    "|---|---|---|---:|---:|---:|---:|---|");
  for (const dossier of Object.values(atlas.channels).sort((a, b) => a.channel.localeCompare(b.channel))) {
    lines.push(summaryRow(dossier, true));
  }
  lines.push("", "</details>", "", "## Channel dossiers", "");
  for (const dossier of Object.values(atlas.channels).sort((a, b) => a.channel.localeCompare(b.channel))) {
    const supportedCapacity = dossier.capacity.bestSupportedContracts
      ? dossier.capacity.points[dossier.capacity.bestSupportedContracts - 1] : null;
    lines.push(
      `<details><summary><strong>${cell(dossier.channel)}</strong> · ${cell(dossier.disposition.replaceAll("_", " "))}</summary>`,
      "",
      dossier.summary,
      "",
      `- Decision group: ${dossier.lifecycle.decisionGroup.replaceAll("_", " ")}. ${dossier.lifecycle.decisionDrivers.join(" ")}`,
      `- Scored evidence: ${dossier.decisionCohort.scoredOpportunities} logical outcomes across ${dossier.decisionCohort.scoredSessions} sessions; ${dossier.decisionCohort.opportunities} total observed signals across ${dossier.decisionCohort.sessions} sessions. ${dossier.decisionCohort.fact}`,
      `- Session consistency: ${dossier.lifecycle.positiveSessions} positive / ${dossier.lifecycle.negativeSessions} negative / ${dossier.lifecycle.flatSessions} flat; typical session ${dossier.lifecycle.typicalSessionUsd ?? "—"} per contract.`,
      `- Opportunity path: ${dossier.waterfall.opportunities} signals → ${dossier.waterfall.contractSelected}/${dossier.waterfall.coverage.contractSelectedObserved} observed contracts → ${dossier.waterfall.quoteEligible}/${dossier.waterfall.coverage.quoteEligibilityObserved} observed eligible quotes → ${dossier.waterfall.admitted}/${dossier.waterfall.coverage.admissionObserved} observed admissions → ${dossier.waterfall.filled}/${dossier.waterfall.coverage.fillObserved} observed fills → ${dossier.waterfall.scored} scored outcomes.`,
      `- Supported size: ${dossier.capacity.bestSupportedContracts ?? "not established"} contract(s).`,
      `- Capacity effect: ${supportedCapacity == null ? "not established." : `${supportedCapacity.marginalPortfolioResultVsOneContractUsd == null ? "—" : `${supportedCapacity.marginalPortfolioResultVsOneContractUsd >= 0 ? "+" : "−"}$${Math.abs(supportedCapacity.marginalPortfolioResultVsOneContractUsd).toLocaleString("en-US")}`} portfolio result versus one contract; ${supportedCapacity.additionalDisplacedOtherOpportunitiesVsOneContract ?? 0} additional competing opportunities displaced; $${Math.abs(supportedCapacity.additionalDisplacedOtherCounterfactualUsdVsOneContract ?? 0).toLocaleString("en-US")} displaced counterfactual; $${supportedCapacity.portfolioMaxDrawdownUsd.toLocaleString("en-US")} portfolio drawdown.`}`,
      `- Portfolio behavior: ${dossier.lifecycle.uniqueness.replaceAll("_", " ")}.`,
      `- Configuration certainty: ${dossier.lifecycle.configurationCertainty.replaceAll("_", " ")}.`,
      "",
    );
    if (dossier.waterfall.blocked.length) {
      lines.push("Blocked opportunities:", "", "| Reason | Count | Counterfactual scored | Typical counterfactual |", "|---|---:|---:|---:|");
      for (const item of dossier.waterfall.blocked) lines.push(`| ${cell(item.reason)} | ${item.opportunities} | ${item.counterfactualScored} | ${item.typicalCounterfactualUsd ?? "—"} |`);
      lines.push("");
    }
    lines.push("Evidence layers:", "", "| Layer | Opportunities | Sessions | Channel eras | Portfolio receipts |", "|---|---:|---:|---|---:|");
    for (const layer of dossier.evidenceLayers) lines.push(`| ${cell(layer.layer)} | ${layer.opportunities} | ${layer.sessions} | ${cell(layer.configurationEras.join(", "))} | ${layer.portfolioConfigurationEras.length} |`);
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
    `- Observed logical opportunities: ${atlas.evidence.logicalOpportunities} (${atlas.evidence.duplicateRowsRemoved} duplicate evidence rows removed); decision maturity uses scored outcomes only.`,
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
  if (review.change === "hold") return { state: "GO", reason: `The requested no-change posture preserves ${dossier.lifecycle.scoredOpportunities} scored outcomes across ${dossier.lifecycle.evidenceSessions} sessions.` };
  if (review.change === "size") {
    const two = dossier.capacity.points.find((point) => point.contracts === 2);
    const four = dossier.capacity.points.find((point) => point.contracts === 4);
    const portfolioChange = two && four
      ? Math.round((four.portfolioTotalResultUsd - two.portfolioTotalResultUsd) * 100) / 100
      : null;
    const addedDisplacements = two && four
      ? four.displacedOtherOpportunities - two.displacedOtherOpportunities
      : null;
    const changeText = portfolioChange == null
      ? "an unresolved amount"
      : `${portfolioChange >= 0 ? "+" : "−"}$${Math.abs(portfolioChange).toLocaleString("en-US")}`;
    const displacementText = addedDisplacements == null ? "an unknown number of" : String(addedDisplacements);
    return dossier.disposition === "size"
    && (dossier.capacity.bestSupportedContracts ?? 0) >= 4
    ? { state: "GO", reason: `Moving from two to four contracts changes replayed portfolio result by ${changeText} and causes ${displacementText} additional competing-opportunity displacement(s).` }
    : dossier.capacity.bestSupportedContracts != null && dossier.capacity.bestSupportedContracts >= 4
      ? { state: "HOLD", reason: `${dossier.lifecycle.evidenceSessions} scored sessions/${dossier.lifecycle.scoredOpportunities} scored outcomes; moving from two to four contracts changes replayed portfolio result by ${changeText} with ${displacementText} additional competing displacements, but the channel is grouped for ${dossier.lifecycle.decisionGroup.replaceAll("_", " ")}.` }
      : { state: "HOLD", reason: `The replay supports ${dossier.capacity.bestSupportedContracts ?? "no verified"} contract level; four is not yet defensible.` };
  }
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
