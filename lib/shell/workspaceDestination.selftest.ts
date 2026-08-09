import assert from "node:assert/strict";
import { axisForDisposition, parseWorkspaceDestination, workspaceDestinationUrl } from "./workspaceDestination";

const parsed = parseWorkspaceDestination("?view=research&channel=orb-ustop-ctl&axis=exit&session=2026-08-07&filter=review");
assert.deepEqual(parsed, {
  section: "research",
  channel: "orb-ustop-ctl",
  session: "2026-08-07",
  axis: "exit",
  researchFilter: "review",
  researchMode: undefined,
  reviewSection: undefined,
  occ: undefined,
  check: undefined,
});
assert.equal(workspaceDestinationUrl({ section: "studio", channel: "pb-ride" }, "https://example.test/?incident=high&view=ops#skin=cream"), "/?incident=high&view=studio&channel=pb-ride#skin=cream");
assert.equal(parseWorkspaceDestination("?view=unknown&axis=magic").section, "overview");
assert.equal(parseWorkspaceDestination("?view=unknown&axis=magic").axis, undefined);
assert.equal(axisForDisposition("Review exit"), "exit");
assert.equal(axisForDisposition("Test capacity"), "size");
assert.equal(axisForDisposition("Continue collecting"), "sources");

console.log("workspace destination selftest passed");
