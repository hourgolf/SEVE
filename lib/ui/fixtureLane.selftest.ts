import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIXTURE_SCENARIOS, fixtureLaneAvailable } from "./fixtureLane";

assert.equal(fixtureLaneAvailable("production"), false);
assert.equal(fixtureLaneAvailable("preview"), true);
assert.equal(fixtureLaneAvailable("development"), true);
assert.equal(Object.keys(FIXTURE_SCENARIOS).length, 3);
assert.equal(FIXTURE_SCENARIOS.managed.positions.length, 2);

const seam = [
  readFileSync("app/fixture-lab/page.tsx", "utf8"),
  readFileSync("components/fixtures/MarketHoursFixtureLab.tsx", "utf8"),
  readFileSync("lib/ui/fixtureLane.ts", "utf8"),
].join("\n");
for (const banned of ["@/app/page", "@/hooks/", "supabase", "alpaca", "useMarketData", "useDeskFeed", "useDeskWrite"]) {
  assert.equal(seam.toLowerCase().includes(banned.toLowerCase()), false, `fixture lane imports forbidden live seam: ${banned}`);
}

console.log("fixture-lane-selftest: 12/12 passed");
