import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildChannelTrailFrontier, type TrailOpportunity } from "./channelTrailFrontier";

const quotePath = (session: string) => [
  { at: `${session}T14:31:00.000Z`, bid: 1 },
  { at: `${session}T14:32:00.000Z`, bid: 1.25 },
  { at: `${session}T14:33:00.000Z`, bid: 1.8 },
  { at: `${session}T14:34:00.000Z`, bid: 1.45 },
  { at: `${session}T19:25:00.000Z`, bid: 1.05 },
];
const opportunities: TrailOpportunity[] = Array.from({ length: 10 }, (_, index) => {
  const session = `2026-08-${String(index + 1).padStart(2, "0")}`;
  return {
    logicalOpportunityId: `trade-${index}`, channel: "gives-back", session, configurationEra: "current",
    evidenceLayer: "executed",
    entryAt: `${session}T14:30:00.000Z`, entryPrice: 1, quantity: 2, nativeReturnPct: 5,
    nativeExitAt: `${session}T19:25:00.000Z`, quotes: quotePath(session), source: "frozen_option_archive",
  };
});
opportunities.push({ ...opportunities[0], logicalOpportunityId: "legacy", configurationEra: "legacy", nativeReturnPct: 70 });

const currentSpec = "11111111-1111-4111-8111-111111111111";
opportunities.forEach((row) => { if (row.configurationEra === "current") row.configurationEra = `epoch:${currentSpec}:receipt:sha256:current`; });
const book = buildChannelTrailFrontier({ generatedAt: "2026-08-10T20:15:00.000Z", throughSession: "2026-08-10", opportunities, currentConfigurationEras: { "gives-back": `channel-spec:${currentSpec}` } });
const channel = book.channels["gives-back"];
assert.equal(channel.eras.length, 2, "configuration eras must never pool");
assert.equal(channel.selectedConfigurationEra, `epoch:${currentSpec}:receipt:sha256:current`);
const current = channel.eras.find((era) => era.configurationEra === channel.selectedConfigurationEra)!;
assert.equal(current.opportunities, 10);
assert.equal(current.sessions, 10);
assert.match(current.recommendation, /^test_/);
const a13 = current.candidates.find((candidate) => candidate.candidateId === "FULL-R50-K67")!;
assert.equal(a13.pairedOpportunities, 10);
assert.equal(a13.typicalBenefitPct, 40, "the +45 observed ratchet exit is paired against native +5");
assert.equal(a13.improvementFrequency, 1);
assert.equal(a13.chronologicalStable, true);
assert.equal(a13.leaveSessionOutStable, true);
assert.equal(a13.verdict, "promising");
assert.equal(a13.stableParameterPlateau, true);
assert.equal(a13.convexTailOpportunities, 0);

const oneLot = buildChannelTrailFrontier({ generatedAt: book.generatedAt, throughSession: book.throughSession, opportunities: opportunities.slice(0, 1).map((row) => ({ ...row, channel: "one-lot", quantity: 1 })) });
const bank = oneLot.channels["one-lot"].eras[0].candidates.find((candidate) => candidate.candidateId === "BANK20-R50-K67")!;
assert.equal(bank.pairedOpportunities, 0);
assert.equal(bank.censoredOpportunities, 1);

const virtual = buildChannelTrailFrontier({
  generatedAt: book.generatedAt,
  throughSession: book.throughSession,
  opportunities: [{ ...opportunities[0], channel: "dark", logicalOpportunityId: "virtual-1",
    evidenceLayer: "virtual", configurationEra: "prospective-policy:one" }],
  currentVirtualConfigurationEras: { dark: "prospective-policy:one" },
});
assert.equal(virtual.channels.dark.eras.length, 0);
assert.equal(virtual.channels.dark.virtualEras.length, 1);
assert.equal(virtual.channels.dark.selectedConfigurationEra, null);
assert.equal(virtual.channels.dark.selectedVirtualConfigurationEra, "prospective-policy:one");
assert.equal(virtual.executedSourceOpportunities, 0);
assert.equal(virtual.virtualSourceOpportunities, 1);

const repeated = buildChannelTrailFrontier({ generatedAt: book.generatedAt, throughSession: book.throughSession, opportunities, currentConfigurationEras: { "gives-back": `channel-spec:${currentSpec}` } });
assert.deepEqual(repeated, book, "the frontier must be byte-stable for identical frozen inputs");
assert.equal(book.productionWrites, 0);
assert.equal(book.orderAuthority, false);
assert.equal(book.configurationAuthority, false);

const runner = readFileSync(new URL("../../scripts/channel-trail-frontier.ts", import.meta.url), "utf8");
assert.match(runner, /quote_archive_receipts/);
assert.match(runner, /GetObjectCommand/);
assert.match(runner, /compressed_sha256/);
assert.match(runner, /manifest_sha256/);
assert.match(runner, /snapshot-file/);
assert.match(runner, /evidenceLayer: "virtual"/);
assert.doesNotMatch(runner, /PutObjectCommand|\.from\([^\n]+\)[\s\S]{0,160}\.(?:insert|upsert|update|delete)\(/,
  "trail runner must remain SELECT\/GET only");

console.log("channel-trail-frontier-selftest: PASS");
