import assert from "node:assert/strict";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import { buildExecutionResilienceReport } from "./executionResilience";

const decision = { id: "d", trace_id: "t", event_kind: "decision", event_at: "2026-08-07T14:00:00Z",
  strategist_id: "s", account_id: "a", channel_slug: "alpha", opportunity_id: "opp:1", position_id: null,
  action: "enter", reason: "signal", blocked_reason: null, underlying: "SPY", occ_symbol: "SPY-OCC",
  option_side: "call", bid: 1, ask: 1.1, requested_qty: 2, broker_status: null, filled_qty: null,
  fill_price: null, payload: {}, configuration_epoch_id: "epoch", client_order_id: null } as const;
const broker = { ...decision, id: "b", event_kind: "broker_result", broker_status: "filled", filled_qty: 1,
  fill_price: 1.1, client_order_id: "alpha-SPY-OCC-570" } as const;
const route = { ...decision, id: "r", trace_id: "route", action: "reconcile", reason: "position_account_route_bound",
  blocked_reason: "observation_only", position_id: "p", requested_qty: 1 } as const;
const base = { executionObservations: [decision, broker, route], workerRuns: [{ boot_id: "boot", instance_id: "i",
  git_sha: "g", railway_deployment: "dep", started_at: "2026-08-07T13:00:00Z",
  last_heartbeat_at: "2026-08-07T20:00:00Z", shutdown_started_at: null, ended_at: null,
  termination_kind: null, last_phase: "cycle", memory_rss_mb: 100 }],
  ledger: { logicalTrades: [{ opportunityId: "opp:1", positionIds: ["p"] }] } } as unknown as DecisionAtlasSourceSnapshot;
const clean = buildExecutionResilienceReport({ snapshot: base, generatedAt: "2026-08-07T20:01:00Z", throughSession: "2026-08-07" });
assert.equal(clean.state, "pass");
assert.equal(clean.traces.partialFills, 1);
assert.equal(clean.traces.positionRoutes, 1);
assert.equal(clean.traces.guardedBrokerResults, 0);
assert.equal(clean.orderAuthority, false);

const overfill = buildExecutionResilienceReport({ snapshot: { ...base,
  executionObservations: [decision, { ...broker, filled_qty: 3 }] } as unknown as DecisionAtlasSourceSnapshot,
  generatedAt: "2026-08-07T20:01:00Z", throughSession: "2026-08-07" });
assert.equal(overfill.state, "block");
assert.ok(overfill.issues.some((issue) => issue.code === "OVERFILL"));

const legacy = buildExecutionResilienceReport({ snapshot: { ...base, workerRuns: [],
  executionObservations: [decision, broker] } as unknown as DecisionAtlasSourceSnapshot,
  generatedAt: "2026-08-07T20:01:00Z", throughSession: "2026-08-07" });
assert.equal(legacy.state, "limited");
assert.ok(legacy.issues.some((issue) => issue.code === "NO_WORKER_RUN_EVIDENCE"));

const historicalReuse = buildExecutionResilienceReport({ snapshot: { ...base,
  executionObservations: [decision, broker, { ...decision, id: "d2", trace_id: "t2", opportunity_id: "opp:2" },
    { ...broker, id: "b2", trace_id: "t2", opportunity_id: "opp:2", broker_order_id: "broker-2" }] } as unknown as DecisionAtlasSourceSnapshot,
  generatedAt: "2026-08-07T20:01:00Z", throughSession: "2026-08-07" });
assert.equal(historicalReuse.state, "limited");
assert.ok(historicalReuse.issues.some((issue) => issue.code === "HISTORICAL_CLIENT_ORDER_ID_REUSE"));

const guardedReuse = buildExecutionResilienceReport({ snapshot: { ...base,
  executionObservations: [decision, { ...broker, payload: { execution_guard_version: "order-submit-once-v1" } },
    { ...decision, id: "d2", trace_id: "t2", opportunity_id: "opp:2" },
    { ...broker, id: "b2", trace_id: "t2", opportunity_id: "opp:2", broker_order_id: "broker-2",
      payload: { execution_guard_version: "order-submit-once-v1" } }] } as unknown as DecisionAtlasSourceSnapshot,
  generatedAt: "2026-08-07T20:01:00Z", throughSession: "2026-08-07" });
assert.equal(guardedReuse.state, "block");
assert.ok(guardedReuse.issues.some((issue) => issue.code === "CLIENT_ORDER_GUARD_BREACH"));
console.log("execution-resilience-selftest: PASS");
