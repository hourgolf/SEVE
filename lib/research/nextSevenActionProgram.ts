import { createHash } from "node:crypto";
import type { ChannelDecisionBrief, ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket } from "./channelExperimentLifecycle";

export const NEXT_SEVEN_ACTION_PROGRAM_VERSION =
  "next-seven-channel-actions-2026-08-18-v1" as const;

export type NextSevenActionKind = "exit_test" | "entry_test" | "collection_hold"
  | "size_hold" | "review_trigger";

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
] as const;
const SIZE_HOLD_CHANNELS = [
  "vb-macd-state", "orb-ustop-ctl", "qqq-thrust-trail-wd", "vb-level-break",
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

export function buildNextSevenActionProgram(input: {
  briefs: ChannelDecisionBriefBundle;
  experiments: ChannelExperimentPacket;
}): NextSevenActionProgram {
  if (input.briefs.throughSession !== input.experiments.throughSession) {
    throw new Error("next-seven inputs do not share one through-session");
  }
  for (const channel of SIZE_HOLD_CHANNELS) requiredBrief(input.briefs, channel);
  for (const channel of ["vb-macd-state", "orb-ustop-ctl", "qqq-thrust-trail-wd", "vb-level-break"]) {
    requireExperiment(input.experiments, channel);
  }

  const macd = requiredBrief(input.briefs, "vb-macd-state");
  const macd18 = macd.managers.compared.find((row) =>
    row.managerId === "VB-MACD-CURRENT-LOCK18") ?? null;
  const orb = requiredBrief(input.briefs, "orb-ustop-ctl");
  const thrust = requiredBrief(input.briefs, "qqq-thrust-trail-wd");
  const tp13 = thrust.trail?.compared.find((row) => row.candidateId === "TP-13") ?? null;
  const level = requiredBrief(input.briefs, "vb-level-break");
  const ribbon = requiredBrief(input.briefs, "vb-ribbon-cross-iwm");
  const ribbonReviewSessionFloor = 4;
  const ribbonSessionsRemaining = Math.max(0,
    ribbonReviewSessionFloor - ribbon.evidence.decisionSessions);

  const actions: NextSevenAction[] = [
    {
      number: 1, kind: "exit_test", channels: ["vb-macd-state"],
      decision: "Compare the current +50% all-out exit with the already captured +18% all-out control; retain LOCK20/30 as a second shadow observer.",
      control: "current all-out +50% / -30% stop",
      challenger: "VB-MACD-CURRENT-LOCK18 all-out +18% / -30% stop",
      keepFixed: ["entry logic", "4 contracts", "account route", "priority", "collision policy"],
      measure: ["typical paired benefit", "improvement frequency", "session downside", "available-move capture"],
      evidence: [
        `${macd.executed.sessions} current-era session(s), ${macd.executed.logicalTrades} logical trade(s), ${money(macd.executed.totalResultUsd)}`,
        `native typical best move ${percent(macd.nativeExit.typicalBestMovePct)} and capture ${percent(macd.nativeExit.typicalCapture == null ? null : macd.nativeExit.typicalCapture * 100)}`,
        macd18 ? `+18 comparator: ${macd18.pairedOpportunities} paired path(s) across ${macd18.sessions} session(s); typical benefit ${percent(macd18.typicalBenefitPct)}` : "+18 comparator is still awaiting a comparable path",
      ],
      readiness: "prepared", reviewAfter: "5 independent sessions and 10 paired logical opportunities, with an early stop after two materially worse sessions",
      automaticActivation: false,
    },
    {
      number: 2, kind: "entry_test", channels: ["orb-ustop-ctl"],
      decision: "Score the entry gate that is already live against reconstructed raw ORB signals; do not stack another ORB configuration change.",
      control: "raw ORB signals retained after close",
      challenger: "current after-10:30 ET, non-CPI/OPEX entry qualification",
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
      control: "current all-out +20% / -30% stop",
      challenger: "shadow all-out +13% / -30% stop",
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
      control: "current first eligible entry",
      challenger: "shadow skip-first / next-confirmed entry",
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
      number: 5, kind: "collection_hold", channels: [...HOLD_CHANNELS],
      decision: "Keep these current configurations unchanged so their new-era results remain attributable.",
      control: "current receipt-bound entry, exit, manager, size, route, and priority",
      challenger: null,
      keepFixed: ["all production behavior for the four named channels"],
      measure: ["current-era sessions", "typical logical-trade result", "exit capture", "entry-order stability"],
      evidence: HOLD_CHANNELS.map((channel) => {
        const row = requiredBrief(input.briefs, channel);
        return `${channel}: ${row.executed.sessions} latest-era session(s), ${row.executed.logicalTrades} trade(s), ${money(row.executed.totalResultUsd)}`;
      }),
      readiness: "hold", reviewAfter: "each channel reaches 5 current-era sessions and 10 logical opportunities, or triggers its early-stop rule",
      automaticActivation: false,
    },
    {
      number: 6, kind: "size_hold", channels: [...SIZE_HOLD_CHANNELS],
      decision: "Make no contract change while entry and exit tests are unresolved; keep sizing decisions channel-specific in the nightly replay.",
      control: "current per-channel contract count",
      challenger: null,
      keepFixed: ["each named channel's current quantity"],
      measure: ["marginal expectancy", "deployment frequency", "peak debit", "displaced peer opportunities", "portfolio drawdown"],
      evidence: SIZE_HOLD_CHANNELS.map((channel) => {
        const row = requiredBrief(input.briefs, channel);
        return `${channel}: current ${row.capacity.currentContracts ?? "unknown"} contract(s); ${row.capacity.bestSupportedContracts == null ? "no supported next step" : `replay candidate ${row.capacity.bestSupportedContracts}`}`;
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

  const body = {
    generatedAt: input.briefs.generatedAt,
    throughSession: input.briefs.throughSession,
    actions,
    summary: {
      preparedTests: actions.filter((row) => row.kind === "entry_test" || row.kind === "exit_test").length,
      collectionHolds: actions.filter((row) => row.kind === "collection_hold" || row.kind === "review_trigger").length,
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
    "Four channel-specific tests, two explicit holds, and one timed review. Nothing activates automatically.",
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
