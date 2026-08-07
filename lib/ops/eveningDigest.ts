export interface EveningDigestBucket { label: string; pnl: number; trades: number }
export interface EveningDigestMover { slug: string; pnl: number }
export interface EveningDigestModel {
  session: string;
  totalPnl: number;
  trades: number;
  buckets: EveningDigestBucket[];
  movers: EveningDigestMover[];
  workerNote: string | null;
  workerAgeMinutes: number | null;
  archiveReceipt: string | null;
}

const usd = (value: number): string => `${value >= 0 ? "+$" : "−$"}${Math.abs(Math.round(value)).toLocaleString()}`;

export function buildEveningDigest(model: EveningDigestModel): { title: string; body: string } {
  const tradeLabel = `${model.trades} closed trade${model.trades === 1 ? "" : "s"}`;
  const lines = [`${tradeLabel} · desk ${usd(model.totalPnl)}`];
  if (model.buckets.length > 1) lines.push(model.buckets
    .sort((left, right) => right.pnl - left.pnl)
    .map((bucket) => `${bucket.label} ${usd(bucket.pnl)} (${bucket.trades})`).join(" · "));
  if (model.movers.length > 0) lines.push(`Largest moves: ${model.movers.slice(0, 2).map((mover) => `${mover.slug} ${usd(mover.pnl)}`).join(" · ")}`);
  else if (model.trades === 0) lines.push("No closed trades were recorded for this session.");
  if (model.workerNote) {
    const age = model.workerAgeMinutes == null ? "time unavailable" : `${model.workerAgeMinutes}m ago`;
    lines.push(`Worker last seen ${age}${model.workerAgeMinutes != null && model.workerAgeMinutes > 240 ? " · check readiness" : ""}`);
  } else lines.push("Worker receipt unavailable · this is not proof the worker is offline");
  lines.push(model.archiveReceipt ? `Data archive verified · ${model.archiveReceipt}` : "Data archive receipt pending");
  return { title: `SEVE close · ${usd(model.totalPnl)} · ${model.trades}t`, body: lines.join("\n") };
}

export const EVENING_DIGEST_READ_FAILURE = {
  title: "SEVE close report unavailable",
  body: "Close-data reads failed. No zero-trade conclusion was made. Check Operations or rerun the after-close pass.",
} as const;
