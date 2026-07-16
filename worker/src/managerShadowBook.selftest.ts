import { readFileSync } from "node:fs";
import {
  MIN_MODELED_SOURCE_QTY,
  MIN_STAGED_SOURCE_QTY,
  advanceManagerShadowRun,
  attachActualClose,
  buildManagerShadowEnrollments,
  buildManagerShadowTerminalObservation,
  censorManagerShadowRun,
  decodeManagerShadowRun,
  encodeManagerShadowRun,
  managerAllocation,
  managerEconomicMode,
  managerEnrollmentEligible,
  minimumModeledQty,
  managerPnl,
  managerShadowRunId,
  managerShadowTerminalObservationId,
  quantityWeightedReturnPct,
  recordManagerQuoteMiss,
  type ManagerShadowDbRow,
  type ManagerShadowRun,
} from "./managerShadowBookModel.js";
import {
  normalizeTargetedOptionSnapshots,
  targetedOptionBatches,
} from "./managerShadowQuoteModel.js";
import {
  MANAGER_SHADOW_QUOTE_MAX_AGE_MS,
  managerShadowMeaningfulChange,
  managerShadowSessionPhase,
} from "./managerShadowRuntimeModel.js";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  passed++;
}
function truth(name: string, value: unknown): void { check(name, !!value, true); }

const base = {
  positionId: "11111111-1111-4111-8111-111111111111",
  strategistId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  channelSlug: "orb-a",
  occSymbol: "SPY260713C00600000",
  underlying: "spy",
  optionSide: "call" as const,
  entryPrice: 1,
  entryPriceBasis: "broker_fill" as const,
  entryAt: "2026-07-13T14:31:00.000Z",
  admissionSource: "fill_hook" as const,
  admittedAt: "2026-07-13T14:31:00.250Z",
  originalQty: 4,
  quoteMaxAgeMs: 15_000,
  paperMode: true,
};

const runs = buildManagerShadowEnrollments(base);
check("one paper position enrolls eight managers", runs.length, 8);
check("minimum operating size is stamped", runs[0]?.minimumModeledQty, 4);
check("underlying is normalized", runs[0]?.underlying, "SPY");
check("admission is durable before any quote", [runs[0]?.admissionSource, runs[0]?.admissionDelayMs, runs[0]?.evidenceState, runs[0]?.lastBid], ["fill_hook", 250, "pending_quote", null]);
truth("all confirmed-size managers are integer executable", runs.every((r) => r.economicMode === "whole_lot_executable"));
check("non-paper enrolls nothing", buildManagerShadowEnrollments({ ...base, paperMode: false }).length, 0);
check("three contracts fail the confirmed cohort gate", buildManagerShadowEnrollments({ ...base, originalQty: 3 }).length, 0);
const pb2Two = buildManagerShadowEnrollments({ ...base, channelSlug: "pb-ride-2", originalQty: 2 });
check("two-contract pb2 enrolls only its staged candidate", pb2Two.map((r) => r.managerId), ["PB2-BANK15/HALF-GIVEBACK"]);
check("pb2 staged candidate stamps a two-contract minimum", pb2Two[0]?.minimumModeledQty, 2);
check("one contract cannot model an integer staged exit", buildManagerShadowEnrollments({ ...base, channelSlug: "pb-ride-2", originalQty: 1 }).length, 0);
check("runtime enrollment gate avoids extra quotes for ineligible small lots", [managerEnrollmentEligible("pb-ride-2", 2), managerEnrollmentEligible("pb-ride", 2)], [true, false]);
check("fractional quantities fail enrollment", buildManagerShadowEnrollments({ ...base, originalQty: 4.5 }).length, 0);
check("invalid position identity fails enrollment", buildManagerShadowEnrollments({ ...base, positionId: "bad" }).length, 0);
check("invalid entry price fails enrollment", buildManagerShadowEnrollments({ ...base, entryPrice: 0 }).length, 0);
check("invalid entry time fails enrollment", buildManagerShadowEnrollments({ ...base, entryAt: "not-a-date" }).length, 0);

