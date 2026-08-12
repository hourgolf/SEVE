import type { ChannelDecisionAxis, ChannelDecisionBrief } from "./channelDecisionBrief";

export const RESEARCH_COUNCIL_VERSION = "research-council-v1" as const;

export type ResearchAgentId =
  | "scout"
  | "harvester"
  | "mechanic"
  | "allocator"
  | "skeptic"
  | "designer"
  | "arbiter";

export interface ResearchAgentDefinition {
  id: ResearchAgentId;
  name: string;
  callsign: string;
  role: string;
  voice: string;
  color: string;
}

export const RESEARCH_AGENTS: readonly ResearchAgentDefinition[] = Object.freeze([
  { id: "scout", name: "Signal Scout", callsign: "SCOUT", role: "Entry quality", voice: "Hype dies at the evidence line.", color: "cyan" },
  { id: "harvester", name: "Gain Harvester", callsign: "HARVEST", role: "Exit capture", voice: "Counts every dollar the exit left behind.", color: "amber" },
  { id: "mechanic", name: "Fill Mechanic", callsign: "WRENCH", role: "Execution friction", voice: "Blames the plumbing before the strategy.", color: "orange" },
  { id: "allocator", name: "Stack Architect", callsign: "STACK", role: "Capacity + overlap", voice: "Loves capacity. Hates paperwork.", color: "violet" },
  { id: "skeptic", name: "Prior Hunter", callsign: "GHOST", role: "Contradictions", voice: "Professional vibe checker—with receipts.", color: "red" },
  { id: "designer", name: "Test Designer", callsign: "VECTOR", role: "Next experiment", voice: "One knob or it didn't happen.", color: "green" },
  { id: "arbiter", name: "Desk Arbiter", callsign: "CHIEF", role: "Decision synthesis", voice: "Turns arguments into the next move.", color: "cream" },
]);

export type ResearchDispatchKind = "finding" | "challenge" | "experiment" | "decision";

export interface ResearchDispatch {
  id: string;
  sequence: number;
  agentId: ResearchAgentId;
  kind: ResearchDispatchKind;
  channel: string | null;
  axis: ChannelDecisionAxis | null;
  headline: string;
  message: string;
  evidence: Array<{ label: string; value: string }>;
  confidence: "checking" | "building" | "established";
  priority: number;
  replyTo: string | null;
}

export interface ResearchCouncilPacket {
  schemaVersion: 1;
  councilVersion: typeof RESEARCH_COUNCIL_VERSION;
  throughSession: string;
  generatedAt: string;
  analysisMode: "deterministic_specialists";
  agents: readonly ResearchAgentDefinition[];
  summary: {
    channelsReviewed: number;
    leads: number;
    conflicts: number;
    experiments: number;
    headline: string;
  };
  dispatches: ResearchDispatch[];
  productionWrites: 0;
  orderAuthority: false;
  configurationAuthority: false;
}

export function selectResearchCouncilBrief(
  packet: ResearchCouncilPacket,
  limit = 5,
): ResearchDispatch[] {
  if (limit <= 0) return [];
  const selected: ResearchDispatch[] = [];
  const selectedIds = new Set<string>();
  const selectedChannels = new Set<string>();
  const add = (row: ResearchDispatch | undefined, allowRepeatedChannel = false) => {
    if (!row || selected.length >= limit || selectedIds.has(row.id)) return;
    if (!allowRepeatedChannel && row.channel && selectedChannels.has(row.channel)) return;
    selected.push(row);
    selectedIds.add(row.id);
    if (row.channel) selectedChannels.add(row.channel);
  };
  const ranked = packet.dispatches;
  const pick = (kind: ResearchDispatchKind, allowRepeatedChannel = false) => ranked.find((row) =>
    row.kind === kind
    && !selectedIds.has(row.id)
    && (allowRepeatedChannel || !row.channel || !selectedChannels.has(row.channel)));
  const arbiter = ranked.find((row) => row.kind === "decision");
  add(arbiter, true);
  add(pick("challenge") ?? pick("challenge", true), true);
  add(pick("finding") ?? pick("finding", true), true);
  add(pick("experiment") ?? pick("experiment", true), true);
  add(pick("challenge") ?? pick("challenge", true), true);
  for (const row of ranked) add(row);
  for (const row of ranked) add(row, true);
  return selected;
}

