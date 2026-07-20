import assert from "node:assert/strict";
import { archiveCycleMaySeal, POST_CLOSE_ARCHIVE_MIN } from "./archiveModel.js";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  PASS ${name}`);
}

test("pre-close no-op does not seal the current day", () => {
  assert.equal(archiveCycleMaySeal({ nowEtMinute: POST_CLOSE_ARCHIVE_MIN - 1, failedDays: 0 }), false);
});

test("post-close all-complete cycle seals the current day", () => {
  assert.equal(archiveCycleMaySeal({ nowEtMinute: POST_CLOSE_ARCHIVE_MIN, failedDays: 0 }), true);
});

test("post-close failed upload stays retryable", () => {
  assert.equal(archiveCycleMaySeal({ nowEtMinute: POST_CLOSE_ARCHIVE_MIN, failedDays: 1 }), false);
});

test("multiple failed days stay retryable", () => {
  assert.equal(archiveCycleMaySeal({ nowEtMinute: POST_CLOSE_ARCHIVE_MIN + 120, failedDays: 3 }), false);
});

console.log(`\narchive selftest: ${passed}/${passed} passed`);
