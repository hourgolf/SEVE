export const SENTINEL_OPERATOR_PACKET_VERSION = "sentinel-operator-packet-v1" as const;
export const DETERMINISTIC_SENTINEL_PUBLISHER_VERSION = "deterministic-sentinel-publisher-v3" as const;

export type SentinelEvidenceState =
  | "ok"
  | "partial"
  | "missing"
  | "error"
  | "stale"
  | "conflict"
  | "not_due";

export type SentinelNextAction = "hold" | "collect" | "replay" | "preregister" | "operator_review";

export interface SentinelEvidenceFact {
  state: SentinelEvidenceState;
  source: string;
  asOf: string | null;
  detail: string;
}

export interface SentinelOperatorPacketInput {
  session: string;
  forDate: string;
  generatedAt: string;
  release: SentinelEvidenceFact & { releaseId: string | null; configurationSha256: string | null };
  liveBook: SentinelEvidenceFact & {
    /** Entry-time logical trades; runner/remainder rows are counted once. */
    opened: number;
    closed: number;
    open: number;
    /** Durable position rows behind the logical cohort. Absent on legacy v1 receipts. */
    positionRows?: number;
    realizedPnl: number | null;
    manualCloses: number;
  };
  managerBook: SentinelEvidenceFact & {
    observed: number;
    terminal: number;
    censored: number;
    active: number;
  };
  darkBook: SentinelEvidenceFact & {
    rawDecisions: number;
    sourceCensors: number;
    exactContracts: number;
    exactEligible: number | null;
    exactCensored: number | null;
    exactMissing: number | null;
    independentManagerPaths: number | null;
    overlappingManagerClocksCensored: number | null;
    freezeSha256: string | null;
    exactReportSha256: string | null;
  };
  publisherProof: SentinelEvidenceFact;
}

export interface SentinelFinding {
  code: string;
  tone: "info" | "warning" | "blocker";
  title: string;
  detail: string;
  action: SentinelNextAction;
  source: string;
}

export interface SentinelOperatorPacket extends SentinelOperatorPacketInput {
  schemaVersion: 1;
  version: typeof SENTINEL_OPERATOR_PACKET_VERSION;
  overallState: SentinelEvidenceState;
  findings: SentinelFinding[];
  nextAction: SentinelNextAction;
  authority: {
    configurationChangeAuthorized: false;
    promotionAuthorized: false;
    orderActionAuthorized: false;
    llmRequired: false;
  };
}

export interface DeterministicSentinelJudge {
  verdict: "HOLD" | "QUEUE" | "WATCH";
  opportunities: string[];
  drift: string[];
  soWhat: string;
}

const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const evidenceStates = new Set<SentinelEvidenceState>(["ok", "partial", "missing", "error", "stale", "conflict", "not_due"]);
const evidenceFact = (value: unknown): value is Record<string, unknown> => record(value)
  && evidenceStates.has(value.state as SentinelEvidenceState)
  && typeof value.source === "string"
  && (value.asOf == null || typeof value.asOf === "string")
  && typeof value.detail === "string";

export function readSentinelOperatorPacket(value: unknown): SentinelOperatorPacket | null {
  if (!record(value)
      || value.schemaVersion !== 1
      || value.version !== SENTINEL_OPERATOR_PACKET_VERSION
      || typeof value.session !== "string"
      || typeof value.forDate !== "string"
      || typeof value.generatedAt !== "string"
      || typeof value.overallState !== "string"
      || !Array.isArray(value.findings)
      || typeof value.nextAction !== "string"
      || !evidenceStates.has(value.overallState as SentinelEvidenceState)
      || !evidenceFact(value.release)
      || !evidenceFact(value.liveBook)
      || !evidenceFact(value.managerBook)
      || !evidenceFact(value.darkBook)
      || !evidenceFact(value.publisherProof)
      || !record(value.authority)
      || value.authority.configurationChangeAuthorized !== false
      || value.authority.promotionAuthorized !== false
      || value.authority.orderActionAuthorized !== false
      || value.authority.llmRequired !== false) return null;
  try {
    const packet = value as unknown as SentinelOperatorPacket;
    const rederived = deriveSentinelOperatorPacket(packet);
    if (rederived.overallState !== packet.overallState || rederived.nextAction !== packet.nextAction) return null;
    return rederived;
  } catch {
    return null;
  }
}

const stateRank: Record<SentinelEvidenceState, number> = {
  ok: 0,
  not_due: 1,
  partial: 2,
  missing: 3,
  stale: 4,
  conflict: 5,
  error: 6,
};

const worst = (states: readonly SentinelEvidenceState[]): SentinelEvidenceState =>
  [...states].sort((a, b) => stateRank[b] - stateRank[a])[0] ?? "missing";

