import { createHash } from "node:crypto";
import type { ChannelSpecVersion } from "@/lib/channels/channelControlPlane";
import type { ChannelDecisionBrief, ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket, ChannelExperimentPlan } from "./channelExperimentLifecycle";
import type {
  ChannelLifecycleDecision,
  ChannelLifecycleDecisionPacket,
  LifecycleOperatorAction,
} from "./channelLifecycleDecision";

export const CHANNEL_RESEARCH_BOOKS_VERSION = "channel-research-books-v1" as const;

export type ChannelResearchBook = "core" | "experiment" | "shadow" | "archive";

export interface ChannelResearchMetric {
  label: string;
  value: string;
  fact: string;
}

export interface ChannelResearchAssignment {
  book: ChannelResearchBook;
  bookLabel: "PROVISIONAL CORE" | "LIVE EXPERIMENT" | "SHADOW INVESTIGATION" | "ARCHIVE";
  runtimePosture: "paper" | "observe-only" | "paused";
  headline: string;
  question: string;
  control: string;
  challenger: string | null;
  keepFixed: string[];
  progress: {
    independentSessions: number;
    logicalOpportunities: number;
    targetIndependentSessions: 5;
    targetLogicalOpportunities: 10;
    state: "building" | "ready_for_review" | "monitoring";
  };
  nextDecision: string;
  metrics: ChannelResearchMetric[];
  operatorDecision: null | {
    rank: 1 | 2 | 3;
    action: LifecycleOperatorAction | "archive_review";
    headline: string;
  };
  programSummary?: {
    provisionalCore: number;
    liveExperiments: number;
    shadowInvestigations: number;
    archivedCollectors: number;
    archiveChannels: string[];
    classificationComplete: boolean;
    auditMessage: string;
  };
  proposalOnly: true;
  runtimeAuthority: false;
}

export interface ChannelResearchDecision {
  channel: string;
  action: LifecycleOperatorAction | "archive_review";
  headline: string;
  evidence: string;
  nextStep: string;
  proposalOnly: true;
}

export interface ChannelResearchBooksPacket {
  schemaVersion: 1;
  version: typeof CHANNEL_RESEARCH_BOOKS_VERSION;
  generatedAt: string;
  throughSession: string;
  program: "institutional-four-book-v1";
  summary: {
    sealedRoots: number;
    provisionalCore: number;
    liveExperiments: number;
    shadowInvestigations: number;
    archivedCollectors: number;
    decisionsForOperator: number;
  };
  books: Record<ChannelResearchBook, string[]>;
  channels: Record<string, ChannelResearchAssignment>;
  decisionInbox: ChannelResearchDecision[];
  audit: {
    expectedSealedRoots: number;
    missingExpectedRoots: string[];
    unexpectedSealedRoots: string[];
    duplicateAssignments: string[];
    classificationComplete: boolean;
  };
  methodology: string[];
  guarantees: {
    productionReads: 0;
    productionWrites: 0;
    runtimeAuthority: false;
    automaticActivation: false;
    maximumOperatorDecisions: 3;
  };
  packetSha256: string;
}

const CORE = Object.freeze(["breakout", "pb-ride-itm"] as const);
const EXPERIMENT = Object.freeze([
  "breakout-alt-v3-itm",
  "grind-v3",
  "momo-shape-2",
  "orb-ustop-ctl",
  "qqq-thrust-trail-wd",
] as const);
const EXPECTED_SHADOW = Object.freeze([
  "breakout-alt-v3-iwm",
  "breakout-qqq",
  "grind-smart-entries",
  "grind-v3-2",
  "orb-qqq-trail",
  "pb-ride",
  "vb-gap-drift",
  "vb-level-break",
  "vb-macd-state",
  "vb-ribbon-cross-iwm",
  "vb-ribbon-cross-qqq",
  "orb-trend-rider",
  "vb-curl-reversal-iwm",
  "vb-curl-reversal-qqq",
  "vb-gap-drift-qqq",
  "vb-or-fail-iwm",
  "vb-rsi-revert-iwm",
  "vb-vwap-revert-qqq",
] as const);
const ARCHIVE = Object.freeze([
  "power",
  "power-smart-entries",
  "momo-shape",
  "breakout-smart-entries-iwm",
  "breakout-alt-v3-qqq",
] as const);

const expectedRoots = [...CORE, ...EXPERIMENT, ...EXPECTED_SHADOW].sort();
const core = new Set<string>(CORE);
const experiment = new Set<string>(EXPERIMENT);

const sha256 = (value: unknown): string => `sha256:${createHash("sha256")
  .update(JSON.stringify(value)).digest("hex")}`;
