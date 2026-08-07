import type { ChannelManagerEvidence } from "./channelManagerEvidence";
import type { ChannelDryPowderCurve, ShadowChannelSummary } from "./shadowResearch";
import { boundedRetuneForChannel, type BoundedRetuneExperimentDefinition } from "./boundedRetuneRegistry";

export interface DecisionAtlasPreviewMetric {
  label: "typical result" | "best move" | "gave back" | "next entry" | "evidence";
  value: string;
  fact: string;
}

export interface DecisionAtlasPreview {
  label: "DARK TEST" | "REVIEW MANAGER" | "TEST CAPACITY" | "REVIEW EXIT" | "REVIEW ENTRY" | "KEEP COLLECTING";
  tone: "positive" | "warning" | "neutral";
  summary: string;
  metrics: DecisionAtlasPreviewMetric[];
  evidenceFact: string;
  experiment: BoundedRetuneExperimentDefinition | null;
}

const signed = (value: number | null, suffix = ""): string => value == null
  ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}${suffix}`;

export function buildDecisionAtlasPreview(input: {
  summary?: ShadowChannelSummary | null;
  dryPowder?: ChannelDryPowderCurve | null;
  managerEvidence?: ChannelManagerEvidence | null;
}): DecisionAtlasPreview {
  const typical = input.summary?.typicalPerPath ?? null;
  const sessions = input.dryPowder?.sessionCount ?? input.managerEvidence?.sessions ?? 0;
  const first = input.dryPowder?.points[0]?.marginalAveragePerPath ?? null;
  const next = input.dryPowder?.points[1]?.marginalAveragePerPath ?? null;
  const manager = input.managerEvidence?.managers.find((item) => item.verdict === "promising"
    && item.terminalPaths >= 10 && item.sessions >= 5
    && item.deltaConfidence95.lower != null && item.deltaConfidence95.lower > 0) ?? null;
  const experiment = input.summary ? boundedRetuneForChannel(input.summary.slug) : null;
  let label: DecisionAtlasPreview["label"] = "KEEP COLLECTING";
  let tone: DecisionAtlasPreview["tone"] = "neutral";
  let summary = "Virtual evidence is not settled enough to prefer a change.";
  if (experiment) {
    label = "DARK TEST";
    tone = "warning";
    summary = experiment.variable === "max_entries_per_session"
      ? `Compare every signal with the first ${experiment.alternativeValue} per session. Exit, manager, and size stay fixed.`
      : `Compare the native +${experiment.controlValue}% exit with +${experiment.alternativeValue}%. Entry, stop, manager, and size stay fixed.`;
  } else if (manager) {
    label = "REVIEW MANAGER";
    tone = "positive";
    summary = `${manager.managerId} improves the typical paired virtual exit with session-level support.`;
  } else if (sessions >= 5 && (typical ?? 0) > 0 && (first ?? 0) > 0 && (next ?? 0) > 0) {
    label = "TEST CAPACITY";
    tone = "positive";
    summary = "The typical virtual path and the next entry are positive; run the full capital replay before sizing.";
  } else if (sessions >= 5 && (typical ?? 0) > 0 && (input.summary?.averageGivebackPct ?? 0) >= 40) {
    label = "REVIEW EXIT";
    tone = "warning";
    summary = "Virtual entries find opportunity, but the modeled exit gives back a large share of the move.";
  } else if (sessions >= 10 && typical != null && typical < 0) {
    label = "REVIEW ENTRY";
    tone = "warning";
    summary = "The typical virtual path is negative; check uniqueness and configuration era before keeping or retiring it.";
  }
  return {
    label,
    tone,
    summary,
    metrics: [
      { label: "typical result", value: `${signed(typical, " / ct")}`,
        fact: "Median native path; one large winner cannot move it much." },
      { label: "best move", value: signed(input.summary?.averageMfePct ?? null, "%"),
        fact: "Average best move while the path was open." },
      { label: "gave back", value: signed(input.summary?.averageGivebackPct ?? null, "%"),
        fact: "Average of the move surrendered; above 100% means the path finished below entry." },
      { label: "next entry", value: `${signed(next, " / ct")}`,
        fact: "Typical quality of the second same-session signal; capital-blind." },
      { label: "evidence", value: `${sessions} session${sessions === 1 ? "" : "s"}`,
        fact: "Independent market sessions represented." },
    ],
    evidenceFact: input.summary
      ? `${input.summary.scored}/${input.summary.paths} historical native paths scored · largest winner ${input.summary.largestWinnerShare == null ? "unknown" : `${Math.round(input.summary.largestWinnerShare * 100)}% of positive result`}.${experiment ? ` Prospective scoring starts ${experiment.cohortStartSession}; review waits for 5 sessions and 10 logical outcomes.` : ""} Full configuration-era, collision, capital, and paired-exit checks remain in the nightly dossier.`
      : "No cumulative native-path summary is available. Full methodology remains in the nightly dossier.",
    experiment,
  };
}
