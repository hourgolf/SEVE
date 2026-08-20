import type { AtlasInput, AtlasOpportunity, DecisionAtlas } from "./decisionAtlas";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import type { EntryAtlasInput, EntryAtlasObservation, EntryFeature } from "./entryAtlas";

const finite = (value: unknown): number | null => {
  const parsed = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;

function value(source: Record<string, unknown>, aliases: readonly string[]): number | null {
  const scopes = [source, object(source.features), object(source.entry_features), object(source.market)].filter(Boolean) as Record<string, unknown>[];
  for (const scope of scopes) for (const alias of aliases) {
    const found = finite(scope[alias]);
    if (found != null) return found;
  }
  return null;
}
function directionSign(row: AtlasOpportunity): number {
  if (row.direction === "call") return 1;
  if (row.direction === "put") return -1;
  if (row.occSymbol?.includes("C")) return 1;
  if (row.occSymbol?.includes("P")) return -1;
  return 0;
}

export function extractEntryFeatures(row: AtlasOpportunity, source: Record<string, unknown>): Partial<Record<EntryFeature, number>> {
  const result: Partial<Record<EntryFeature, number>> = {};
  const set = (key: EntryFeature, number: number | null): void => { if (number != null) result[key] = number; };
  const atr = value(source, ["atr"]);
  const spot = value(source, ["spotClose", "close", "underlyingPrice", "underlying_price"]);
  const sign = directionSign(row);
  const vwapDirect = value(source, ["dirVwapAtr", "directionalVwapAtr"]);
  const vwapDistance = value(source, ["vwapDist", "vwap_distance"]);
  const momentumDirect = value(source, ["dirMomAtr", "directionalMomentumAtr"]);
  const momentum = value(source, ["mom", "momentum"]);
  const histogramDirect = value(source, ["histRel", "histogramAlignment"]);
  const histogram = value(source, ["macdHist", "macd_histogram"]);
  const expectedMove = value(source, ["expectedMove", "expected_move"]);
  const roundTrip = value(source, ["roundTrip", "round_trip"]);
  set("efficiencyRatio", value(source, ["er", "efficiencyRatio"]));
  set("relativeVolume", value(source, ["relVol", "relativeVolume"]));
  const gap = value(source, ["gap", "gapPct", "gap_pct"]); set("absoluteGapPct", gap == null ? null : Math.abs(gap));
  set("atrPct", value(source, ["atrPct", "atr_pct"]) ?? (atr != null && spot != null && spot > 0 ? atr / spot * 100 : null));
  set("directionalVwapAtr", vwapDirect ?? (vwapDistance != null && atr != null && atr > 0 && sign ? sign * vwapDistance / atr : null));
  set("directionalMomentumAtr", momentumDirect ?? (momentum != null && atr != null && atr > 0 && sign ? sign * momentum / atr : null));
  set("histogramAlignment", histogramDirect ?? (histogram != null && sign ? sign * histogram : null));
  set("openingRangeDepthAtr", value(source, ["orDepthAtr", "openingRangeDepthAtr"]));
  const delta = value(source, ["delta", "entryDelta", "entry_delta"]); set("absoluteDelta", delta == null ? null : Math.abs(delta));
  set("costMargin", value(source, ["evMargin", "costMargin"]) ?? (expectedMove != null && roundTrip != null && roundTrip > 0 ? expectedMove / roundTrip : null));
  return result;
}

function sourceForOpportunity(snapshot: DecisionAtlasSourceSnapshot, row: AtlasOpportunity): Record<string, unknown> {
  const tradeRef = row.sourceRefs.find((ref) => ref.startsWith("profitability-ledger:"));
  if (tradeRef) {
    const tradeId = tradeRef.slice("profitability-ledger:".length);
    const trade = snapshot.ledger.logicalTrades.find((item) => item.id === tradeId);
    const root = trade ? snapshot.positions?.find((position) => position.id === trade.rootPositionId) : null;
    if (root?.entry_features) return root.entry_features;
  }
  const signalRef = row.sourceRefs.find((ref) => ref.startsWith("signals:"));
  if (signalRef) {
    const signal = snapshot.signals.find((item) => item.id === signalRef.slice("signals:".length));
    if (signal?.rationale) return signal.rationale;
  }
  return {};
}

export function adaptEntryAtlasSnapshot(input: {
  snapshot: DecisionAtlasSourceSnapshot;
  normalized: AtlasInput;
  atlas: DecisionAtlas;
}): EntryAtlasInput {
  const managerByOpportunity = new Map<string, number[]>();
  for (const path of input.normalized.managerPaths) if (path.status === "terminal" && path.resultPerContractUsd != null) {
    managerByOpportunity.set(path.opportunityId, [...(managerByOpportunity.get(path.opportunityId) ?? []), path.resultPerContractUsd]);
  }
  const observations: EntryAtlasObservation[] = input.normalized.opportunities.map((row) => ({
    logicalOpportunityId: row.logicalOpportunityId,
    id: row.id,
    channel: row.channel,
    session: row.session,
    signalAt: row.signalAt,
    evidenceLayer: row.evidenceLayer,
    configurationEra: row.configurationEra ?? "legacy / unstamped",
    features: extractEntryFeatures(row, sourceForOpportunity(input.snapshot, row)),
    mfePct: row.mfePct,
    maePct: row.maePct,
    terminalManagerResultsUsd: managerByOpportunity.get(row.logicalOpportunityId) ?? [],
    sourceRefs: row.sourceRefs,
  }));
  return {
    generatedAt: input.atlas.generatedAt,
    throughSession: input.atlas.throughSession,
    observations,
    selectedCohorts: Object.fromEntries(Object.values(input.atlas.channels).map((dossier) => [dossier.channel, {
      evidenceLayer: dossier.decisionCohort.evidenceLayer,
      configurationEra: dossier.decisionCohort.configurationEra,
    }])),
  };
}
