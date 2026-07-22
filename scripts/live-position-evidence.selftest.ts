import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./live-position-evidence.ts", import.meta.url), "utf8");
let passed = 0;
const truth = (name: string, value: boolean): void => {
  assert.equal(value, true, name);
  passed += 1;
};

truth("starts from bounded open positions", source.includes('.eq("status", "open").order("opened_at", { ascending: true }).limit(24)'));
truth("follows indexed position outcome lineage", source.includes('.eq("position_id", position.id)'));
truth("follows immutable opportunity join", source.includes('.eq("opportunity_id", opportunityId)'));
truth("manager reads are position bounded", source.includes('from("manager_shadow_runs")') && source.includes('.limit(12)'));
truth("capture reads are position bounded", source.includes('from("held_contract_capture_receipts")') && source.includes('.limit(3)'));
truth("contains no database mutation", !source.match(/\.(insert|update|upsert|delete)\s*\(/));
truth("contains no broker or order import", !source.match(/alpaca|orderAndFill|placeFill|getOrders|getPositions/));
truth("contains no R2 client", !source.match(/S3Client|PutObject|R2_/));

console.log(`live-position-evidence-selftest: ${passed}/${passed} PASS`);
