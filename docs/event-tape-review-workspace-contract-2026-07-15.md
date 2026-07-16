# Event Tape / Review workspace contract

Status: code-constrained design contract. No production, schema, worker, strategy, or UI behavior changes.

## 1. Operator job

This workspace answers two different questions that must not share one undifferentiated log:

1. **LIVE TAPE — what is the desk doing now?**
   A chronological, filterable execution and safety timeline for the current session.
2. **REVIEW — what happened, why, and what should be studied?**
   A trade- and channel-linked after-action workspace with policy-era and provenance context.

The live tape is not a research leaderboard. Review is not a stream of raw worker messages. Neither surface may turn an interpretive narrative into health, policy, or execution truth.

## 2. Current source audit

| Source / component | Current value | Constraint or defect | Disposition |
|---|---|---|---|
| `useMarketData().events` | latest system/execution events | global latest 14 only; no account/session window; `meta` is untyped; not enough history for a session timeline | REBUILD the read contract; KEEP the rows as a compact global feed until replacement |
| `useDeskFeed().signals` | latest candidate, blocked, and acted-on signal facts | latest 16 only; signals are not broker/execution events; useful account scoping | KEEP as a distinct signal lane; do not relabel as execution |
| `useDeskFeed().recentTrades` | current-session closed positions | already supports realized result, close reason, peak, and capture | KEEP and link into Review trade detail |
| `execution_observations` | versioned decision and broker-result evidence with trace, account, channel, opportunity, position, order, quote, and run references | not yet lifted to the dashboard seam; observation-only and operator-readable | MAKE this the primary structured execution chronology |
| `position_outcome_events` | versioned position lineage, booking, reconciliation, and manual-reason evidence | not yet lifted; some events are best-effort and gaps must stay visible | MAKE this the primary position-outcome chronology |
| `manager_shadow_runs` | versioned per-position counterfactual manager result and censorship state | research-only; not execution truth; currently a run summary rather than an event stream | LINK from Review as evidence, never merge into the live execution lane |
| `PerformRail` / mobile tape | compact live glance; repeat collapse | presentation is useful; events are message-first and cannot reliably deep-link | REUSE collapse and channel-color treatment after normalization |
| legacy `EventLog` | readable raw receipt log | same shallow event feed; no filtering, linking, or provenance | CUT after native live tape passes parity |
| legacy daily/weekly `AutopsyPanel` | useful session/week reports and exit-efficiency findings | leaf components subscribe directly; narrative and deterministic facts are visually mixed | REUSE selected report views after data is lifted to the page seam |
| legacy `ForensicsPanel` | giveback, override, shadow-book, collision, and bench evidence | three leaf-owned subscriptions; many instruments compete for attention; basis varies by module | REBUILD as linked evidence cards with explicit basis/window |
| legacy `PnlPanel` | windowed attribution and equity context | leaf-owned window and Sentinel reads; fund and channel bases differ; not event-linked | REUSE only evidence-labeled window summaries |
| mobile `ReviewView` | today equity, attribution, and Sentinel | combines nightly readiness with after-action review; no event-to-trade path | SPLIT Sentinel from Review; rebuild Review around sessions/trades |

Load-bearing finding: the current `events` table can display receipts, but the existing dashboard read is too shallow and too weakly typed to support a truthful execution chronology. The newer observation tables already carry much of the durable linkage needed for Review. The UI must use those joins first and must not manufacture linkage from message text when durable metadata is absent.

## 3. Information architecture

### 3.1 LIVE TAPE

Default during an open session. Newest event can appear at the top, but a user must be able to switch to chronological order for reconstruction.

Primary controls:

- session/date;
- account;
- channel;
- underlying;
- lane: `ALL`, `SIGNAL`, `EXECUTION`, `MANAGER`, `RISK`, `OPERATOR`, `SYSTEM`;
- outcome: acted, blocked, filled, partial, rejected, closed, unresolved;
- adjacent-repeat collapse, enabled by default only for identical non-execution noise.

Each row shows, when known:

- exchange/session time and receipt time;
- severity and lane;
- channel and account;
- concise action/fact;
- contract and quantity;
- reason or blocker;
- link state: `TRADE`, `POSITION`, `SIGNAL`, `RUN`, or visibly `UNLINKED`.

Execution, risk, operator, and reconciliation events are never hidden by repeat collapse.

### 3.2 REVIEW

Default after the session. Review begins with sessions and trades, not channel rankings.

Session summary:

- account/NAV basis and session bounds;
- closed/open/unresolved counts;
- native realized result and explicit broker-reconciliation state;
- peak opportunity, realized/MFE capture, and giveback by partition;
- operator-close count separated from native manager exits;
- data completeness and policy-era coverage.