const bank4 = managerAllocation(4, "BANK20/RUN50");
check("four contracts split 2 bank / 2 runner", bank4, { kind: "bank_runner", totalQty: 4, exitQty: 0, bankQty: 2, runnerQty: 2 });
const bank5 = managerAllocation(5, "BANK20/RUN50");
check("five contracts split 2 bank / 3 runner", bank5, { kind: "bank_runner", totalQty: 5, exitQty: 0, bankQty: 2, runnerQty: 3 });
check("all-out manager exits all five", managerAllocation(5, "LOCK20/30"), { kind: "all_out", totalQty: 5, exitQty: 5, bankQty: 0, runnerQty: 0 });
check("one-lot bank is explicitly fractional", managerEconomicMode(managerAllocation(1, "BANK20/RUN50")!), "normalized_fractional");
check("pb2 five-contract split is quantity-aware", managerAllocation(5, "PB2-BANK15/HALF-GIVEBACK"), { kind: "bank_runner", totalQty: 5, exitQty: 0, bankQty: 2, runnerQty: 3 });
check("manager-specific minimums retain the old cohort", [minimumModeledQty("LOCK20/30"), minimumModeledQty("PB2-BANK15/HALF-GIVEBACK"), MIN_MODELED_SOURCE_QTY, MIN_STAGED_SOURCE_QTY], [4, 2, 4, 2]);
check("bad quantity has no allocation", managerAllocation(0, "BANK20/RUN50"), null);

const ids = runs.map((r) => r.id);
check("run identities are unique", new Set(ids).size, 8);
const otherAccountRuns = buildManagerShadowEnrollments({
  ...base,
  positionId: "55555555-5555-4555-8555-555555555555",
  accountId: "66666666-6666-4666-8666-666666666666",
});
check("two accounts may share one OCC", otherAccountRuns[0]?.occSymbol, runs[0]?.occSymbol);
truth("shared OCC retains account-specific run identities", otherAccountRuns[0]?.id !== runs[0]?.id);
check("run identity is retry-stable", managerShadowRunId(base.positionId, "LOCK20/30"), managerShadowRunId(base.positionId, "LOCK20/30"));
truth("manager changes run identity", managerShadowRunId(base.positionId, "LOCK20/30") !== managerShadowRunId(base.positionId, "LOCK30/30"));
check("terminal observation identity is retry-stable", managerShadowTerminalObservationId(base.positionId, "LOCK20/30"), managerShadowTerminalObservationId(base.positionId, "LOCK20/30"));
truth("run and receipt identities have separate namespaces", managerShadowRunId(base.positionId, "LOCK20/30") !== managerShadowTerminalObservationId(base.positionId, "LOCK20/30"));

function run(managerId: ManagerShadowRun["managerId"], qty = 4): ManagerShadowRun {
  const found = buildManagerShadowEnrollments({ ...base, originalQty: qty }).find((r) => r.managerId === managerId);
  if (!found) throw new Error(`missing ${managerId}`);
  return found;
}
const tick = (bid: number, extra: Partial<Parameters<typeof advanceManagerShadowRun>[1]> = {}) => ({
  bid, ask: bid + 0.04, quoteAtMs: Date.parse("2026-07-13T14:32:00.000Z"),
  observedAtMs: Date.parse("2026-07-13T14:32:00.500Z"),
  snapshotFetchedAtMs: Date.parse("2026-07-13T14:32:00.450Z"), isBell: false, ...extra,
});
const laterTick = (bid: number, seconds: number) => tick(bid, {
  quoteAtMs: Date.parse("2026-07-13T14:32:00.000Z") + seconds * 1_000,
  observedAtMs: Date.parse("2026-07-13T14:32:00.500Z") + seconds * 1_000,
});

const lock = run("LOCK20/30");
const lockExit = advanceManagerShadowRun(lock, tick(1.27));
check("target overshoot exits at observed return", lockExit.kind, "terminal");
check("target overshoot preserves bid", lockExit.run.terminalBid, 1.27);
check("target overshoot return is observed +27", lockExit.run.terminalReturnPct, 27);
check("four-lot +27 percent pnl is exact", lockExit.run.terminalPnl, 108);
check("terminal time uses source quote time", lockExit.run.terminalAt, "2026-07-13T14:32:00.000Z");
check("terminal quote age is observed", lockExit.run.terminalQuoteAgeMs, 500);
check("first quote keeps event and snapshot clocks separate", [lockExit.run.firstQuoteEventAgeMs, lockExit.run.firstSnapshotFetchAgeMs, lockExit.run.evidenceState], [500, 50, "observing"]);
check("terminal run cannot advance again", advanceManagerShadowRun(lockExit.run, tick(0.5)).kind, "skipped");