const signedMoney = (value: number | null): string => value == null ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const percent = (value: number | null): string => value == null ? "—" : `${Math.round(value * 100)}%`;
const compact = (value: string, max = 168): string => value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
const pickVoice = (channel: string, lines: readonly string[]): string => lines[[...channel].reduce((sum, char) => sum + char.charCodeAt(0), 0) % lines.length]!;
const stableId = (...parts: Array<string | number | null>): string => parts.filter((part) => part != null)
  .join(":").toLowerCase().replace(/[^a-z0-9:-]+/g, "-").replace(/-+/g, "-");
const confidence = (brief: ChannelDecisionBrief): ResearchDispatch["confidence"] =>
  brief.evidence.decisionSessions >= 10 && brief.evidence.decisionOpportunities >= 20 ? "established"
    : brief.evidence.decisionSessions >= 5 && brief.evidence.decisionOpportunities >= 10 ? "building" : "checking";
const agentForAxis = (axis: ChannelDecisionAxis): ResearchAgentId =>
  axis === "entry" || axis === "promotion" ? "scout"
    : axis === "exit" || axis === "manager" ? "harvester"
      : axis === "size" ? "allocator"
        : axis === "retirement" ? "skeptic" : "mechanic";
const axisPriority = (axis: ChannelDecisionAxis): number => ({
  retirement: 92, promotion: 88, manager: 84, exit: 80, entry: 76, size: 72, collection: 48,
})[axis];
const voicedPrimary = (brief: ChannelDecisionBrief): string => {
  const summary = brief.recommendation.summary;
  if (brief.recommendation.axis === "promotion") return `Okay, this one brought receipts. ${summary}`;
  if (brief.recommendation.axis === "retirement") return `I checked twice. The vibes are not the edge. ${summary}`;
  if (brief.recommendation.axis === "exit") return `The entry did its job; the exit left the fridge open. ${summary}`;
  if (brief.recommendation.axis === "manager") return `Manager, please report to the principal's office. ${summary}`;
  if (brief.recommendation.axis === "size") return `More contracts are not a personality. ${summary}`;
  if (brief.recommendation.axis === "entry") return `Signal check: timing gets the microscope. ${summary}`;
  return `No victory lap yet. ${summary}`;
};

function primaryDispatch(brief: ChannelDecisionBrief): ResearchDispatch {
  const id = stableId("dispatch", brief.channel, brief.recommendation.axis, "primary");
  return {
    id,
    sequence: 0,
    agentId: agentForAxis(brief.recommendation.axis),
    kind: brief.recommendation.axis === "retirement" ? "challenge" : "finding",
    channel: brief.channel,
    axis: brief.recommendation.axis,
    headline: brief.recommendation.label,
    message: compact(voicedPrimary(brief)),
    evidence: [
      { label: "TYPICAL", value: signedMoney(brief.historicalVirtual.typicalResultPerContractUsd ?? brief.executed.typicalResultUsd) },
      { label: "EVIDENCE", value: `${brief.evidence.decisionSessions}s / ${brief.evidence.decisionOpportunities}` },
    ],
    confidence: confidence(brief),
    priority: axisPriority(brief.recommendation.axis),
    replyTo: null,
  };
}