Trade list:

- channel, contract, quantity, entry/exit, realized result;
- MFE, MAE, capture, hold time, and exit reason;
- partition: native, operator, test, correction, or censored;
- policy version/era and quote/outcome basis;
- chronology completeness.

Trade detail opens one evidence chain:

`candidate → signal/gate → order intent → broker result → position → manager observations → exit intent → broker result → closed position → correction/reconciliation`

Missing links remain visible as gaps. Review must never invent an event or imply a broker acknowledgement from a worker intent.

Channel/family aggregation is a secondary view. Every statistic must state its session window, policy era, outcome partition, quote basis, and development/prospective status.

## 4. Normalized event contract

The presentation layer consumes a pure normalized record. Raw rows remain available for inspection.

```ts
export type DeskEventLane =
  | "signal"
  | "execution"
  | "manager"
  | "risk"
  | "operator"
  | "system";

export type DeskEventPhase =
  | "candidate"
  | "blocked"
  | "order_intent"
  | "broker_result"
  | "position_open"
  | "position_update"
  | "exit_intent"
  | "position_close"
  | "reconciliation"
  | "observation"
  | "unknown";

export interface DeskEventRef {
  accountId?: string;
  strategistId?: string;
  strategistSlug?: string;
  signalId?: string;
  positionId?: string;
  workerRunId?: string;
  occSymbol?: string;
  underlying?: string;
}

export interface NormalizedDeskEvent {
  id: string;
  occurredAt: string;
  receivedAt: string;
  lane: DeskEventLane;
  phase: DeskEventPhase;
  severity: "ok" | "info" | "warning" | "risk";
  summary: string;
  reason?: string;
  quantity?: number;
  refs: DeskEventRef;
  source:
    | "events"
    | "signals"
    | "positions"
    | "execution_observations"
    | "position_outcome_events"
    | "manager_shadow_runs";
  schemaVersion: number | null;
  linkage: "durable" | "partial" | "unlinked";
  raw: unknown;
}
```

Normalization rules:

1. Structured metadata wins over message parsing.
2. Message parsing may classify a legacy row, but cannot create a durable identifier.
3. `occurredAt` is provider/worker action time when present; `receivedAt` is database receipt time.
4. Broker result and worker intent are distinct phases.
5. Manual close and test trades are distinct partitions, not strategy outcomes.
6. Unknown schema versions remain raw and visibly unlinked; the mapper does not silently coerce them.
7. Every sort uses a timestamp plus a unique key.

## 5. Seam and subscription invariant

The existing invariant remains load-bearing:

`app/page.tsx owns hooks → SurfaceProps → shells compose → leaves remain subscription-free`

Target shape:

- page-owned `useEventTape` supplies bounded current-session execution observations plus compact system receipts, query health, pagination cursor, and Realtime insert refresh;
- page-owned, activation-gated `useReviewEvidence` supplies session reports, selected-trade chronology, and evidence cards;
- derivation functions normalize, classify, collapse, and link records without network access;
- desktop and mobile consume the same derived truth with different density;
- legacy panels keep their internal reads only while Legacy Rooms exists; their hooks are not copied into native leaves.

The first implementation slice should lift only the data needed for the live tape and selected trade. Large forensics books remain lazy and selected, not globally polled.

## 6. Provenance and truth rules

- `events.message` is a receipt, not automatically an execution fact.
- `signals.acted_on` is not a fill.
- a position row is desk-ledger state, not broker reconciliation.
- `realized_pnl` and NAV attribution may use different bases; the UI must label both.
- MFE/MAE requires a stated quote source and path completeness.
- operator exits, the MOMO close drill, corrections, and reconciliation entries cannot grade native managers.
- historical reports keep the policy era under which they were produced; present roster state cannot recolor old findings as current policy.
- LLM narrative is clearly marked interpretive and cannot alter health, policy, promotion, or execution.

## 7. Desktop and mobile composition

Desktop:

- full-height two-pane workspace;
- left: filterable live tape or session trade list;
- right: selected event/trade evidence chain and provenance;
- open position truth remains visible globally;
- keyboard selection is helpful but no action depends on it.

Mobile:

- top switch: `LIVE` / `REVIEW`;
- LIVE uses a dense single-column timeline with sticky filters;
- REVIEW starts with session summary, then trades; tapping a trade opens a full-screen evidence sheet;
- close-position action remains in BOOK/Positions, not duplicated in Review;
- no horizontal scrolling, 44px action targets, and no nested scroll trap.

## 8. Implementation slices

### Slice E1 — pure contract and read seam

- normalized types and deterministic mapper tests;
- current-session, account-aware event read with truthful loading/empty/error state;
- stable total ordering and pagination;
- no schema or worker changes.

