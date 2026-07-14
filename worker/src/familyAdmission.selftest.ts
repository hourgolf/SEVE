import { readFileSync } from "node:fs";
import {
  buildFamilyAdmissionObservations,
  familyForChannel,
  type FamilyAdmissionInput,
} from "./familyAdmissionModel.js";

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
truth("runtime contains no execution or broker-order import", !runtime.match(/from ["']\.\/execute|orderAndFill|getOrders|getPositions/));
truth("pure model contains no database, timer, or order import", !model.match(/supabase|setInterval|setTimeout|orderAndFill|executeEntry|executeExit/i));

console.log(`family-admission-selftest: ${passed}/${passed} PASS`);
