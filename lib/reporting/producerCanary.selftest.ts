import assert from "node:assert/strict";
import { assessReportingProducerCanary } from "./producerCanary";

const evidence = { producerVersion: "seve-reporting-v3", schemaVersion: 3, unit: "logical_trade",
  layer: "historical_executed", scope: "all_configured_paper_accounts", moneyUnit: "whole_position_usd_gross",
  sessionTimezone: "America/New_York" };
const daily = { report_date: "2026-09-21", mode: "paper", digest: { date: "2026-09-21", mode: "paper", evidence, fund: { trades: 2 }, channels: [] } };
const pass = assessReportingProducerCanary({ kind: "daily", targetDate: "2026-09-21", row: daily,
  publicationVersions: [{ report_kind: "daily", report_date: "2026-09-21", archived_at: "2026-09-21T21:10:00Z", payload: daily }] });
assert.equal(pass.state, "pass");
assert.equal(pass.productionWrites, 0);

const pending = assessReportingProducerCanary({ kind: "daily", targetDate: "2026-09-21", row: null, publicationVersions: [] });
assert.equal(pending.state, "pending");

const weekly = { week_end: "2026-09-25", mode: "paper", digest: { weekEnd: "2026-09-25", mode: "paper",
  evidence: { ...evidence, requestedThrough: "2026-09-25", sourceDailyReports: ["2026-09-21"] }, fund: { trades: 4 }, channels: [] } };
assert.equal(assessReportingProducerCanary({ kind: "weekly", targetDate: "2026-09-25", row: weekly,
  publicationVersions: [{ report_kind: "weekly", report_date: "2026-09-25", archived_at: "2026-09-25T21:15:00Z", payload: weekly }] }).state, "pass");

const malformed = structuredClone(daily);
(malformed.digest.evidence as Record<string, unknown>).unit = "position_row";
const failed = assessReportingProducerCanary({ kind: "daily", targetDate: "2026-09-21", row: malformed,
  publicationVersions: [{ report_kind: "daily", report_date: "2026-09-21", archived_at: "2026-09-21T21:10:00Z", payload: daily }] });
assert.equal(failed.state, "fail");
assert.ok(failed.blockers.some((blocker) => blocker.startsWith("unit:")));
assert.ok(failed.blockers.some((blocker) => blocker.startsWith("publication-payload:")));

console.log("reporting-producer-canary-selftest: PASS");
