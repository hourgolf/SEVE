import assert from "node:assert/strict";
import { buildEntryAtlas, type EntryAtlasObservation } from "./entryAtlas";
import { extractEntryFeatures } from "./entryAtlasAdapter";
import type { AtlasOpportunity } from "./decisionAtlas";

const rows: EntryAtlasObservation[] = Array.from({ length: 12 }, (_, index) => ({
  logicalOpportunityId: `op-${index}`,
  id: `row-${index}`,
  channel: "test-channel",
  session: `2026-08-${String(1 + Math.floor(index / 2)).padStart(2, "0")}`,
  signalAt: `2026-08-${String(1 + Math.floor(index / 2)).padStart(2, "0")}T${index % 2 ? "15:00" : "14:45"}:00.000Z`,
  evidenceLayer: "exact_current_configuration",
  configurationEra: "current",
  features: { relativeVolume: index % 2 ? 2 : 1 },
  mfePct: index % 2 ? 24 : 4,
  maePct: index % 2 ? -5 : -14,
  terminalManagerResultsUsd: index % 2 ? [20, 5] : [-10, -4],
  sourceRefs: [`test:${index}`],
}));
const atlas = buildEntryAtlas({ generatedAt: "2026-08-20T20:15:00.000Z", throughSession: "2026-08-20", observations: rows,
  selectedCohorts: { "test-channel": { evidenceLayer: "exact_current_configuration", configurationEra: "current" } } });
const channel = atlas.channels["test-channel"];
assert.equal(channel.cohort.opportunities, 12);
assert.equal(channel.cohort.sessions, 6);
assert.equal(channel.metrics.typicalBestMovePct, 14);
assert.equal(channel.metrics.favorableMoveRate, .5);
assert.equal(channel.relationships.find((row) => row.feature === "relativeVolume")?.state, "stable_hypothesis");
assert.match(channel.nextTest, /keep exit, manager, and size fixed/i);
assert.equal(atlas.productionWrites, 0);
assert.equal(atlas.orderAuthority, false);
assert.equal(atlas.configurationAuthority, false);
assert.equal(atlas.managerAuthority, false);
assert.equal(atlas.sizingAuthority, false);
assert.equal(atlas.rosterAuthority, false);
assert.equal(atlas.scheduleAuthority, false);

const duplicate = buildEntryAtlas({ generatedAt: atlas.generatedAt, throughSession: atlas.throughSession,
  observations: [...rows, { ...rows[0], id: "duplicate" }] });
assert.equal(duplicate.evidence.duplicateRowsRemoved, 1);

const opportunity: AtlasOpportunity = {
  logicalOpportunityId: "feature-op", id: "feature-row", channel: "feature-channel", session: "2026-08-20",
  signalAt: "2026-08-20T14:45:00.000Z", exitAt: null, configurationEra: "current",
  portfolioConfigurationEra: "portfolio", managerVersion: null, evidenceLayer: "prospective_virtual",
  accountId: null, underlying: "SPY", occSymbol: null, direction: "put", contractSelected: true,
  quoteEligible: true, admissionAllowed: true, filled: false, blockedReason: null, quantity: 1,
  entryPrice: 1, resultPerContractUsd: null, returnPct: null, mfePct: null, maePct: null,
  captureRatio: null, stopExposurePerContractUsd: null, sourceRefs: [],
};
const features = extractEntryFeatures(opportunity, { er: .4, relVol: 1.8, gap: -.3, atr: 2, spotClose: 400,
  vwapDist: 1, mom: -.5, macdHist: -.2, expectedMove: 10, roundTrip: 2, delta: -.45 });
assert.equal(features.absoluteGapPct, .3);
assert.equal(features.atrPct, .5);
assert.equal(features.directionalVwapAtr, -.5);
assert.equal(features.directionalMomentumAtr, .25);
assert.equal(features.histogramAlignment, .2);
assert.equal(features.absoluteDelta, .45);
assert.equal(features.costMargin, 5);
console.log("entry-atlas-selftest: PASS");