function contradictionDispatches(brief: ChannelDecisionBrief, parent: ResearchDispatch): ResearchDispatch[] {
  const rows: ResearchDispatch[] = [];
  const virtualTypical = brief.historicalVirtual.typicalResultPerContractUsd;
  const virtualTotal = brief.historicalVirtual.totalResultPerContractUsd;
  const executedTypical = brief.executed.typicalResultUsd;
  if (brief.recommendation.axis === "promotion" && !brief.evidence.exactCurrentAvailable) {
    rows.push({
      id: stableId("dispatch", brief.channel, "unstamped-promotion"), sequence: 0, agentId: "skeptic", kind: "challenge",
      channel: brief.channel, axis: "promotion", headline: "PROMOTION CASE IS HISTORICAL",
      message: "Respectfully: that's a résumé written by the shadow ledger. Run a bounded paper experiment before calling it a proven root.",
      evidence: [{ label: "SOURCE", value: "HISTORICAL VIRTUAL" }, { label: "CURRENT", value: brief.executed.logicalTrades ? `${brief.executed.logicalTrades} trades` : "NO SAMPLE" }],
      confidence: confidence(brief), priority: 96, replyTo: parent.id,
    });
  }
  if (virtualTypical != null && virtualTotal != null && virtualTypical > 0 && virtualTotal < 0) {
    rows.push({
      id: stableId("dispatch", brief.channel, "typical-total-conflict"), sequence: 0, agentId: "skeptic", kind: "challenge",
      channel: brief.channel, axis: brief.recommendation.axis, headline: "TYPICAL TRADE AND TOTAL DISAGREE",
      message: "Median says hero; total says blooper reel. A few large losses or too much frequency still need an explanation.",
      evidence: [{ label: "TYPICAL", value: signedMoney(virtualTypical) }, { label: "PATH SUM", value: signedMoney(virtualTotal) }],
      confidence: confidence(brief), priority: 94, replyTo: parent.id,
    });
  }
  if (executedTypical != null && virtualTypical != null && Math.sign(executedTypical) !== Math.sign(virtualTypical)) {
    rows.push({
      id: stableId("dispatch", brief.channel, "executed-virtual-conflict"), sequence: 0, agentId: "skeptic", kind: "challenge",
      channel: brief.channel, axis: brief.recommendation.axis, headline: "CURRENT TRADES AND HISTORY DISAGREE",
      message: pickVoice(brief.channel, [
        "Plot twist: current fills and old virtual paths disagree. Keep them separate and find what changed before touching a knob.",
        "The fills and the backtest are subtweeting each other. Separate the eras, then find out who changed the story.",
        "History said moon; current fills said basement. Nobody touches a knob until we find what changed.",
      ]),
      evidence: [{ label: "EXECUTED", value: signedMoney(executedTypical) }, { label: "VIRTUAL", value: signedMoney(virtualTypical) }],
      confidence: confidence(brief), priority: 98, replyTo: parent.id,
    });
  }
  if ((brief.nativeExit.outlierShare ?? 0) >= 0.35) {
    rows.push({
      id: stableId("dispatch", brief.channel, "outlier-warning"), sequence: 0, agentId: "skeptic", kind: "challenge",
      channel: brief.channel, axis: "exit", headline: "RESULT LEANS ON OUTLIERS",
      message: "One whale is wearing the whole channel as a hat. Judge the typical path before calling total profit repeatable.",
      evidence: [{ label: "OUTLIER SHARE", value: percent(brief.nativeExit.outlierShare) }, { label: "CAPTURE", value: percent(brief.nativeExit.typicalCapture) }],
      confidence: confidence(brief), priority: 90, replyTo: parent.id,
    });
  }
  return rows;
}

function supportingDispatches(brief: ChannelDecisionBrief, parent: ResearchDispatch): ResearchDispatch[] {
  const rows: ResearchDispatch[] = [];
  const block = brief.entryFrequency.leadingBlock;
  if (block && block.scored >= 5) rows.push({
    id: stableId("dispatch", brief.channel, "blocked-opportunity"), sequence: 0, agentId: "mechanic", kind: "finding",
    channel: brief.channel, axis: "entry", headline: "BLOCKED PATHS HAVE A READ",
    message: compact(`Found the traffic cone: ${block.reason.replaceAll("_", " ")} blocked ${block.opportunities} opportunities. Those paths scored ${signedMoney(block.typicalUsd)}/ct.`),
    evidence: [{ label: "BLOCKED", value: String(block.opportunities) }, { label: "SCORED", value: String(block.scored) }],
    confidence: confidence(brief), priority: 66, replyTo: parent.id,
  });
  const overlap = brief.collision.strongestOverlap;
  if (overlap && (overlap.sameOcc > 0 || overlap.accountOccupancy > 0)) rows.push({
    id: stableId("dispatch", brief.channel, "overlap"), sequence: 0, agentId: "allocator", kind: "finding",
    channel: brief.channel, axis: "size", headline: "ROSTER PLACEMENT MATTERS",
    message: compact(`Same OCC isn't a crime; unmanaged paperwork is. ${brief.collision.conclusion}`),
    evidence: [{ label: "SAME OCC", value: String(overlap.sameOcc) }, { label: "ACCOUNT", value: String(overlap.accountOccupancy) }],
    confidence: confidence(brief), priority: 64, replyTo: parent.id,
  });
  if (brief.recommendation.nextExperiment) rows.push({
    id: stableId("dispatch", brief.channel, "next-test"), sequence: 0, agentId: "designer", kind: "experiment",
    channel: brief.channel, axis: brief.recommendation.axis, headline: "CLEAN NEXT TEST",
    message: compact(`${pickVoice(brief.channel, ["Science-fair rule: one knob, one control.", "One knob—not a buffet.", "Control group says: hands off everything else."])} ${brief.recommendation.nextExperiment}`),
    evidence: [{ label: "CHANGE", value: "ONE VARIABLE" }, { label: "CONTROL", value: "KEEP NATIVE" }],
    confidence: confidence(brief), priority: Math.max(58, axisPriority(brief.recommendation.axis) - 18), replyTo: parent.id,
  });
  return rows;
}