const money = (value: number | null | undefined): string => value == null || !Number.isFinite(value)
  ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(Math.round(value))}`;
const pct = (value: number | null | undefined): string => value == null || !Number.isFinite(value)
  ? "—" : `${Math.round(value * 100)}%`;
const pctPoints = (value: number | null | undefined): string => value == null || !Number.isFinite(value)
  ? "—" : `${value > 0 ? "+" : ""}${Math.round(value * 10) / 10}%`;

function labelFor(book: ChannelResearchBook): ChannelResearchAssignment["bookLabel"] {
  return book === "core" ? "PROVISIONAL CORE"
    : book === "experiment" ? "LIVE EXPERIMENT"
      : book === "shadow" ? "SHADOW INVESTIGATION" : "ARCHIVE";
}

function bookFor(slug: string): ChannelResearchBook {
  if (core.has(slug)) return "core";
  if (experiment.has(slug)) return "experiment";
  return "shadow";
}

function compactMetrics(brief: ChannelDecisionBrief | undefined): ChannelResearchMetric[] {
  if (!brief) return [{ label: "evidence", value: "not refreshed", fact: "No current nightly brief is available." }];
  const distribution = brief.decisionDistribution;
  return [
    { label: "typical session", value: money(distribution?.typicalSessionUsd),
      fact: "Median result after grouping logical opportunities by session." },
    { label: "evidence", value: `${brief.evidence.decisionSessions}s / ${brief.evidence.decisionOpportunities}`,
      fact: "Independent sessions and logical opportunities in the decision cohort." },
    { label: "best move", value: pctPoints(distribution?.typicalBestMovePct ?? brief.nativeExit.typicalBestMovePct),
      fact: "Median favorable option move after entry; not realized profit." },
    { label: "move kept", value: pct(brief.nativeExit.typicalCapture ?? distribution?.coherentCapture),
      fact: "Typical final return divided by the favorable move, floored at zero when the finish is negative." },
  ];
}

const namedQuestion: Readonly<Record<string, string>> = Object.freeze({
  breakout: "Does exact-current paper execution continue to confirm a repeatable breakout edge without hidden downside concentration?",
  "pb-ride-itm": "Does its strong typical capture survive more independent sessions without the historical tail losses returning?",
  "breakout-alt-v3-itm": "Does the current ITM implementation reproduce its favorable virtual history in clean paper fills?",
  "grind-v3": "Can one bounded entry governor reduce weak repeat entries while the current exit, size, and route stay fixed?",
  "momo-shape-2": "Does BANK20/RUN50 protect the first gain without sacrificing the channel's larger continuation moves?",
  "orb-ustop-ctl": "Does the qualified ORB entry cohort outperform the raw ORB signals on the same session opportunities?",
  "qqq-thrust-trail-wd": "Does a +13% all-out challenger retain more of the move than the current +20% target without worsening downside?",
});

function researchQuestion(slug: string, brief: ChannelDecisionBrief | undefined,
  plan: ChannelExperimentPlan | undefined): string {
  return namedQuestion[slug]
    ?? (plan?.variable ? plan.hypothesis : null)
    ?? brief?.recommendation.nextExperiment
    ?? "Is this channel producing unique, repeatable evidence that warrants another bounded test?";
}

function progressFor(book: ChannelResearchBook, brief: ChannelDecisionBrief | undefined,
  plan: ChannelExperimentPlan | undefined): ChannelResearchAssignment["progress"] {
  const sessions = book === "experiment" && plan?.variable
    ? plan.collection.independentSessions : brief?.evidence.decisionSessions ?? 0;
  const opportunities = book === "experiment" && plan?.variable
    ? plan.collection.logicalOpportunities : brief?.evidence.decisionOpportunities ?? 0;
  return {
    independentSessions: sessions,
    logicalOpportunities: opportunities,
    targetIndependentSessions: 5,
    targetLogicalOpportunities: 10,
    state: book === "core" ? "monitoring"
      : sessions >= 5 && opportunities >= 10 ? "ready_for_review" : "building",
  };
}

function assignment(input: {
  slug: string;
  book: ChannelResearchBook;
  brief?: ChannelDecisionBrief;
  plan?: ChannelExperimentPlan;
  lifecycle?: ChannelLifecycleDecision;
  runtimePosture: ChannelResearchAssignment["runtimePosture"];
}): ChannelResearchAssignment {
  const { slug, book, brief, plan, lifecycle, runtimePosture } = input;
  const progress = progressFor(book, brief, plan);
  const control = plan?.variable?.control ?? (book === "archive" ? "collection paused" : "current sealed behavior");
  const challenger = plan?.variable?.challenger ?? null;
  const headline = book === "core"
    ? "Keep live as a provisional control; monitor evidence, not prestige."
    : book === "experiment"
      ? plan?.variable ? `Run one test: ${plan.variable.name}.` : "Collect a clean live baseline before defining one change."
      : book === "shadow" ? "Investigate in shadow; sealed runtime posture remains separate."
        : "Paused from collection; reopen only with a specific unanswered question.";
  const nextDecision = book === "core"
    ? "Keep, demote, or open one bounded test at the next scheduled review."
    : book === "experiment"
      ? progress.state === "ready_for_review" ? "Score the frozen control and challenger; approve, reject, or extend."
        : "Keep the test unchanged until both evidence floors are met or a stop condition fires."
      : book === "shadow" ? lifecycle?.plainLanguage ?? brief?.recommendation.nextExperiment ?? "Review when the evidence floor is met."
        : "Remain paused unless its evidence is unique and a new one-variable question is preregistered.";
  return {
    book,
    bookLabel: labelFor(book),
    runtimePosture,
    headline,
    question: researchQuestion(slug, brief, plan),
    control,
    challenger,
    keepFixed: plan?.fixed?.slice(0, 5) ?? ["entry", "exit", "manager", "size", "account route"],
    progress,
    nextDecision,
    metrics: book === "archive"
      ? [{ label: "posture", value: "paused", fact: "No new paper entries or research paths are requested by this program." }]
      : compactMetrics(brief).slice(0, 4),
    operatorDecision: null,
    proposalOnly: true,
    runtimeAuthority: false,
  };
}

const actionRank: Record<LifecycleOperatorAction, number> = {
  retirement_review: 0,
  promotion_review: 1,
  manager_review: 2,
  size_review: 3,
  one_variable_experiment: 4,
  keep_trading: 5,
  continue_unique_collection: 6,
};

function decisionInbox(channels: Record<string, ChannelResearchAssignment>,
  lifecycle: ChannelLifecycleDecisionPacket): ChannelResearchDecision[] {
  return Object.values(lifecycle.channels)
    .filter((row) => channels[row.channel] && !["keep_trading", "continue_unique_collection"].includes(row.action))
    .sort((left, right) => actionRank[left.action] - actionRank[right.action]
      || (right.confidence === "established" ? 2 : right.confidence === "directional" ? 1 : 0)
        - (left.confidence === "established" ? 2 : left.confidence === "directional" ? 1 : 0)
      || right.scoredSessions - left.scoredSessions
      || right.scoredOpportunities - left.scoredOpportunities
      || left.channel.localeCompare(right.channel))
    .slice(0, 3)
    .map((row) => ({
      channel: row.channel,
      action: row.action,
      headline: row.plainLanguage,
      evidence: `${row.scoredSessions}s / ${row.scoredOpportunities} logical opportunities · ${row.confidence}`,
      nextStep: row.reasons[0] ?? "Review the paired evidence before changing behavior.",
      proposalOnly: true,
    }));
}

export function buildChannelResearchBooks(input: {
  briefs: ChannelDecisionBriefBundle;
  experiments: ChannelExperimentPacket;
  lifecycle: ChannelLifecycleDecisionPacket;
  activeChannelSpecs: readonly ChannelSpecVersion[];
}): ChannelResearchBooksPacket {
  const active = input.activeChannelSpecs.filter((spec) => spec.status === "active")
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const activeSlugs = active.map((spec) => spec.slug);
  const channels: Record<string, ChannelResearchAssignment> = {};
  for (const spec of active) {
    channels[spec.slug] = assignment({
      slug: spec.slug,
      book: bookFor(spec.slug),
      brief: input.briefs.channels[spec.slug],
      plan: input.experiments.plans[spec.slug],
      lifecycle: input.lifecycle.channels[spec.slug],
      runtimePosture: spec.executionPosture ?? "paper",
    });
  }
  for (const slug of ARCHIVE) {
    channels[slug] = assignment({ slug, book: "archive", runtimePosture: "paused" });
  }
  const books = {
    core: Object.keys(channels).filter((slug) => channels[slug].book === "core").sort(),
    experiment: Object.keys(channels).filter((slug) => channels[slug].book === "experiment").sort(),
    shadow: Object.keys(channels).filter((slug) => channels[slug].book === "shadow").sort(),
    archive: Object.keys(channels).filter((slug) => channels[slug].book === "archive").sort(),
  };
  const allAssigned = [...books.core, ...books.experiment, ...books.shadow];
  const duplicates = allAssigned.filter((slug, index) => allAssigned.indexOf(slug) !== index);
  const expected = new Set<string>(expectedRoots);
  const activeSet = new Set(activeSlugs);
  const missingExpectedRoots = expectedRoots.filter((slug) => !activeSet.has(slug));
  const unexpectedSealedRoots = activeSlugs.filter((slug) => !expected.has(slug));
  const inbox = decisionInbox(channels, input.lifecycle);
  const programSummary = {
    provisionalCore: books.core.length,
    liveExperiments: books.experiment.length,
    shadowInvestigations: books.shadow.length,
    archivedCollectors: books.archive.length,
    archiveChannels: [...books.archive],
    classificationComplete: missingExpectedRoots.length === 0 && unexpectedSealedRoots.length === 0 && duplicates.length === 0,
    auditMessage: missingExpectedRoots.length || unexpectedSealedRoots.length || duplicates.length
      ? `${missingExpectedRoots.length} inactive research registration(s) · ${unexpectedSealedRoots.length} active root(s) without research registration · ${duplicates.length} duplicate assignment(s)`
      : "All sealed roots are assigned exactly once.",
  };
  for (const [index, decision] of inbox.entries()) {
    const row = channels[decision.channel];
    if (row) row.operatorDecision = {
      rank: (index + 1) as 1 | 2 | 3,
      action: decision.action,
      headline: decision.headline,
    };
  }
  for (const slug of activeSlugs) channels[slug].programSummary = programSummary;
  const body = {
    generatedAt: input.briefs.generatedAt,
    throughSession: input.briefs.throughSession,
    program: "institutional-four-book-v1" as const,
    summary: {
      sealedRoots: active.length,
      provisionalCore: books.core.length,
      liveExperiments: books.experiment.length,
      shadowInvestigations: books.shadow.length,
      archivedCollectors: books.archive.length,
      decisionsForOperator: inbox.length,
    },
    books,
    channels,
    decisionInbox: inbox,
    audit: {
      expectedSealedRoots: expectedRoots.length,
      missingExpectedRoots,
      unexpectedSealedRoots,
      duplicateAssignments: [...new Set(duplicates)].sort(),
      classificationComplete: missingExpectedRoots.length === 0 && unexpectedSealedRoots.length === 0 && duplicates.length === 0,
    },
    methodology: [
      "Separate provisional controls, one-variable live experiments, capital-free shadow investigations, and paused archives.",
      "Judge the typical session, downside, capture, and paired alternatives; total profit or win rate alone never decides a channel.",
      "Keep entry, exit, manager, size, route, and collision policy fixed except for the one preregistered variable.",
      "Require both five independent sessions and ten logical opportunities before a scheduled score, unless a safety stop ends the test sooner.",
      "Show no more than three operator decisions per nightly close; everything else keeps collecting or remains archived.",
    ],
    guarantees: {
      productionReads: 0 as const,
      productionWrites: 0 as const,
      runtimeAuthority: false as const,
      automaticActivation: false as const,
      maximumOperatorDecisions: 3 as const,
    },
  };
  return { schemaVersion: 1, version: CHANNEL_RESEARCH_BOOKS_VERSION, ...body, packetSha256: sha256(body) };
}

export function renderChannelResearchBooks(packet: ChannelResearchBooksPacket): string {
  const sections: Array<[ChannelResearchBook, string]> = [
    ["core", "Provisional core"],
    ["experiment", "Live paper experiments"],
    ["shadow", "Shadow investigations"],
    ["archive", "Archive"],
  ];
  return [
    `# Channel research books · through ${packet.throughSession}`,
    "",
    `**${packet.summary.provisionalCore} core · ${packet.summary.liveExperiments} experiments · ${packet.summary.shadowInvestigations} shadow · ${packet.summary.archivedCollectors} archive**`,
    "",
    ...sections.flatMap(([book, title]) => [
      `## ${title}`,
      "",
      ...packet.books[book].map((slug) => {
        const row = packet.channels[slug];
        return `- **${slug}** · ${row.runtimePosture} · ${row.headline} ${row.progress.independentSessions}s / ${row.progress.logicalOpportunities} opportunities.`;
      }),
      "",
    ]),
    "## Operator inbox",
    "",
    ...(packet.decisionInbox.length ? packet.decisionInbox.map((row) => `- **${row.channel}** · ${row.headline}`) : ["- No decision clears the nightly review gate."]),
    "",
    "Research posture only. No channel, order, configuration, size, manager, route, or schedule can be changed by this packet.",
  ].join("\n");
}