check("zero bid skips", advanceManagerShadowRun(lock, tick(0)).kind, "skipped");
check("negative bid skips", advanceManagerShadowRun(lock, tick(-1)).kind, "skipped");
check("crossed quote skips", advanceManagerShadowRun(lock, tick(1, { ask: 0.99 })).kind, "skipped");
check("future source quote skips", advanceManagerShadowRun(lock, tick(1, { quoteAtMs: Date.parse("2026-07-13T14:32:01Z") })).kind, "skipped");
check("pre-entry source quote skips", advanceManagerShadowRun(lock, tick(1, { quoteAtMs: Date.parse("2026-07-13T14:30:59Z"), observedAtMs: Date.parse("2026-07-13T14:31:00Z") })).kind, "skipped");
check("stale quote skips", advanceManagerShadowRun(lock, tick(1.5, { quoteAtMs: Date.parse("2026-07-13T14:31:30Z") })).kind, "skipped");
check("stale quote leaves state byte-identical", advanceManagerShadowRun(lock, tick(1.5, { quoteAtMs: Date.parse("2026-07-13T14:31:30Z") })).run, lock);
check("stamped freshness bound is honored", advanceManagerShadowRun({ ...lock, quoteMaxAgeMs: 499 }, tick(1)).kind, "skipped");
const firstFresh = advanceManagerShadowRun(run("BELL/no-stop"), tick(1.05));
check("duplicate source quote is skipped", advanceManagerShadowRun(firstFresh.run, tick(1.06)).kind, "skipped");
check("older source quote is skipped", advanceManagerShadowRun(firstFresh.run, tick(1.06, { quoteAtMs: Date.parse("2026-07-13T14:31:59Z") })).kind, "skipped");

const bankStart4 = advanceManagerShadowRun(run("BANK20/RUN50"), tick(1.24));
check("four-lot bank crossing is active", bankStart4.kind, "advanced");
check("bank crossing captures observed overshoot", bankStart4.run.bankReturnPct, 24);
const bankEnd4 = advanceManagerShadowRun(bankStart4.run, laterTick(1, 10));
check("four-lot 2/2 bank-run uses 50/50 economics", bankEnd4.run.terminalReturnPct, 12);
check("four-lot bank-run pnl is quantity aware", bankEnd4.run.terminalPnl, 48);

const bankStart5 = advanceManagerShadowRun(run("BANK20/RUN50", 5), tick(1.24));
const bankEnd5 = advanceManagerShadowRun(bankStart5.run, laterTick(1, 10));
check("five-lot 2/3 bank-run is not naive average", bankEnd5.run.terminalReturnPct, 9.6);
check("five-lot quantity-weighted pnl", bankEnd5.run.terminalPnl, 48);
const recoveredPb2 = { ...pb2Two[0]!, managerState: { bankReturnPct: 15, armedPeakPct: 35, recovered: true }, bankReturnPct: 15 };
truth("restart-recovery provenance survives durable encode/decode", decodeManagerShadowRun(encodeManagerShadowRun(recoveredPb2, { sourceBootId: "77777777-7777-4777-8777-777777777777" })!)?.managerState.recovered);
const bankReceipt5 = buildManagerShadowTerminalObservation(bankEnd5.run);
truth("five-lot terminal creates append-only receipt draft", bankReceipt5);
check("receipt carries quantity-weighted return", bankReceipt5?.payload.counterfactualReturnPct, 9.6);
check("receipt carries exact 2/3 allocation", bankReceipt5?.payload.allocation, bank5);
check("receipt is explicitly observation only", [bankReceipt5?.action, bankReceipt5?.blocked_reason, bankReceipt5?.payload.shadowOnly], ["exit", "observation_only", true]);
check("terminal receipt identity is deterministic", buildManagerShadowTerminalObservation(bankEnd5.run)?.id, bankReceipt5?.id);
check("active run cannot create terminal receipt", buildManagerShadowTerminalObservation(bankStart5.run), null);
check("mutated terminal economics cannot create receipt", buildManagerShadowTerminalObservation({ ...bankEnd5.run, terminalPnl: 999 }), null);
check("weighted helper rejects corrupt allocation", quantityWeightedReturnPct({ managerId: "BANK20/RUN50", allocation: { ...bank5!, runnerQty: 4 } }, { bankReturnPct: 24 }, 0), null);
check("pnl rejects fractional source quantity", managerPnl(1, 4.5, 10), null);

const armed1 = advanceManagerShadowRun(run("ARM20/HALF-GIVEBACK"), tick(1.25));
const armed2 = advanceManagerShadowRun(armed1.run, laterTick(1.6, 10));
const giveback = advanceManagerShadowRun(armed2.run, laterTick(1.29, 20));
check("giveback policy tracks independent peak", armed2.run.managerState.armedPeakPct, 60);
check("giveback is all-out, not half quantity", giveback.run.allocation.exitQty, 4);
check("giveback records observed +29", giveback.run.terminalReturnPct, 29);