export function buildResearchCouncil(input: {
  throughSession: string;
  generatedAt: string;
  briefs: Readonly<Record<string, ChannelDecisionBrief>>;
}): ResearchCouncilPacket {
  const channelDispatches = Object.values(input.briefs).sort((left, right) => left.channel.localeCompare(right.channel))
    .flatMap((brief) => {
      const primary = primaryDispatch(brief);
      return [primary, ...contradictionDispatches(brief, primary), ...supportingDispatches(brief, primary)];
    });
  const ranked = channelDispatches.sort((left, right) => right.priority - left.priority
    || left.channel?.localeCompare(right.channel ?? "") || left.id.localeCompare(right.id));
  const top = ranked[0] ?? null;
  const arbiter: ResearchDispatch = {
    id: stableId("dispatch", "arbiter", input.throughSession), sequence: 0, agentId: "arbiter", kind: "decision",
    channel: top?.channel ?? null, axis: top?.axis ?? null, headline: top ? `START WITH ${top.channel}` : "NO CLEAR LEAD",
    message: top ? compact(`Tonight's boss fight is ${top.channel}. ${top.agentId === "skeptic" ? "GHOST found two stories in the receipts; settle the era split before touching a knob." : `Room consensus: ${top.message}`}`) : "No channel has enough linked evidence for a defensible next action.",
    evidence: top?.evidence.slice(0, 2) ?? [{ label: "CHANNELS", value: String(Object.keys(input.briefs).length) }],
    confidence: top?.confidence ?? "checking", priority: 110, replyTo: top?.id ?? null,
  };
  const dispatches = [arbiter, ...ranked].map((row, index) => ({ ...row, sequence: index + 1 }));
  const conflicts = dispatches.filter((row) => row.kind === "challenge").length;
  const leads = new Set(dispatches.filter((row) => row.priority >= 80 && row.channel).map((row) => row.channel)).size;
  const experiments = new Set(dispatches.filter((row) => row.kind === "experiment" && row.channel).map((row) => row.channel)).size;
  return {
    schemaVersion: 1,
    councilVersion: RESEARCH_COUNCIL_VERSION,
    throughSession: input.throughSession,
    generatedAt: input.generatedAt,
    analysisMode: "deterministic_specialists",
    agents: RESEARCH_AGENTS,
    summary: {
      channelsReviewed: Object.keys(input.briefs).length,
      leads,
      conflicts,
      experiments,
      headline: top?.channel ? `${top.channel} has the strongest unresolved evidence` : "No clear research lead",
    },
    dispatches,
    productionWrites: 0,
    orderAuthority: false,
    configurationAuthority: false,
  };
}

export function renderResearchCouncilMarkdown(packet: ResearchCouncilPacket): string {
  return [
    `# SEVE research room · through ${packet.throughSession}`,
    "",
    `${packet.summary.channelsReviewed} channels reviewed · ${packet.summary.conflicts} conflicts · ${packet.summary.experiments} next tests`,
    "",
    ...packet.dispatches.slice(0, 20).map((row) => {
      const agent = packet.agents.find((item) => item.id === row.agentId);
      return `- **${agent?.callsign ?? row.agentId} · ${row.headline}**${row.channel ? ` · \`${row.channel}\`` : ""}: ${row.message}`;
    }),
    "",
    "Read-only research. Dispatches cannot change production behavior.",
    "",
  ].join("\n");
}
