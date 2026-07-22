import { readFileSync } from "node:fs";
import {
  buildFamilyAdmissionObservations,
  familyForChannel,
  type FamilyAdmissionInput,
} from "./familyAdmissionModel.js";
import {
  DAY1_RELEASE_CONFIGURATION_SHA256,
  DAY1_RELEASE_ID,
  prepareDay1ReleaseAdmission,
} from "./day1ReleasePolicy.js";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  passed++;
}
function truth(name: string, value: unknown): void { check(name, !!value, true); }

const at = Date.parse("2026-07-14T16:16:00.000Z");
const observed = at + 2_000;
const accountId = "11111111-1111-4111-8111-111111111111";
const configurationSha256 = "a".repeat(64);
const input = (slug: string, strategistId: string, occ: string, qty = 4, blocked: string | null = null): FamilyAdmissionInput => ({
  channel: { id: strategistId, slug, underlying: "SPY" },
  accountId,
  sourceBarAtMs: at,
  observedAtMs: observed,
  decision: {
    slug, status: "armed", action: "enter", reason: "test_signal", blocked,
    occ, direction: "put", qty, detail: { ask: 1.25 },
  },
});
const day1Input = (
  slug: string,
  strategistId: string,
  occ: string,
  lifecycle: "paper" | "dark",
  blocked: string | null,
  originalBlockedReason: string | null = null,
): FamilyAdmissionInput => {
  const base = input(slug, strategistId, occ, lifecycle === "paper" ? 2 : 4, blocked);
  return {
    ...base,
    decision: {
      ...base.decision,
      detail: {
        ...base.decision.detail,
        day1Candidate: {
          releaseId: "weekend-day1-test",
          configurationSha256,
          candidateStampedBeforeAdmission: true,
          accountId,
          strategistId,
          channelSlug: slug,
          lifecycle,
          familyId: lifecycle === "paper" ? (slug.startsWith("pb-") ? "SPY-PB" : "SPY-ORB") : null,
          sourceBarAt: new Date(at).toISOString(),
          observedAt: new Date(observed).toISOString(),
          originalBlockedReason,
          originalRequestedQty: lifecycle === "paper" ? 12 : 4,
          occSymbol: occ,
          executableAsk: 1.25,
        },
      },
    },
  };
};

check("PB roster is explicit", [familyForChannel("pb-ride"), familyForChannel("pb-ride-2"), familyForChannel("pb-ride-itm")], ["PB", "PB", "PB"]);
check("SPY ORB roster is explicit", [familyForChannel("orb-trend-rider"), familyForChannel("orb-ustop"), familyForChannel("orb-ustop-ctl")], ["ORB-SPY", "ORB-SPY", "ORB-SPY"]);
check("QQQ trail is not silently pooled with SPY ORB", familyForChannel("orb-qqq-trail"), null);