const actual = attachActualClose(bankStart5.run, { atMs: Date.parse("2026-07-13T14:33:00Z"), reason: "operator_tp", realizedPnl: 120 });
check("actual close does not terminate shadow manager", actual.status, "active");
check("actual close provenance is retained", [actual.actualCloseReason, actual.actualRealizedPnl], ["operator_tp", 120]);
check("first actual-close attribution wins", attachActualClose(actual, { atMs: Date.parse("2026-07-13T14:34:00Z"), reason: "later", realizedPnl: -1 }), actual);
const closedBeforeQuote = attachActualClose(run("LOCK30/30"), { atMs: Date.parse("2026-07-13T14:31:30Z"), reason: "operator_test", realizedPnl: 0 });
check("close before first quote is explicit evidence", closedBeforeQuote.evidenceState, "no_eligible_quote_before_actual_close");
check("pre-entry actual close is rejected", attachActualClose(run("LOCK30/30"), { atMs: Date.parse("2026-07-13T14:30:00Z"), reason: "bad", realizedPnl: 1 }), run("LOCK30/30"));
const actualBeforeManager = attachActualClose(run("LOCK20/30"), {
  atMs: Date.parse("2026-07-13T14:31:30Z"), reason: "operator_rationale_tp", realizedPnl: 48,
});
const terminalAfterActual = advanceManagerShadowRun(actualBeforeManager, tick(1.23));
check("shadow manager continues after actual close", [terminalAfterActual.kind, terminalAfterActual.run.terminalReturnPct], ["terminal", 23]);
check("actual outcome remains context after shadow terminal", [terminalAfterActual.run.actualCloseReason, terminalAfterActual.run.actualRealizedPnl], ["operator_rationale_tp", 48]);
check("actual close may attach after manager terminal", attachActualClose(lockExit.run, {
  atMs: Date.parse("2026-07-13T14:33:00Z"), reason: "later_actual", realizedPnl: 50,
}).actualCloseReason, "later_actual");

const missed = recordManagerQuoteMiss(recordManagerQuoteMiss(actual));
check("quote misses accumulate on active run", missed.consecutiveQuoteMisses, 2);
check("missing quote does not invent a mark", [missed.lastBid, missed.lastQuoteAt], [actual.lastBid, actual.lastQuoteAt]);
check("fresh tick clears quote misses", advanceManagerShadowRun(missed, laterTick(1.3, 10)).run.consecutiveQuoteMisses, 0);
check("terminal run ignores quote misses", recordManagerQuoteMiss(lockExit.run), lockExit.run);

const censored = censorManagerShadowRun(actual, { atMs: Date.parse("2026-07-13T19:26:00Z"), code: "no_fresh_cutoff_bid", fact: "15s freshness elapsed" });
check("censor is explicit", [censored.status, censored.censorCode], ["censored", "no_fresh_cutoff_bid"]);
check("censored run cannot later terminal", advanceManagerShadowRun(censored, tick(2)).kind, "skipped");
check("terminal run cannot be censored", censorManagerShadowRun(lockExit.run, { atMs: Date.now(), code: "bad" }), lockExit.run);
check("pre-entry censor is rejected", censorManagerShadowRun(run("LOCK50/30"), { atMs: Date.parse("2026-07-13T14:30:00Z"), code: "bad" }), run("LOCK50/30"));

const boot = "44444444-4444-4444-8444-444444444444";
const encodedBank = encodeManagerShadowRun(bankStart5.run, { sourceBootId: boot });
truth("active bank run encodes", encodedBank);
const hydratedBank = decodeManagerShadowRun(encodedBank!);
check("restart hydration restores exact bank crossing", hydratedBank?.managerState.bankReturnPct, 24);
check("restart hydration restores 2/3 integer allocation", hydratedBank?.allocation, bank5);
check("codec roundtrip preserves pure state", hydratedBank, bankStart5.run);
check("hydrated active run resumes instead of censoring", advanceManagerShadowRun(hydratedBank!, laterTick(1, 10)).kind, "terminal");

