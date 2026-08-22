export interface PhenotypePathRow {
  channel: string;
  evidenceLayer: string;
  logicalOpportunityId: string;
  candidateId: string;
  session: string;
  entryAt: string;
  entryPrice: number;
  quantity: number;
  nativeReturnPct: number;
  mfePct: number | null;
  modeledPnlUsd: number | null;
  state: string;
}

export interface PhenotypeSignalRow {
  id: string;
  strategist_id: string;
  created_at: string;
  direction: string | null;
  rationale?: Record<string, unknown> | null;
}

export interface PhenotypeSnapshot {
  strategists: Array<{ id: string; slug: string }>;
  signals: PhenotypeSignalRow[];
  activeChannelSpecs?: Array<{ slug: string; quantity?: number; entryParameters?: Record<string, unknown> }>;
}

export interface PhenotypeOpportunity {
  id: string;
  channel: string;
  family: string;
  session: string;
  entryAt: string;
  entryMinute: string;
  entryPrice: number;
  direction: string;
  underlying: string;
  mfePct: number;
  nativeReturnPct: number;
  ordinal: number;
  buckets: Record<string, string>;
}

export interface Association {
  axis: string;
  bucket: string;
  read: "advantage" | "drag";
  trainingDelta: number;
  holdoutDelta: number;
  trainingPaths: number;
  holdoutPaths: number;
  trainingSessions: number;
  holdoutSessions: number;
  holdoutConsistency: number;
  evidenceLabel: "supported_inference" | "research_hypothesis_cross_era";
}