const pbInputs = [
  input("pb-ride", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000", 4),
  input("pb-ride-2", "33333333-3333-4333-8333-333333333333", "SPY260714P00600000", 6),
  input("pb-ride-itm", "44444444-4444-4444-8444-444444444444", "SPY260714P00599000", 5),
] as const;
const pb = buildFamilyAdmissionObservations(pbInputs);
check("three correlated PB candidates make one collision", [pb.length, pb[0]?.candidate_count, pb[0]?.requested_qty], [1, 3, 15]);
check("observer emits one arm per possible survivor", pb[0]?.admission_arms.map((arm) => [arm.keepOpportunityId, arm.rejectOpportunityIds.length]), pb[0]?.candidates.map((candidate) => [candidate.opportunityId, 2]));
truth("candidate ordering is deterministic", pb[0]!.candidates.every((row, index, rows) => index === 0 || rows[index - 1]!.channelSlug.localeCompare(row.channelSlug) <= 0));
check("same evidence has retry-stable identity", buildFamilyAdmissionObservations([...pbInputs].reverse())[0]?.id, pb[0]?.id);
check("one candidate is not a collision", buildFamilyAdmissionObservations([input("pb-ride", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000")]).length, 0);
check("blocked sibling is not an admissible candidate", buildFamilyAdmissionObservations([
  input("orb-trend-rider", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000"),
  input("orb-ustop", "33333333-3333-4333-8333-333333333333", "SPY260714P00600000", 4, "muted"),
]).length, 0);
const day1 = buildFamilyAdmissionObservations([
  day1Input("pb-ride", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000", "paper", null),
  day1Input("pb-ride-2", "33333333-3333-4333-8333-333333333333", "SPY260714P00600000", "dark", "day1_dark_lifecycle"),
  day1Input("pb-ride-itm", "44444444-4444-4444-8444-444444444444", "SPY260714P00599000", "dark", "day1_dark_lifecycle"),
]);
check("Day 1 root and clean dark siblings form one research collision", [day1.length, day1[0]?.candidate_count], [1, 3]);
check("Day 1 posture remains explicit", day1[0]?.candidates.map((row) => [row.channelSlug, row.posture, row.releaseBlockedReason]), [
  ["pb-ride", "day1-paper-root", null],
  ["pb-ride-2", "day1-dark-candidate", "day1_dark_lifecycle"],
  ["pb-ride-itm", "day1-dark-candidate", "day1_dark_lifecycle"],
]);
check("root quantity and pre-overlay quantity are both retained", [
  day1[0]?.candidates.find((row) => row.channelSlug === "pb-ride")?.requestedQty,
  day1[0]?.candidates.find((row) => row.channelSlug === "pb-ride")?.originalRequestedQty,
], [2, 12]);
check("an originally blocked dark decision is excluded", buildFamilyAdmissionObservations([
  day1Input("orb-ustop-ctl", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000", "paper", null),
  day1Input("orb-ustop", "33333333-3333-4333-8333-333333333333", "SPY260714P00600000", "dark", "day1_dark_lifecycle", "halted"),
]).length, 0);
check("a post-preparation capacity block is not mistaken for a candidate", buildFamilyAdmissionObservations([
  day1Input("orb-ustop-ctl", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000", "paper", "day1_family_open"),
  day1Input("orb-ustop", "33333333-3333-4333-8333-333333333333", "SPY260714P00600000", "dark", "day1_dark_lifecycle"),
]).length, 0);
check("a dark block without a valid Day 1 stamp remains excluded", buildFamilyAdmissionObservations([
  day1Input("orb-ustop-ctl", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000", "paper", null),
  input("orb-ustop", "33333333-3333-4333-8333-333333333333", "SPY260714P00600000", 4, "day1_dark_lifecycle"),
]).length, 0);
check("invalid observation clocks fail closed without throwing", buildFamilyAdmissionObservations([
  { ...day1Input("pb-ride", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000", "paper", null), observedAtMs: Number.NaN },
  day1Input("pb-ride-2", "33333333-3333-4333-8333-333333333333", "SPY260714P00600000", "dark", "day1_dark_lifecycle"),
]).length, 0);
const preparedChannels = [
  { id: "22222222-2222-4222-8222-222222222222", slug: "pb-ride", underlying: "SPY" },
  { id: "33333333-3333-4333-8333-333333333333", slug: "pb-ride-2", underlying: "SPY" },
];
const preparedDecisions = prepareDay1ReleaseAdmission({
  channels: preparedChannels,
  decisions: [
    input("pb-ride", preparedChannels[0].id, "SPY260714P00600000", 12).decision,
    input("pb-ride-2", preparedChannels[1].id, "SPY260714P00600000", 4).decision,
  ],
  accountId,
  sourceBarAtMs: at,
  observedAtMs: observed,
  currentEtMinute: 700,
  sessionCloseEtMinute: 960,
  sessionLedgerReady: true,
});
const integrated = buildFamilyAdmissionObservations(preparedDecisions.map((decision, index) => ({
  channel: preparedChannels[index], accountId, decision, sourceBarAtMs: at, observedAtMs: observed,
})));
check("real Day 1 preparation emits the v2 root-dark group", [
  integrated.length,
  integrated[0]?.policy_version,
  integrated[0]?.candidates.map((row) => row.posture),
  integrated[0]?.candidates.every((row) => row.releaseId === DAY1_RELEASE_ID
    && row.configurationSha256 === DAY1_RELEASE_CONFIGURATION_SHA256),
], [1, "family-admission-observer-v2", ["day1-paper-root", "day1-dark-candidate"], true]);
check("different direction is a different family bet", buildFamilyAdmissionObservations([
  input("pb-ride", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000"),
  { ...input("pb-ride-2", "33333333-3333-4333-8333-333333333333", "SPY260714C00600000"), decision: { ...input("pb-ride-2", "33333333-3333-4333-8333-333333333333", "SPY260714C00600000").decision, direction: "call" } },
]).length, 0);
check("duplicate opportunity is deduplicated", buildFamilyAdmissionObservations([
  input("pb-ride", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000"),
  input("pb-ride", "22222222-2222-4222-8222-222222222222", "SPY260714P00600000"),
]).length, 0);

const runtime = readFileSync(new URL("./familyAdmission.ts", import.meta.url), "utf8");
const model = readFileSync(new URL("./familyAdmissionModel.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
truth("runtime contains no execution or broker-order import", !runtime.match(/from ["']\.\/execute|orderAndFill|getOrders|getPositions/));
truth("pure model contains no database, timer, or order import", !model.match(/supabase|setInterval|setTimeout|orderAndFill|executeEntry|executeExit/i));
truth("Day 1 family tap precedes global arbitration", index.indexOf("Research tap: capture the per-candidate Day 1 decisions")
  < index.indexOf("finalizeDay1ReleaseAdmissions({"));
check("release path has exactly one family-observer input tap", index.match(/familyAdmissionInputs\.push/g)?.length, 2);

console.log(`family-admission-selftest: ${passed}/${passed} PASS`);