const encodedTerminal = encodeManagerShadowRun(lockExit.run, { sourceBootId: boot, terminalBootId: boot });
truth("terminal row encodes", encodedTerminal);
check("terminal codec roundtrip", decodeManagerShadowRun(encodedTerminal!), lockExit.run);
const encodedCensored = encodeManagerShadowRun(censored, { sourceBootId: boot });
truth("censored row encodes", encodedCensored);
check("censored codec roundtrip", decodeManagerShadowRun(encodedCensored!), censored);

const mutate = (row: ManagerShadowDbRow, patch: Partial<ManagerShadowDbRow>): ManagerShadowDbRow => ({ ...row, ...patch });
check("wrong deterministic id fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { id: boot })), null);
check("wrong policy epoch fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { manager_policy_version: "future" })), null);
check("wrong shadow-book epoch fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { shadow_book_version: "future" })), null);
check("invalid quote-age policy fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { quote_max_age_ms: 0 })), null);
check("wrong cutoff policy fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { cutoff_minutes_before_close: 10 })), null);
check("wrong schema fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { schema_version: 1 })), null);
check("fractional allocation cannot masquerade as integer", decodeManagerShadowRun(mutate(encodedBank!, { allocation: { ...bank5!, bankQty: 2.5, runnerQty: 2.5 } })), null);
check("terminal missing trigger fails hydration", decodeManagerShadowRun(mutate(encodedTerminal!, { terminal_trigger: null })), null);
check("active row with terminal evidence fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { terminal_bid: 1 })), null);
check("censored row with terminal evidence fails hydration", decodeManagerShadowRun(mutate(encodedCensored!, { terminal_bid: 1 })), null);
check("negative quote age fails hydration", decodeManagerShadowRun(mutate(encodedTerminal!, { terminal_quote_age_ms: -1 })), null);
check("invalid boot identity fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { source_boot_id: "bad" })), null);
check("missing source boot fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { source_boot_id: null })), null);
check("terminal needs terminal boot provenance", decodeManagerShadowRun(mutate(encodedTerminal!, { terminal_boot_id: null })), null);
check("active run cannot claim terminal boot", decodeManagerShadowRun(mutate(encodedBank!, { terminal_boot_id: boot })), null);
check("unknown manager state key fails hydration", decodeManagerShadowRun(mutate(encodedBank!, { manager_state: { bankReturnPct: 24, invented: true } })), null);
check("actual close needs a reason", decodeManagerShadowRun(mutate(encodedBank!, { actual_close_at: "2026-07-13T14:33:00Z" })), null);
check("actual pnl cannot exist without actual close", decodeManagerShadowRun(mutate(encodedBank!, { actual_realized_pnl: 10 })), null);
check("bank mirror cannot diverge from durable state", decodeManagerShadowRun(mutate(encodedBank!, { bank_return_pct: 20 })), null);
check("terminal pnl cannot diverge from integer economics", decodeManagerShadowRun(mutate(encodedTerminal!, { terminal_pnl: 999 })), null);

const migration = readFileSync(new URL("../../supabase/migrations/20260713062859_phase_1g_durable_shadow_book.sql", import.meta.url), "utf8");
const v2Migration = readFileSync(new URL("../../supabase/migrations/20260716205844_manager_shadow_book_v2_admission_provenance.sql", import.meta.url), "utf8");
truth("migration enables RLS", migration.includes("alter table public.manager_shadow_runs enable row level security"));
truth("migration revokes anonymous access", migration.includes("revoke all on public.manager_shadow_runs from public, anon, authenticated"));
truth("migration grants service writes", migration.includes("grant select, insert, update, delete on public.manager_shadow_runs to service_role"));
truth("migration restricts operator reads by app metadata", migration.includes("'app_metadata' ->> 'seve_role') = 'operator'"));
truth("migration has active partial OCC index", migration.includes("where status = 'active'"));
truth("migration enforces integer source quantity", migration.includes("original_qty             integer not null"));
truth("migration requires source-boot provenance", migration.includes("source_boot_id           uuid not null"));
truth("model contains no execution imports", !readFileSync(new URL("./managerShadowBookModel.ts", import.meta.url), "utf8").match(/executeExit|orderAndFill|broker order/i));
truth("v2 migration preserves versioned provenance", v2Migration.includes("manager-shadow-book-v2") && v2Migration.includes("admission_source"));
truth("v2 migration permits the staged two-lot candidate", v2Migration.includes("minimum_modeled_qty in (2, 4)"));

check("targeted quotes deduplicate and sort", targetedOptionBatches(["Z", "A", "z"], 2, 10), [["A", "Z"]]);
check("targeted quotes batch at provider limit", targetedOptionBatches(Array.from({ length: 101 }, (_, i) => `O${i}`), 100, 500)?.map((b) => b.length), [100, 1]);
check("targeted quote hard cap fails closed", targetedOptionBatches(["A", "B", "C"], 2, 2), null);
check("invalid provider batch size fails closed", targetedOptionBatches(["A"], 101, 500), null);
const normalized = normalizeTargetedOptionSnapshots({ snapshots: {
  SPY260713C00600000: { latestQuote: { bp: 1.2, ap: 1.24, t: "2026-07-13T14:32:00.000Z" } },
  ZERO: { latestQuote: { bp: 0, ap: 1, t: "2026-07-13T14:32:00.000Z" } },
  CROSSED: { latestQuote: { bp: 1.2, ap: 1.1, t: "2026-07-13T14:32:00.000Z" } },
  NOTIME: { latestQuote: { bp: 1.2, ap: 1.3 } },
} }, "opra");
check("provider normalization retains source timestamp", normalized.get(base.occSymbol), {
  occSymbol: base.occSymbol, bid: 1.2, ask: 1.24,
  quoteAtMs: Date.parse("2026-07-13T14:32:00.000Z"), feed: "opra",
});
check("invalid provider quotes are omitted", [...normalized.keys()], [base.occSymbol]);
check("missing snapshot body is empty", normalizeTargetedOptionSnapshots({}, "opra").size, 0);

check("regular session observes before 15:55", managerShadowSessionPhase({ date: "2026-07-13", minute: 954, second: 59 }), "observe");
check("regular session enters cutoff at 15:55", managerShadowSessionPhase({ date: "2026-07-13", minute: 955, second: 0 }), "cutoff");
check("cutoff grace settles after 30 seconds", managerShadowSessionPhase({ date: "2026-07-13", minute: 955, second: 30 }), "settle");
check("half-day cutoff is 12:55", managerShadowSessionPhase({ date: "2026-11-27", minute: 775, second: 0 }), "cutoff");
check("holiday never observes", managerShadowSessionPhase({ date: "2026-12-25", minute: 600, second: 0 }), "closed");
check("weekend never observes", managerShadowSessionPhase({ date: "2026-07-12", minute: 600, second: 0 }), "closed");
check("pre-open is closed", managerShadowSessionPhase({ date: "2026-07-13", minute: 569, second: 59 }), "closed");
check("dark cohort quote freshness is stamped at 15 seconds", MANAGER_SHADOW_QUOTE_MAX_AGE_MS, 15_000);
check("passive bid alone is not a durable write", managerShadowMeaningfulChange(lock, { ...lock, lastBid: 1.01 }), false);
check("first quote miss is durable", managerShadowMeaningfulChange(lock, recordManagerQuoteMiss(lock)), true);
check("second quote miss is coalesced", managerShadowMeaningfulChange({ ...lock, consecutiveQuoteMisses: 1 }, { ...lock, consecutiveQuoteMisses: 2 }), false);
check("sixth quote miss is a durable checkpoint", managerShadowMeaningfulChange({ ...lock, consecutiveQuoteMisses: 5 }, { ...lock, consecutiveQuoteMisses: 6 }), true);
check("quote recovery is durable", managerShadowMeaningfulChange({ ...lock, consecutiveQuoteMisses: 6 }, lock), true);
check("actual close is a durable transition", managerShadowMeaningfulChange(lock, actualBeforeManager), true);
check("bank crossing is a durable transition", managerShadowMeaningfulChange(run("BANK20/RUN50"), bankStart4.run), true);
check("terminal is a durable transition", managerShadowMeaningfulChange(lock, lockExit.run), true);
truth("runtime module contains no execution/order import", !readFileSync(new URL("./managerShadowBook.ts", import.meta.url), "utf8").match(/from ["']\.\/execute|orderAndFill|getOrders|getPositions/));
truth("fill path queues observer without awaiting it", readFileSync(new URL("./execute.ts", import.meta.url), "utf8").includes("queueManagerShadowAdmission({"));
truth("recovery includes closed rows", readFileSync(new URL("./store.ts", import.meta.url), "utf8").includes("loadManagerShadowRecoveryPositions"));
truth("terminal managers can receive later actual outcomes", readFileSync(new URL("./store.ts", import.meta.url), "utf8").includes("saveManagerShadowActualClose"));

check("declared operating minimum remains four", MIN_MODELED_SOURCE_QTY, 4);
console.log(`manager-shadow-book-selftest: ${passed}/${passed} PASS`);