### Slice E2 — native LIVE TAPE

- desktop full-stage tape and mobile timeline;
- lane/channel/account filters;
- safe repeat collapse;
- selected raw receipt/provenance drawer;
- legacy EventLog remains available.

### Slice E3 — trade-linked REVIEW

- session summary and trade list from existing position/report evidence;
- selected-trade chronology;
- native/operator/test/correction/censored partitions;
- explicit gaps where identifiers are unavailable.

### Slice E4 — lifted evidence modules

- daily/weekly autopsy facts;
- giveback and override comparison;
- manager-shadow and collision/occupancy evidence;
- evidence-passport links by channel/policy era;
- remove duplicate legacy subscriptions only as each module passes parity.

Schema or worker metadata improvements, if required for durable links, are separately reviewed and released. A UI slice does not authorize them.

## 9. Acceptance gates

1. A live execution can be followed from intent to broker result without confusing either with a fill.
2. A closed trade can be opened from Review and shows its complete known chronology, partitions, basis, and missing links.
3. Operator/test/correction rows cannot influence native strategy or manager grading.
4. Current-session filters are account-aware and do not drop fast closed trades.
5. Query error, empty ledger, loading, and stale evidence render distinctly.
6. Event ordering is deterministic across pagination boundaries.
7. Desktop and mobile use the same normalized records and pass no-overflow/no-scroll-trap checks.
8. No native leaf subscribes directly.
9. Legacy Rooms stays until LIVE TAPE and REVIEW both pass authenticated operator drills.
10. No strategy rule, worker behavior, order path, or production schema changes are bundled with the UI release.

## 10. Pre-implementation blockers to measure

Before E1, run a read-only coverage audit over recent sessions:

- percentage of execution events with position, signal, channel, contract, and worker-run identifiers;
- percentage with distinct occurred/received timestamps;
- number of legacy message-only schemas by producer;
- whether manual-close events link to the position and preserve the operator reason;
- whether partial/rejected broker outcomes are durable and linkable;
- exact event volume per session, to size retention and pagination.

This audit decides whether normalization alone is sufficient or whether a versioned event-envelope migration is needed. The UI must not guess the answer.

## 11. Initial read-only coverage receipt — 2026-07-15

Window: `2026-07-12T00:00:00Z` through the audit time. Tool: `npm run event-linkage-audit -- --since 2026-07-12T00:00:00Z`. The tool performs SELECTs only.

| Evidence | Receipt | Interpretation |
|---|---:|---|
| execution observations | 5,217 rows / 4,708 traces | enough structured volume to build a useful native chronology |
| blocked decisions | 4,438 / 4,833 decisions (91.8%) | expected high-volume research/guard evidence; must be a filterable signal lane, not execution noise |
| unblocked decision traces with broker result | 384 / 395 (97.2%) | strong, but not a fill-completeness metric: the decision is recorded before exit-guard and reconcile branching |
| broker-result rows with broker order ID | 384 / 384 | broker-result evidence is strongly linkable |
| execution observations with boot ID | 5,217 / 5,217 | durable worker-run provenance exists |
| execution observations with contract | 5,217 / 5,217 | contract drill-down is feasible |
| execution observations with opportunity ID | 3,908 / 5,217 (74.9%) | useful but incomplete opportunity linkage must be shown honestly |
| position outcomes | 397 | position-linked review substrate exists |
| outcomes with plan/opportunity | 397 / 397 | strong plan-to-outcome join |
| outcomes with boot ID | 387 / 397 (97.5%) | manual/operator rows explain at least part of the unstamped remainder |
| raw system receipts | 13,670 | too noisy to lead Review |
| raw receipts with typed `meta.kind` | 776 / 13,670 (5.7%) | confirms the log cannot be the primary normalized source |
| raw receipts with durable trade reference | 772 / 13,670 (5.6%) | message scraping would manufacture false certainty |
| manual-close raw receipts with position ID | 0 / 5 | current raw event is not directly trade-linkable |
| manual reason-tag outcomes | 5 | the position-outcome ledger is the correct manual-close evidence source |
| manager-shadow runs | 304: 283 terminal, 21 censored | enough linked research evidence for later Review cards |
| observation receipt lag p95 | 2,221 ms | acceptable for after-action evidence; live tape must label receipt latency |

The 11 unblocked decisions without a broker-result observation are all exit or reconcile decisions. Source inspection shows the decision observation is written before the per-row exit guard and before reconcile can resolve to a no-order path. Therefore these are **chronology gaps, not proof of 11 lost broker receipts or failed orders**. E1 must either derive an explicit `suppressed/no_order` phase from durable evidence or request a separately reviewed observation-only envelope improvement; it must not display them as attempted orders.
