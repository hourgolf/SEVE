import { createHash } from "node:crypto";
import type { ChannelDecisionBrief, ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket } from "./channelExperimentLifecycle";

export const NEXT_SEVEN_ACTION_PROGRAM_VERSION =
  "next-seven-channel-actions-2026-08-20-v2" as const;

export type NextSevenActionKind = "exit_test" | "entry_test" | "collection_hold"
  | "size_hold" | "collection_and_size_hold" | "review_trigger";

export interface NextSevenAction {
  number: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  kind: NextSevenActionKind;
  channels: string[];
  decision: string;
  control: string;
  challenger: string | null;
  keepFixed: string[];
  measure: string[];
  evidence: string[];
  readiness: "prepared" | "collecting" | "hold";
  reviewAfter: string;
  automaticActivation: false;
}

export interface NextSevenActionProgram {
  schemaVersion: 1;
  programVersion: typeof NEXT_SEVEN_ACTION_PROGRAM_VERSION;
  generatedAt: string;
  throughSession: string;
  actions: NextSevenAction[];
  summary: {
    preparedTests: number;
    collectionHolds: number;
    sizeChanges: 0;
    automaticRosterChanges: 0;
  };
  guarantees: {
    productionWrites: 0;
    runtimeMutationAuthority: false;
    orderAuthority: false;
    automaticActivation: false;
  };
  programSha256: string;
}

const HOLD_CHANNELS = [
  "grind-v3", "grind-v3-2", "breakout", "breakout-alt-v3-itm",
  "grind-smart-entries",
] as const;
const SIZE_HOLD_CHANNELS = [
  "vb-macd-state", "momo-shape-2", "orb-ustop-ctl", "qqq-thrust-trail-wd", "vb-level-break",
  ...HOLD_CHANNELS, "vb-ribbon-cross-iwm",
] as const;

const money = (value: number | null): string => value == null
  ? "not available" : `${value < 0 ? "−" : value > 0 ? "+" : ""}$${Math.abs(value)}`;
const percent = (value: number | null): string => value == null
  ? "not available" : `${value < 0 ? "−" : value > 0 ? "+" : ""}${Math.abs(value).toFixed(1)}%`;
const hash = (value: unknown): string => `sha256:${createHash("sha256")
  .update(JSON.stringify(value)).digest("hex")}`;

function requiredBrief(bundle: ChannelDecisionBriefBundle, channel: string): ChannelDecisionBrief {
  const brief = bundle.channels[channel];
  if (!brief) throw new Error(`next-seven action channel is missing: ${channel}`);
  return brief;
}

function requireExperiment(packet: ChannelExperimentPacket, channel: string): void {
  if (!packet.plans[channel]) throw new Error(`next-seven experiment is missing: ${channel}`);
}

function experimentVariable(packet: ChannelExperimentPacket, channel: string,
  axis: "entry" | "exit" | "manager"): { control: string; challenger: string } {
  const variable = packet.plans[channel]?.variable;
  if (!variable || variable.axis !== axis) {
    throw new Error(`next-seven ${channel} ${axis} experiment variable is missing or mismatched`);
  }
  return { control: variable.control, challenger: variable.challenger };
}

