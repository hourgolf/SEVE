// Resolve the one immutable ET session used by the hosted after-close workflow.
// Blank input means the latest fully closed and settled trading session. An
// explicit date is preserved but must already be ready, so the workflow stops
// before any research lane can run against an incomplete session.

import {
  assertAfterCloseSessionReady,
  latestReadyAfterCloseSession,
  priorTradingSession,
  resolveAfterCloseSession,
} from "../lib/research/afterCloseResearch.js";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]).trim() : null;
};

const nowArg = arg("now");
const nowMs = nowArg == null ? Date.now() : Date.parse(nowArg);
if (!Number.isFinite(nowMs)) throw new Error("--now must be an ISO timestamp");

const raw = arg("session");
const session = raw
  ? resolveAfterCloseSession(raw, nowMs)!
  : latestReadyAfterCloseSession(nowMs);
assertAfterCloseSessionReady(session, nowMs);

console.log(`SESSION_DATE_ET=${session}`);
console.log(`PRIOR_SESSION_DATE_ET=${priorTradingSession(session)}`);