const number = (value: unknown): number | null => {
  const parsed = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const median = (values: number[]): number => {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

const band = (value: number | null, cuts: number[], labels: string[]): string => {
  if (value == null) return "unknown";
  const index = cuts.findIndex((cut) => value < cut);
  return labels[index < 0 ? labels.length - 1 : index];
};

const signed = (value: number | null, direction: string): number | null => {
  if (value == null) return null;
  return direction === "put" ? -value : value;
};

export function channelFamily(channel: string): string {
  const base = channel.replace(/-(?:qqq|iwm)$/, "");
  if (base.startsWith("breakout")) return "breakout";
  if (base.startsWith("grind")) return "grind";
  if (base.startsWith("momo-shape")) return "momo-shape";
  if (base.startsWith("pb-ride")) return "pb-ride";
  if (base.startsWith("orb-ustop")) return "orb-ustop";
  return base;
}

function underlyingOf(rationale: Record<string, unknown>, channel: string): string {
  const occ = String(rationale.occ ?? "");
  if (occ.startsWith("QQQ")) return "QQQ";
  if (occ.startsWith("IWM")) return "IWM";
  if (occ.startsWith("SPY")) return "SPY";
  if (channel.endsWith("-qqq")) return "QQQ";
  if (channel.endsWith("-iwm")) return "IWM";
  return "SPY";
}

function bucketsFor(signal: PhenotypeSignalRow, channel: string): Record<string, string> {
  const r = signal.rationale ?? {};
  const direction = String(signal.direction ?? "unknown").toLowerCase();
  const created = new Date(signal.created_at);
  const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(created));
  const vwapAtr = signed(number(r.dirVwapAtr) ?? number(r.vwapDist), direction);
  const momentum = signed(number(r.mom), direction);
  const macdHist = signed(number(r.macdHist), direction);
  const expiry = typeof r.expiry === "string" ? r.expiry : null;
  const dte = expiry ? Math.round((Date.parse(`${expiry}T16:00:00-04:00`) - created.getTime()) / 86_400_000) : null;
  return {
    time: etHour < 10 ? "open" : etHour < 11 ? "10-11" : etHour < 13 ? "11-13" : "afternoon",
    direction: direction === "call" || direction === "put" ? direction : "unknown",
    gap: band(Math.abs(number(r.gap) ?? 0), [0.25, 0.75], ["small", "medium", "large"]),
    vwap_distance: band(vwapAtr == null ? null : Math.abs(vwapAtr), [1, 3], ["near", "extended", "far"]),
    momentum: band(momentum, [0.25, 0.75], ["weak", "medium", "strong"]),
    macd_histogram: band(macdHist, [0, 0.15], ["against", "flat", "aligned"]),
    efficiency: band(number(r.er), [0.35, 0.6], ["low", "medium", "high"]),
    relative_volume: band(number(r.relVol), [1.2, 1.8], ["low", "normal", "high"]),
    option_delta: band(Math.abs(number(r.delta) ?? Number.NaN), [0.35, 0.6], ["low", "middle", "high"]),
    premium: band(number(r.ask), [1, 2.5], ["cheap", "middle", "expensive"]),
    opening_range_depth: band(Math.abs(number(r.orDepthAtr) ?? Number.NaN), [0.75, 2], ["shallow", "medium", "deep"]),
    whip_zone: r.whipZone === true ? "yes" : r.whipZone === false ? "no" : "unknown",
    dte: dte == null ? "unknown" : dte <= 0 ? "0dte" : "1dte+",
    underlying: underlyingOf(r, channel),
  };
}

export function buildPhenotypeOpportunities(snapshot: PhenotypeSnapshot, paths: PhenotypePathRow[]): PhenotypeOpportunity[] {
  const slugByStrategist = new Map(snapshot.strategists.map((row) => [row.id, row.slug]));
  const signalById = new Map(snapshot.signals.map((row) => [row.id, row]));
  const native = new Map<string, PhenotypePathRow>();
  for (const row of paths) {
    if (row.evidenceLayer !== "virtual" || row.state !== "scored" || row.mfePct == null || !row.logicalOpportunityId.startsWith("signal:")) continue;
    if (!native.has(row.logicalOpportunityId)) native.set(row.logicalOpportunityId, row);
  }
  const rows: PhenotypeOpportunity[] = [];
  for (const path of native.values()) {
    const signal = signalById.get(path.logicalOpportunityId.slice("signal:".length));
    if (!signal) continue;
    const channel = slugByStrategist.get(signal.strategist_id) ?? path.channel;
    if (channel !== path.channel) continue;
    const buckets = bucketsFor(signal, channel);
    rows.push({
      id: path.logicalOpportunityId,
      channel,
      family: channelFamily(channel),
      session: path.session,
      entryAt: path.entryAt,
      entryMinute: path.entryAt.slice(0, 16),
      entryPrice: path.entryPrice,
      direction: String(signal.direction ?? "unknown").toLowerCase(),
      underlying: buckets.underlying,
      mfePct: path.mfePct!,
      nativeReturnPct: path.nativeReturnPct,
      ordinal: 0,
      buckets,
    });
  }
  rows.sort((left, right) => left.channel.localeCompare(right.channel) || left.session.localeCompare(right.session)
    || left.entryAt.localeCompare(right.entryAt) || left.id.localeCompare(right.id));
  const ordinal = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.channel}|${row.session}`;
    row.ordinal = (ordinal.get(key) ?? 0) + 1;
    ordinal.set(key, row.ordinal);
    row.buckets.entry_ordinal = row.ordinal === 1 ? "first" : row.ordinal === 2 ? "second" : "third+";
  }
  return rows;
}

function sessionSplit(rows: PhenotypeOpportunity[]): { training: Set<string>; holdout: Set<string> } {
  const sessions = [...new Set(rows.map((row) => row.session))].sort();
  const holdoutCount = Math.max(2, Math.floor(sessions.length / 3));
  return { training: new Set(sessions.slice(0, -holdoutCount)), holdout: new Set(sessions.slice(-holdoutCount)) };
}

function consistency(rows: PhenotypeOpportunity[], bucket: string, axis: string, objective: (row: PhenotypeOpportunity) => number, sign: number): number {
  const sessions = [...new Set(rows.map((row) => row.session))];
  const reads = sessions.flatMap((session) => {
    const sameSession = rows.filter((row) => row.session === session);
    const inside = sameSession.filter((row) => row.buckets[axis] === bucket).map(objective);
    const outside = sameSession.filter((row) => row.buckets[axis] !== bucket && row.buckets[axis] !== "unknown").map(objective);
    return inside.length && outside.length ? [Math.sign(median(inside) - median(outside)) === sign] : [];
  });
  return reads.length ? reads.filter(Boolean).length / reads.length : 0;
}

export function supportedAssociations(
  rows: PhenotypeOpportunity[],
  objective: (row: PhenotypeOpportunity) => number,
  evidenceLabel: Association["evidenceLabel"],
): Association[] {
  if (new Set(rows.map((row) => row.session)).size < 6) return [];
  const { training, holdout } = sessionSplit(rows);
  const axes = Object.keys(rows[0]?.buckets ?? {}).filter((axis) => axis !== "underlying");
  const result: Association[] = [];
  for (const axis of axes) {
    const buckets = [...new Set(rows.map((row) => row.buckets[axis]))].filter((bucket) => bucket !== "unknown");
    const candidates = buckets.flatMap((bucket) => {
      const trainIn = rows.filter((row) => training.has(row.session) && row.buckets[axis] === bucket);
      const trainOut = rows.filter((row) => training.has(row.session) && row.buckets[axis] !== bucket && row.buckets[axis] !== "unknown");
      const holdIn = rows.filter((row) => holdout.has(row.session) && row.buckets[axis] === bucket);
      const holdOut = rows.filter((row) => holdout.has(row.session) && row.buckets[axis] !== bucket && row.buckets[axis] !== "unknown");
      if (trainIn.length < 12 || trainOut.length < 12 || holdIn.length < 6 || holdOut.length < 6
        || new Set(trainIn.map((row) => row.session)).size < 5 || new Set(holdIn.map((row) => row.session)).size < 3) return [];
      const trainingDelta = median(trainIn.map(objective)) - median(trainOut.map(objective));
      const holdoutDelta = median(holdIn.map(objective)) - median(holdOut.map(objective));
      return [{ bucket, trainingDelta, holdoutDelta, trainIn, holdIn }];
    });
    for (const sign of [1, -1]) {
      const selected = candidates.filter((row) => Math.sign(row.trainingDelta) === sign)
        .sort((left, right) => Math.abs(right.trainingDelta) - Math.abs(left.trainingDelta))[0];
      if (!selected || Math.abs(selected.trainingDelta) < 8 || Math.sign(selected.holdoutDelta) !== sign
        || Math.abs(selected.holdoutDelta) < 8) continue;
      const holdoutRows = rows.filter((row) => holdout.has(row.session));
      const stable = consistency(holdoutRows, selected.bucket, axis, objective, sign);
      if (stable < 0.5) continue;
      result.push({
        axis,
        bucket: selected.bucket,
        read: sign > 0 ? "advantage" : "drag",
        trainingDelta: Math.round(selected.trainingDelta * 10) / 10,
        holdoutDelta: Math.round(selected.holdoutDelta * 10) / 10,
        trainingPaths: selected.trainIn.length,
        holdoutPaths: selected.holdIn.length,
        trainingSessions: new Set(selected.trainIn.map((row) => row.session)).size,
        holdoutSessions: new Set(selected.holdIn.map((row) => row.session)).size,
        holdoutConsistency: Math.round(stable * 100) / 100,
        evidenceLabel,
      });
    }
  }
  return result;
}

export function pathDisposition(row: PhenotypeOpportunity): "never_worked" | "small_move" | "available_but_lost" | "profit_leaked" | "profit_retained" {
  if (row.mfePct < 5) return "never_worked";
  if (row.mfePct < 15) return "small_move";
  if (row.nativeReturnPct <= 0) return "available_but_lost";
  return row.nativeReturnPct / row.mfePct >= 0.6 ? "profit_retained" : "profit_leaked";
}

export function conversionScore(row: PhenotypeOpportunity): number {
  if (row.mfePct < 15) return 0;
  return Math.max(-100, Math.min(100, 100 * row.nativeReturnPct / row.mfePct));
}
