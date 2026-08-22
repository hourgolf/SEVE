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

const targetOpportunities: TrailOpportunity[] = Array.from({ length: 10 }, (_, index) => {
  const session = `2026-07-${String(index + 1).padStart(2, "0")}`;
  const peak = index < 3 ? 1.22 : index < 6 ? 1.23 : 1.24;
  return {
    logicalOpportunityId: `target-${index}`, channel: "target-22", session, configurationEra: "current",
    evidenceLayer: "executed", entryAt: `${session}T14:30:00.000Z`, entryPrice: 1, quantity: 2,
    nativeReturnPct: -30, nativeExitAt: `${session}T19:25:00.000Z`, source: "frozen_option_archive",
    quotes: [
      { at: `${session}T14:31:00.000Z`, bid: 1 },
      { at: `${session}T14:32:00.000Z`, bid: peak },
      { at: `${session}T19:25:00.000Z`, bid: .7 },
    ],
  };
});
const targetBook = buildChannelTrailFrontier({ generatedAt: book.generatedAt, throughSession: book.throughSession,
  opportunities: targetOpportunities });
const targetEra = targetBook.channels["target-22"].eras[0];
const target22 = targetEra.candidates.find((candidate) => candidate.candidateId === "TP-22")!;
assert.ok(target22, "channel-era favorable moves should produce a bespoke +22% target");
assert.equal(target22.typicalBenefitPct, 52);
assert.equal(target22.improvementFrequency, 1);
assert.equal(target22.verdict, "promising");
assert.equal(target22.stableParameterPlateau, true, "nearby path-derived targets must corroborate the setting");
assert.equal(targetEra.recommendation, "test_take_profit");
const targetPolicy = targetBook.candidates.find((candidate) => candidate.id === "TP-22")!;
assert.equal(targetPolicy.origin, "channel_adaptive");
assert.equal(targetPolicy.takeProfitPct, 22);
assert.match(targetPolicy.parameterSource, /channel-era/);
assert.ok(targetBook.candidates.some((candidate) => candidate.id === "TP-50"),
  "LOCK50/30 must remain an explicit fixed benchmark rather than depend on adaptive quantiles");

const qqqFrozen = buildChannelTrailFrontier({
  generatedAt: book.generatedAt, throughSession: book.throughSession,
  opportunities: [{ ...opportunities[0], channel: "qqq-thrust-trail-wd",
    logicalOpportunityId: "qqq-frozen", configurationEra: "qqq-current",
    quotes: [
      { at: "2026-08-01T14:31:00.000Z", bid: 1 },
      { at: "2026-08-01T14:32:00.000Z", bid: 1.14 },
      { at: "2026-08-01T19:25:00.000Z", bid: .7 },
    ] }],
});
const qqqTp13 = qqqFrozen.channels["qqq-thrust-trail-wd"].eras[0].candidates
  .find((candidate) => candidate.candidateId === "TP-13");
assert.equal(qqqTp13?.pairedOpportunities, 1,
  "the frozen QQQ TP13 experiment must emit a comparable path after an eligible fill");
assert.equal(targetBook.channels["target-22"].eras[0].candidates.some((candidate) =>
  candidate.candidateId === "TP-13"), false,
"the QQQ-only frozen target must not become a fleet-wide candidate");

const oneLot = buildChannelTrailFrontier({ generatedAt: book.generatedAt, throughSession: book.throughSession, opportunities: opportunities.slice(0, 1).map((row) => ({ ...row, channel: "one-lot", quantity: 1 })) });
const bank = oneLot.channels["one-lot"].eras[0].candidates.find((candidate) => candidate.candidateId === "BANK20-R50-K67")!;
assert.equal(bank.pairedOpportunities, 0);
assert.equal(bank.censoredOpportunities, 1);

const bankBreakeven = buildChannelTrailFrontier({
  generatedAt: book.generatedAt,
  throughSession: book.throughSession,
  opportunities: Array.from({ length: 10 }, (_, index) => {
    const session = `2026-06-${String(index + 1).padStart(2, "0")}`;
    return {
      ...opportunities[0],
      logicalOpportunityId: `bank-be-${index}`,
      channel: "bank-breakeven",
      session,
      configurationEra: "current",
      nativeReturnPct: -30,
      quantity: 2,
      entryAt: `${session}T14:30:00.000Z`,
      nativeExitAt: `${session}T19:25:00.000Z`,
      quotes: [
        { at: `${session}T14:31:00.000Z`, bid: 1 },
        { at: `${session}T14:32:00.000Z`, bid: 1.2 },
        { at: `${session}T14:33:00.000Z`, bid: 1 },
        { at: `${session}T19:25:00.000Z`, bid: .7 },
      ],
    };
  }),
});
const protectedRunner = bankBreakeven.channels["bank-breakeven"].eras[0].candidates
  .find((candidate) => candidate.candidateId === "BANK20-BE-R50-K67")!;
const unprotectedRunner = bankBreakeven.channels["bank-breakeven"].eras[0].candidates
  .find((candidate) => candidate.candidateId === "BANK20-R50-K67")!;
assert.equal(protectedRunner.typicalBenefitPct, 40,
  "banking half at +20 and handing the runner to breakeven should retain a blended +10 versus native -30");
assert.equal(unprotectedRunner.typicalBenefitPct, 25,
  "the unprotected runner may fall to the -30 pre-arm stop after the bank fills");
assert.ok(protectedRunner.typicalBenefitPct! > unprotectedRunner.typicalBenefitPct!);

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
assert.match(runner, /snapshot\.ledger/);
assert.match(runner, /minimum-analysis-quantity/);
assert.match(runner, /path-results\.json/);
assert.match(runner, /evidenceLayer: "virtual"/);
assert.match(runner, /buildRunnerHandoffFrontier/);
assert.match(runner, /runner-handoffs/);
assert.doesNotMatch(runner, /PutObjectCommand|\.from\([^\n]+\)[\s\S]{0,160}\.(?:insert|upsert|update|delete)\(/,
  "trail runner must remain SELECT\/GET only");

console.log("channel-trail-frontier-selftest: PASS");