export function buildNextSevenActionProgram(input: {
  briefs: ChannelDecisionBriefBundle;
  experiments: ChannelExperimentPacket;
}): NextSevenActionProgram {
  if (input.briefs.throughSession !== input.experiments.throughSession) {
    throw new Error("next-seven inputs do not share one through-session");
  }
  for (const channel of SIZE_HOLD_CHANNELS) requiredBrief(input.briefs, channel);
  for (const channel of ["vb-macd-state", "momo-shape-2", "orb-ustop-ctl", "qqq-thrust-trail-wd", "vb-level-break"]) {
    requireExperiment(input.experiments, channel);
  }

  const macd = requiredBrief(input.briefs, "vb-macd-state");
  const macd50 = macd.managers.compared.find((row) =>
    row.managerId === "LOCK50/30") ?? null;
  const momo = requiredBrief(input.briefs, "momo-shape-2");
  const momoBankRunner = momo.managers.compared.find((row) =>
    row.managerId === "BANK20/RUN50") ?? null;
  const orb = requiredBrief(input.briefs, "orb-ustop-ctl");
  const thrust = requiredBrief(input.briefs, "qqq-thrust-trail-wd");
  const tp13 = thrust.trail?.compared.find((row) => row.candidateId === "TP-13") ?? null;
  const level = requiredBrief(input.briefs, "vb-level-break");
  const ribbon = requiredBrief(input.briefs, "vb-ribbon-cross-iwm");
  const ribbonReviewSessionFloor = 4;
  const ribbonSessionsRemaining = Math.max(0,
    ribbonReviewSessionFloor - ribbon.evidence.decisionSessions);
  const macdVariable = experimentVariable(input.experiments, "vb-macd-state", "exit");
  const momoVariable = experimentVariable(input.experiments, "momo-shape-2", "manager");
  const orbVariable = experimentVariable(input.experiments, "orb-ustop-ctl", "entry");
  const thrustVariable = experimentVariable(input.experiments, "qqq-thrust-trail-wd", "exit");
  const levelVariable = experimentVariable(input.experiments, "vb-level-break", "entry");

  const actions: NextSevenAction[] = [
    {
      number: 1, kind: "exit_test", channels: ["vb-macd-state"],
      decision: "Run +18% all-out as the paper native and retain the displaced +50% all-out exit as a paired shadow control.",
      control: macdVariable.control,
      challenger: macdVariable.challenger,
      keepFixed: ["entry logic", "4 contracts", "account route", "priority", "collision policy"],
      measure: ["typical paired benefit", "improvement frequency", "session downside", "available-move capture"],
      evidence: [
        `${macd.executed.sessions} current-era session(s), ${macd.executed.logicalTrades} logical trade(s), ${money(macd.executed.totalResultUsd)}`,
        `native typical best move ${percent(macd.nativeExit.typicalBestMovePct)} and capture ${percent(macd.nativeExit.typicalCapture == null ? null : macd.nativeExit.typicalCapture * 100)}`,
        macd50 ? `displaced +50 comparator: ${macd50.pairedOpportunities} paired path(s) across ${macd50.sessions} session(s); typical benefit ${percent(macd50.typicalBenefitPct)}` : "displaced +50 comparator awaits its first new-era path",
      ],
      readiness: "prepared", reviewAfter: "5 independent sessions and 10 paired logical opportunities, with an early stop after two materially worse sessions",
      automaticActivation: false,
    },
    {
      number: 2, kind: "entry_test", channels: ["orb-ustop-ctl"],
      decision: "Score the entry gate that is already live against reconstructed raw ORB signals; do not stack another ORB configuration change.",
      control: orbVariable.control,
      challenger: orbVariable.challenger,
      keepFixed: ["B30/A13 exit", "4 contracts", "Account 3 priority 1", "same-OCC protection"],
      measure: ["qualified versus excluded opportunity", "typical result", "blocked winners", "protected losses", "session drawdown"],
      evidence: [
        `${orb.evidence.decisionSessions} decision session(s) and ${orb.evidence.decisionOpportunities} current decision opportunity/opportunities`,
        `native typical best move ${percent(orb.nativeExit.typicalBestMovePct)}; this remains an entry-quality question`,
      ],
      readiness: "collecting", reviewAfter: "5 qualified sessions and 10 paired qualified/raw opportunities",
      automaticActivation: false,
    },
    {
      number: 3, kind: "exit_test", channels: ["qqq-thrust-trail-wd"],
      decision: "Shadow a fixed +13% all-out exit against the current +20% all-out exit.",
      control: thrustVariable.control,
      challenger: thrustVariable.challenger,
      keepFixed: ["entry logic", "2 contracts", "Account 3 route", "one entry per session"],
      measure: ["paired benefit", "target-hit frequency", "downside after reaching +13%", "outlier dependence"],
      evidence: [
        `${thrust.executed.sessions} current-era session(s), ${thrust.executed.logicalTrades} logical trade(s), ${money(thrust.executed.totalResultUsd)}`,
        tp13 ? `TP13 trail candidate: ${tp13.pairedOpportunities} paired path(s) across ${tp13.sessions} session(s); typical benefit ${percent(tp13.typicalBenefitPct)}` : "TP13 candidate awaits its first comparable trail path",
      ],
      readiness: "prepared", reviewAfter: "5 independent sessions and 10 paired paths",
      automaticActivation: false,
    },
    {
      number: 4, kind: "entry_test", channels: ["vb-level-break"],
      decision: "Compare the first eligible entry with a shadow path that skips it and waits for the next independently confirmed signal.",
      control: levelVariable.control,
      challenger: levelVariable.challenger,
      keepFixed: ["native +25% all-out exit", "-30% stop", "2 contracts", "Account 2 route"],
      measure: ["entry-one versus later-entry typical result", "confirmation frequency", "missed winners", "session downside"],
      evidence: [
        `${level.evidence.decisionSessions} decision session(s) and ${level.evidence.decisionOpportunities} decision opportunities`,
        `historical virtual typical ${money(level.historicalVirtual.typicalResultPerContractUsd)} per contract across ${level.historicalVirtual.scored} scored paths`,
      ],
      readiness: "prepared", reviewAfter: "5 independent sessions and 10 comparable entry-ordinal opportunities",
      automaticActivation: false,
    },
    {
      number: 5, kind: "exit_test", channels: ["momo-shape-2"],
      decision: "Keep +27% all-out native while prospectively comparing BANK20/RUN50 on every eligible real fill.",
      control: momoVariable.control,
      challenger: momoVariable.challenger,
      keepFixed: ["entry logic", "6 contracts", "Account 1 route", "priority", "collision policy"],
      measure: ["typical paired benefit", "improvement frequency", "runner downside", "available-move capture"],
      evidence: [
        `${momo.executed.sessions} current-era session(s), ${momo.executed.logicalTrades} logical trade(s), ${money(momo.executed.totalResultUsd)}`,
        `native typical best move ${percent(momo.nativeExit.typicalBestMovePct)} and capture ${percent(momo.nativeExit.typicalCapture == null ? null : momo.nativeExit.typicalCapture * 100)}`,
        momoBankRunner ? `BANK20/RUN50: ${momoBankRunner.pairedOpportunities} paired path(s) across ${momoBankRunner.sessions} session(s); typical benefit ${percent(momoBankRunner.typicalBenefitPct)}` : "BANK20/RUN50 awaits its first comparable path",
      ],
      readiness: "prepared", reviewAfter: "5 independent sessions and 10 paired logical opportunities, with an early stop after two materially worse sessions",
      automaticActivation: false,
    },
    {
      number: 6, kind: "collection_and_size_hold", channels: [...new Set([...SIZE_HOLD_CHANNELS, ...HOLD_CHANNELS])],
      decision: "Keep the named current configurations and contract counts unchanged while their entry and exit tests resolve; continue channel-specific nightly capacity replay.",
      control: "current per-channel contract count",
      challenger: null,
      keepFixed: ["receipt-bound entry, exit, manager, size, route, and priority outside the named tests"],
      measure: ["current-era result", "entry quality", "marginal expectancy", "peak debit", "displaced peer opportunities"],
      evidence: [...new Set([...SIZE_HOLD_CHANNELS, ...HOLD_CHANNELS])].map((channel) => {
        const row = requiredBrief(input.briefs, channel);
        return `${channel}: ${row.executed.sessions} current-era session(s); current ${row.capacity.currentContracts ?? "unknown"} contract(s); ${row.capacity.bestSupportedContracts == null ? "no supported next step" : `replay candidate ${row.capacity.bestSupportedContracts}`}`;
      }),
      readiness: "hold", reviewAfter: "the channel's active one-variable test resolves and its 1–6 contract replay supports a marginal step",
      automaticActivation: false,
    },
    {
      number: 7, kind: "review_trigger", channels: ["vb-ribbon-cross-iwm"],
      decision: ribbonSessionsRemaining === 0
        ? "The two-session collection window is complete: review keep-paper versus observe-only now; never change posture automatically."
        : "Collect two additional independent current-era sessions, then force a keep-paper versus observe-only review; never change posture automatically.",
      control: "current first-entry-only, 2-contract paper collection",
      challenger: "operator-reviewed observe-only posture if evidence remains negative and redundant",
      keepFixed: ["first-entry-only rule", "+25% target", "-30% stop", "2 contracts", "Account 2 route"],
      measure: ["typical result", "positive-session frequency", "unique IWM behavior", "redundancy with breakout-alt-v3-iwm"],
      evidence: [
        `${ribbon.evidence.decisionSessions} decision session(s), ${ribbon.evidence.decisionOpportunities} decision opportunities`,
        `historical virtual typical ${money(ribbon.historicalVirtual.typicalResultPerContractUsd)} per contract across ${ribbon.historicalVirtual.scored} scored paths`,
      ],
      readiness: ribbonSessionsRemaining === 0 ? "prepared" : "collecting",
      reviewAfter: ribbonSessionsRemaining === 0
        ? "review now"
        : `${ribbonSessionsRemaining} additional independent current-configuration session${ribbonSessionsRemaining === 1 ? "" : "s"} after 2026-08-18`,
      automaticActivation: false,
    },
  ];

  for (const action of actions.filter((row) => row.kind === "entry_test"
      || row.kind === "exit_test")) {
    const channel = action.channels[0];
    const plan = input.experiments.plans[channel];
    if (!plan?.variable || plan.variable.control !== action.control
        || plan.variable.challenger !== action.challenger) {
      throw new Error(`next-seven action disagrees with frozen experiment: ${channel}`);
    }
    const brief = requiredBrief(input.briefs, channel);
    const eligible = action.kind === "entry_test"
      ? brief.evidence.decisionOpportunities : brief.executed.logicalTrades;
    if (eligible > 0 && plan.collection.logicalOpportunities === 0) {
      throw new Error(`eligible ${channel} fill or decision produced no intended paired experiment evidence`);
    }
  }

  const body = {
    generatedAt: input.briefs.generatedAt,
    throughSession: input.briefs.throughSession,
    actions,
    summary: {
      preparedTests: actions.filter((row) => row.kind === "entry_test" || row.kind === "exit_test").length,
      collectionHolds: actions.filter((row) => row.kind === "collection_hold"
        || row.kind === "collection_and_size_hold" || row.kind === "review_trigger").length,
      sizeChanges: 0 as const,
      automaticRosterChanges: 0 as const,
    },
  };
  return {
    schemaVersion: 1,
    programVersion: NEXT_SEVEN_ACTION_PROGRAM_VERSION,
    ...body,
    guarantees: { productionWrites: 0, runtimeMutationAuthority: false,
      orderAuthority: false, automaticActivation: false },
    programSha256: hash(body),
  };
}

export function renderNextSevenActionProgram(program: NextSevenActionProgram): string {
  return [
    `# Seven-action channel program · through ${program.throughSession}`,
    "",
    "Five channel-specific tests, one explicit hold, and one timed review. Nothing activates automatically.",
    "",
    "| # | Channel(s) | State | What happens next |",
    "|---:|---|---|---|",
    ...program.actions.map((row) =>
      `| ${row.number} | ${row.channels.join(", ")} | ${row.readiness} | ${row.decision} |`),
    "",
    "## Test definitions",
    "",
    ...program.actions.flatMap((row) => [
      `### ${row.number}. ${row.channels.join(", ")}`,
      "",
      `- Control: ${row.control}`,
      `- Challenger: ${row.challenger ?? "none; unchanged collection"}`,
      `- Keep fixed: ${row.keepFixed.join("; ")}`,
      `- Review after: ${row.reviewAfter}`,
      `- Evidence now: ${row.evidence.join(" · ")}`,
      "",
    ]),
    "No production behavior, roster, order, or sizing change is authorized by this packet.",
  ].join("\n");
}