const money = (value: number | null): string => value == null
  ? "P&L unavailable"
  : `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const nonNegativeIntegerOrNull = (value: unknown): boolean => value == null
  || (Number.isInteger(value) && (value as number) >= 0);

export function deriveSentinelOperatorPacket(input: SentinelOperatorPacketInput): SentinelOperatorPacket {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.session) || !/^\d{4}-\d{2}-\d{2}$/.test(input.forDate)) {
    throw new Error("Sentinel packet session and forDate must be YYYY-MM-DD");
  }
  if (input.session >= input.forDate) throw new Error("Sentinel packet forDate must follow the evidence session");
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error("Sentinel packet generatedAt must be an ISO timestamp");
  for (const [label, values] of [
    ["liveBook", [
      input.liveBook.opened,
      input.liveBook.closed,
      input.liveBook.open,
      input.liveBook.manualCloses,
      ...(input.liveBook.positionRows == null ? [] : [input.liveBook.positionRows]),
    ]],
    ["managerBook", [input.managerBook.observed, input.managerBook.terminal, input.managerBook.censored, input.managerBook.active]],
    ["darkBook", [input.darkBook.rawDecisions, input.darkBook.sourceCensors, input.darkBook.exactContracts]],
  ] as const) {
    if (values.some((value) => !Number.isInteger(value) || value < 0)) throw new Error(`${label} counts must be non-negative integers`);
  }
  if (input.liveBook.realizedPnl != null && !Number.isFinite(input.liveBook.realizedPnl)) {
    throw new Error("liveBook realized P&L must be finite or null");
  }
  if (input.liveBook.closed + input.liveBook.open !== input.liveBook.opened) {
    throw new Error("liveBook opened count must equal closed plus open");
  }
  if (input.liveBook.positionRows != null && input.liveBook.positionRows < input.liveBook.opened) {
    throw new Error("liveBook position rows cannot be fewer than logical trades");
  }
  if (input.managerBook.terminal + input.managerBook.censored + input.managerBook.active > input.managerBook.observed) {
    throw new Error("managerBook classified counts cannot exceed observed");
  }
  const exactCounts = [input.darkBook.exactEligible, input.darkBook.exactCensored, input.darkBook.exactMissing];
  if (exactCounts.some((value) => !nonNegativeIntegerOrNull(value))
      || !nonNegativeIntegerOrNull(input.darkBook.independentManagerPaths)
      || !nonNegativeIntegerOrNull(input.darkBook.overlappingManagerClocksCensored)) {
    throw new Error("darkBook exact counts must be non-negative integers or null");
  }
  const presentExactCounts = exactCounts.filter((value): value is number => value != null);
  if (presentExactCounts.length !== 0 && presentExactCounts.length !== exactCounts.length) {
    throw new Error("darkBook exact coverage counts must be all present or all null");
  }
  if (presentExactCounts.length === exactCounts.length
      && presentExactCounts.reduce((sum, value) => sum + value, 0) !== input.darkBook.rawDecisions) {
    throw new Error("darkBook exact coverage counts must reconcile to raw decisions");
  }

  const findings: SentinelFinding[] = [];
  const required = [input.release, input.liveBook, input.managerBook, input.darkBook];
  const overallState = worst(required.map((fact) => fact.state));

  if (input.release.state !== "ok") findings.push({
    code: "release-identity",
    tone: input.release.state === "error" || input.release.state === "conflict" ? "blocker" : "warning",
    title: "Release identity needs review",
    detail: input.release.detail,
    action: "operator_review",
    source: input.release.source,
  });

  if (input.liveBook.open > 0) findings.push({
    code: "book-not-flat",
    tone: "blocker",
    title: `${input.liveBook.open} position${input.liveBook.open === 1 ? "" : "s"} remain open`,
    detail: "The session package is not final while the desk book is open.",
    action: "operator_review",
    source: input.liveBook.source,
  });
  else findings.push({
    code: "live-session",
    tone: "info",
    title: input.liveBook.positionRows == null
      ? `${input.liveBook.closed} closed position row${input.liveBook.closed === 1 ? "" : "s"} · ${money(input.liveBook.realizedPnl)}`
      : `${input.liveBook.closed} logical live trade${input.liveBook.closed === 1 ? "" : "s"} closed · ${money(input.liveBook.realizedPnl)}`,
    detail: input.liveBook.manualCloses > 0
      ? `${input.liveBook.manualCloses} operator close${input.liveBook.manualCloses === 1 ? "" : "s"} remain separately labeled.`
      : input.liveBook.positionRows != null && input.liveBook.positionRows !== input.liveBook.opened
        ? `${input.liveBook.positionRows} immutable position rows reconcile to the logical cohort; no operator close was mixed in.`
        : "No operator close was mixed into the automated outcome cohort.",
    action: "collect",
    source: input.liveBook.source,
  });

  if (input.managerBook.censored > 0 || input.managerBook.active > 0 || input.managerBook.terminal < input.managerBook.observed) findings.push({
    code: "manager-incomplete",
    tone: input.managerBook.censored > 0 ? "warning" : "info",
    title: `${input.managerBook.terminal}/${input.managerBook.observed} manager paths terminal`,
    detail: `${input.managerBook.censored} censored · ${input.managerBook.active} still active.`,
    action: "collect",
    source: input.managerBook.source,
  });
  else if (input.managerBook.observed > 0) findings.push({
    code: "manager-complete",
    tone: "info",
    title: `${input.managerBook.terminal} manager paths terminal`,
    detail: "All observed manager paths reached a terminal state without a censor.",
    action: "collect",
    source: input.managerBook.source,
  });

  if (input.darkBook.state === "not_due") findings.push({
    code: "dark-exact-not-due",
    tone: "info",
    title: `${input.darkBook.rawDecisions} dark decisions frozen across ${input.darkBook.exactContracts} contracts`,
    detail: "Exact CBBO replay is time-gated; keep the checksum-bound ledger unchanged until T+1.",
    action: "replay",
    source: input.darkBook.source,
  });
  else if ((input.darkBook.exactCensored ?? 0) > 0 || (input.darkBook.exactMissing ?? 0) > 0) findings.push({
    code: "dark-exact-partial",
    tone: "warning",
    title: `${input.darkBook.exactEligible ?? 0}/${input.darkBook.rawDecisions} raw clocks exact-eligible`,
    detail: `${input.darkBook.exactCensored ?? 0} censored · ${input.darkBook.exactMissing ?? 0} missing; no approximate substitution is allowed.`,
    action: "operator_review",
    source: input.darkBook.source,
  });
  else if (input.darkBook.state === "ok") findings.push({
    code: "dark-exact-complete",
    tone: "info",
    title: `${input.darkBook.independentManagerPaths ?? 0} independent manager paths from ${input.darkBook.exactEligible ?? 0} exact raw clocks`,
    detail: `${input.darkBook.overlappingManagerClocksCensored ?? 0} overlapping manager clocks were censored; results remain research evidence, not an arm decision.`,
    action: "collect",
    source: input.darkBook.source,
  });
  else findings.push({
    code: "dark-evidence-incomplete",
    tone: input.darkBook.state === "error" || input.darkBook.state === "conflict" ? "blocker" : "warning",
    title: "Dark evidence is incomplete",
    detail: input.darkBook.detail,
    action: "replay",
    source: input.darkBook.source,
  });

  if (input.publisherProof.state !== "ok" && input.publisherProof.state !== "not_due") findings.push({
    code: "publisher-proof",
    tone: input.publisherProof.state === "error" || input.publisherProof.state === "conflict" ? "blocker" : "warning",
    title: "Hosted publisher proof is incomplete",
    detail: input.publisherProof.detail,
    action: "operator_review",
    source: input.publisherProof.source,
  });

  const nextAction: SentinelNextAction = findings.some((finding) => finding.tone === "blocker")
    ? "operator_review"
    : findings.some((finding) => finding.action === "replay")
      ? "replay"
      : findings.some((finding) => finding.action === "operator_review")
        ? "operator_review"
        : "collect";

  return {
    ...input,
    schemaVersion: 1,
    version: SENTINEL_OPERATOR_PACKET_VERSION,
    overallState,
    findings: findings.slice(0, 8),
    nextAction,
    authority: {
      configurationChangeAuthorized: false,
      promotionAuthorized: false,
      orderActionAuthorized: false,
      llmRequired: false,
    },
  };
}

export function operatorPacketToJudge(packet: SentinelOperatorPacket): DeterministicSentinelJudge {
  const top = packet.findings.slice(0, 3);
  const opportunities = top.filter((finding) => finding.tone === "info").map((finding) => finding.title);
  const drift = top.filter((finding) => finding.tone !== "info").map((finding) => finding.title);
  const verdict: DeterministicSentinelJudge["verdict"] = packet.nextAction === "operator_review"
    ? "WATCH"
    : packet.nextAction === "replay" || packet.nextAction === "preregister"
      ? "QUEUE"
      : "HOLD";
  const soWhat = packet.nextAction === "replay"
    ? "Keep configuration fixed; run the checksum-bound exact replay when its provider gate opens."
    : packet.nextAction === "operator_review"
      ? "Resolve the evidence blocker before treating this session package as complete."
      : "Continue collecting under the sealed configuration; no immediate knob change is authorized.";
  return { verdict, opportunities, drift, soWhat };
}
