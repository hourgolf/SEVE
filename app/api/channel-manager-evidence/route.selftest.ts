import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /requireDeskOperator\(req\)/, "route must require the operator role");
assert.match(source, /pageAll<ChannelManagerRunRow>/, "manager history must use bounded pagination");
assert.match(source, /\.order\("entry_at"[\s\S]*\.order\("id"/, "manager pagination needs a total order");
assert.match(source, /terminal_return_pct/, "return evidence must be selected");
assert.match(source, /peak_return_pct/, "capture-opportunity evidence must be selected");
assert.match(source, /configuration_epoch_id/, "configuration era must be retained");
assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/, "route must remain SELECT-only");
assert.match(source, /cache-control.*private, no-store/, "operator evidence must not be publicly cached");
console.log("channel-manager-evidence-route-selftest: PASS");
