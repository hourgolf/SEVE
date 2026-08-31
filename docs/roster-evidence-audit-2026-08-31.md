# Roster evidence audit — August 31, 2026

## Judgment

**The dashboard defect is real and decision-relevant, but it does not establish that every roster selection was based on truncated data.** The audit also found independent defects in trial review and shadow-control enrollment. Correcting the display alone will not close the learning loop.

This is a read-only audit, not an activation packet. No production rows, trading settings, accounts, orders, positions, schedules, deployments, or releases were changed. Local diagnostic artifacts were created. The pre-existing dirty readiness document was preserved.

## Evidence boundary

- Execution snapshot: **August 31 at 12:23:20 PDT** (`2026-08-31T19:23:20.012Z`). August 31 was still in progress; today's results are separate below.
- Current-roster evaluation: **completed sessions August 24–28**, exact immutable channel specification and execution account, logical trades rather than exit tranches. All ten current-spec cohorts independently matched this completed-week window.
- Dollars are recorded realized paper-trade P&L at the actual size. They are not virtual path sums, manager counterfactuals, per-contract dollars, or separately reconciled broker NAV/fee-adjusted returns.
- The active receipt-bound roster contains ten trading channels and fifteen observe-only specifications. This report evaluates the ten trading channels; it does not rerank every observing/dark/retired replacement.
- Local reads are not a transactional database snapshot. Route counts before/after, row uniqueness, and active-manifest stability were checked.
- Historical legacy coverage remains limited: 1,691 logical closed trades in the canonical ledger include 1,082 structural-only trades without immutable account attribution. Those were not used for account-level claims. Recent 30-day attribution resolved completely.

## 1. Dashboard: nine of ten current channels have an affected month row

`hooks/useWindowedPnl.ts` requests execution observations for batches of 200 position IDs without pagination or a total order. The first 200-position batch needed **2,841 observations**; the dashboard received **1,000**. The remaining 63-position batch needed 714. The complete read returned **3,555 observations for 263 position rows**.

In this frozen comparison the incomplete query falsely left 96 position rows without account routes. Full pagination resolved every route. Missing child/parent attribution withholds an entire logical trade. Unordered truncation means the misleading subset can also change between requests.

The seven-day request needed only 650 observations for 46 position rows, so it happened to fit. That is not a permanent guarantee that the seven-day view is safe. Both desktop and mobile consume the shared hook.

### Month reconciliation at the frozen cutoff

Each cell is **logical trades / profitable trades / realized dollars**. The incomplete column reproduces one defective query, not a stable historical display value.

| Channel | Incomplete query | Complete, independently reconciled |
|---|---:|---:|
| grind-smart-entries | 3 / 2 / −$34 | **12 / 7 / +$464** |
| momo-shape-2 | 8 / 5 / −$422 | **15 / 7 / −$899** |
| orb-ustop-ctl | 21 / 15 / +$849 | **29 / 17 / +$632** |
| orb-trend-rider | 0 / 0 / $0 | **0 / 0 / $0** |
| pb-ride | 1 / 0 / −$122 | **6 / 4 / +$14** |
| vb-curl-reversal-iwm | 2 / 2 / +$54 | **6 / 4 / +$54** |
| vb-gap-drift-qqq | 1 / 0 / −$126 | **3 / 0 / −$358** |
| vb-level-break | 4 / 1 / −$220 | **16 / 5 / −$952** |
| vb-macd-state | 11 / 6 / +$56 | **21 / 11 / −$164** |
| vb-or-fail-iwm | 0 / 0 / $0 | **2 / 1 / −$28** |

The complete UI-shaped calculation matched the independent canonical ledger on trade count, profitable count, and dollars for all ten channels in both windows: **20/20 comparisons**. No hypothetical trades were added. These month results span older configurations and must not be used alone to judge a current exit manager.

An additional interpretation issue: seven days is a rolling timestamp window, not necessarily the last completed Monday–Friday session set. At this cutoff it excludes the morning of August 24 and includes August 31. Counts should be nested for identical scope and cutoff; profitable percentages and dollars need not increase with a longer window.

## 2. Current roster: what the clean forward evidence says

**43 logical trades, −$841 combined recorded realized P&L for August 24–28.** Account 1: +$238; Account 2: −$906; Account 3: −$173. This is the current-roster trade subtotal, not a fresh broker NAV reconciliation.

“Without best” removes the channel's best completed session, not the portfolio's best session. It is a fragility check, not a marginal portfolio replay.

| Account | Channel · contracts | Trades / wins | P&L | Typical trade | Without best session | Audit disposition |
|---|---|---:|---:|---:|---:|---|
| 1 | grind-smart-entries · 4 | 5 / 3 | +$304 | +$84 | −$76 | Positive forward result; four-contract justification fragile; reconcile conflicting size rollback wording |
| 1 | momo-shape-2 · 2 | 4 / 1 | −$148 | −$60 | −$120 | Two independent sessions; rehabilitation not proven; repair the promised displaced-manager comparison |
| 1 | vb-curl-reversal-iwm · 2 | 5 / 4 | +$82 | +$24 | +$46 | Favorable small trial; retain for evaluation, no size increase justified |
| 2 | vb-macd-state · 4 | 5 / 4 | +$244 | +$112 | +$100 | Best-supported positive current sample alongside IWM curl; no need to reject it because legacy month is negative |
| 2 | vb-level-break · 4 | 8 / 1 | −$816 | −$142 | −$804 | Urgent sizing/rollback review; present four-contract contribution has failed the outlier-removed test |
| 2 | vb-gap-drift-qqq · 2 | 3 / 0 | −$358 | −$118 | −$244 | Written three-losing-session trial threshold reached; prepare return to observing, not permanent retirement |
| 2 | vb-or-fail-iwm · 2 | 1 / 1 | +$24 | +$24 | — | One completed session; neither validated nor disproven |
| 3 | orb-ustop-ctl · 2 | 7 / 2 | −$133 | −$46 | −$198 | Weak current sample, despite positive legacy month; only three independent sessions; review entry and capture, no proven replacement |
| 3 | orb-trend-rider · 2 | 0 / 0 | $0 | — | — | Trading authority but no fills; an admission-limited backup, not a demonstrated profitable channel |
| 3 | pb-ride · 2 | 5 / 3 | −$40 | +$60 | −$154 | Typical trade positive, aggregate negative; loss severity and exit conversion deserve priority research |

### Rollback conditions need to govern the trial, not disappear behind sample minimums

- **QQQ gap:** August 24 −$126, August 25 −$114, August 27 −$118. The declared three-losing-independent-session rule is unambiguously reached. Small sample is the strongest counterargument to declaring the channel intrinsically bad; it is not a reason to silently ignore its predeclared paper-trial limit. Confidence: high on the threshold, low on permanent channel viability.
- **Level:** four losing sessions, eight trades, −$804 even after removing its best day. The four-contract step no longer has positive outlier-removed channel contribution. Prepare the two-contract rollback for review; separately decide whether continued trading earns its evidence budget. A two-contract scale-down is risk reduction, not a profitability fix. A true marginal size/portfolio replay is still missing here, so do not label the exact incremental dollar effect proven. Confidence: high that the existing size rationale needs review; moderate on the next configuration.
- **Grind:** the Sunday packet says four-contract channels revert when outlier-removed contribution becomes negative. The channel-specific constant instead names negative typical contribution or other failure conditions. Last week the median was positive while without-best was negative. Those rules yield different decisions. The current native remains promising; the size rule must be reconciled explicitly before automatic enforcement. Confidence: high in the ambiguity and fragility, not in a blanket rejection.
- **ORB control:** its written review horizon is five additional independent sessions. Seven trades across three sessions do not satisfy that time-diversity criterion. A positive pooled month does not rescue the weak current cohort, and the weak cohort alone does not establish a better entry/manager replacement.

### Today is not last week

At the frozen August 31 cutoff, the ten-channel subtotal was **+$289**: Grind +$332, MACD +$72, PB +$54, Momo −$53, IWM curl −$28, Level −$36, IWM OR-fail −$52; the others had no closed trades. These are incomplete-session figures and were excluded from the completed-week decisions above. They do not retroactively erase thresholds reached last week.

## 3. A separate published-recommendation defect

The August 28 production briefs were independently selected and their payload hashes verified. All ten executed sections matched this audit's current-spec completed-week counts and totals.

Nevertheless, the published briefs for **QQQ gap, Level, and Grind say KEEP COLLECTING**, with instructions not to change entry, exit, manager, or size until at least five scored sessions and ten outcomes exist. The recommendation builder does not take the declared roster-trial rollback contract as input.

This is not missing performance data in Atlas. **Atlas has the losses; its general research sufficiency rule does not evaluate the distinct trial rollback rule.** A minimum sample for claiming an improved strategy must not suppress a predeclared trial-limit alert. Conversely, a rollback alert must not silently place an order or activate a new configuration.

Correct user-facing states should distinguish: trading trial, observing research, insufficient evidence to select a new manager, and trial limit reached awaiting operator decision. “Native holds” means no sufficiently supported challenger; it does not mean the native is profitable or the trial should run indefinitely.

## 4. Promised shadow controls are not all enrolled

The packet's declared controls were compared with all durable manager runs attached to current-spec completed trades, including multi-tranche trade IDs. Worker enrollment code in `engine/managerPolicy.ts` confirms stale channel-specific arm selection.

| Channel | Intended comparison | Observed durable-lab coverage |
|---|---|---|
| grind-smart-entries | New ratchet versus inherited all-out +8 | Generic eight arms present; inherited +8 is not enrolled |
| momo-shape-2 | BANK30-R50-K67 versus displaced B20/breakeven runner and named full-position ratchets | +27/−40 control is still enrolled; declared B20 and named full-position ratchets are absent |
| vb-level-break | Current TP30 versus displaced LOCK50/30 and TP25 | TP25 present; LOCK50/30 excluded by stale code that still describes it as native; TP30 remains among generic arms |
| vb-macd-state | WIDE20/50 versus displaced all-out +18 | Present under equivalent lab ID `VB-MACD-CURRENT-LOCK18`; do not mistake the alias for missing coverage |

This establishes missing enrollment in the **durable manager lab**, not absence of every possible retrospective archive. Other reconstruction sources have not been exhaustively audited. A generic eight-arm counter is not proof the promised control exists. Any recovered historical comparison must be labeled retrospective, not relabeled as prospectively collected evidence.

### What the existing paired shadows can support

The audit matched terminal, uncensored runs to exact-current-spec **single-position** trades whose recorded actual comparator matched canonical realized P&L. It excluded multi-tranche trades from lift scoring rather than risk duplicate or mismatched totals. Policies/book versions remain separate; pairs are unique within each group.

- **MACD / LOCK30/30:** five pairs across five sessions; +$80 median trade lift, +$480 total modeled lift, +$220 after removing its best lift session. This is a worthwhile challenger study, not deployment proof. Its displaced +18 control has $0 median lift and −$4 total lift versus current execution, so there is no persuasive rollback-to-18 result here.
- **PB / LOCK30/30:** five pairs across five sessions; +$22 median lift, +$194 total, +$104 without the best lift session. Prioritize paired exit research. This does not prove its entry quality or the portfolio effect of longer holding periods.
- **Level / WIDE20/50:** +$560 total modeled lift, but **−$40 after the best lift session is removed**. Reject a confident manager-swap claim from that total. Existing TP25 control was slightly worse than current execution on this cohort.
- **Grind / LOCK50/30:** +$64 total lift, but **−$36 without the best lift session**. No strong reason here to abandon its positive native result.
- **QQQ gap:** no convincing rescue among the available arms. Its published executed-cohort typical favorable excursion is 0%; this is not evidence of a large gain consistently available for a tighter take-profit to capture.
- **Momo / ORB:** only two/three independent sessions respectively, with multi-tranche exclusions. No new manager winner established.

These are exploratory same-trade counterfactuals. No fresh chronological holdout, full quote-quality revalidation, new-manager capacity replay, or portfolio displacement test was completed in this audit. Selecting the best of several arms on these same sessions introduces selection bias. **No manager activation recommendation passes the complete decision gates yet.**

## 5. Why ORB trend has no executed evidence

The latest verified Atlas snapshot contains **26 ORB trend signals and 26 corresponding decision observations for August 24–28**. All were blocked: 19 `admission_domain_family_open`, seven `admission_domain_same_clock_collision`; zero acted signals.

This is consistent with its intended subordinate family-backup role, not a failed fill-count query. It also means the trading trial did not produce filled-position manager evidence. The separate virtual paths must not be presented as executed trial progress. Whether a different route would add value requires a same-opportunity admission/displacement replay; this audit does not justify relaxing same-account family or OCC protections.

## 6. Was the original roster selected using the faulty display?

**Observed:** the canonical profitability reader uses ordered pagination. The roster tournament consumes saved Atlas/path/phenotype inputs; the packet preparation reads tournament/phenotype files and validates the intended channel list. It does not read `useWindowedPnl`.

The stored activation bundle binds this roster to the Sunday packet SHA below. The durable Sunday summary describes two-/three-week chronological comparisons, capacity, collision and best-session removal. It explicitly acknowledges mixed exact-path and historical virtual replay sources and that the selection windows were used to choose the roster.

**Supported inference:** there is no demonstrated direct dependency from the truncating dashboard query to the tournament's numerical input. This specific UI defect does not automatically invalidate every original selection.

**Not established:** the exact frozen August 22 tournament/path/phenotype inputs were not located in the inspected worktrees. Therefore this audit cannot independently reproduce all original rankings or certify the original packet's sufficiency claims. A stored hash/“pass” label is provenance, not a substitute for the underlying evidence. Prior discretionary decisions may also have been influenced by faulty displays; that causal history has not been established either way.

The packet's use of “rehabilitate” is an intended experiment, not proof of rehabilitation. Current forward outcomes do not support calling Momo or Level rehabilitated. More generally, data integrity, strategy efficacy, and operational readiness are three different judgments.

## 7. Prioritized repair and decision sequence

1. **Repair Account Results retrieval:** total-order pagination, expected/returned count checks, full parent/runner grouping, explicit partial-evidence failure. Test >1,000 observations, stable ties, cross-account routes, pagination failure, and nested Today/7D/30D sets. Apply the same contract on desktop/mobile. No reattribution via today's strategist account as fallback.
2. **Evaluate trial contracts before generic research advice:** show threshold reached, exact supporting sessions, and pending operator decision. Unify the conflicting Grind size wording. Keep automated review separate from execution authority.
3. **Prepare bounded decisions:** QQQ gap trading→observing; Level four→two size rollback and continued-trial review; Grind size-contract review without rejecting its positive native; retain MACD/IWM curl for evaluation without scaling. Before any activation, enumerate evidence/portfolio limitations, obtain exact approval, verify safe transition/rollback behavior, and preserve existing-position exits.
4. **Repair shadow enrollment:** resolve the actual native plus exact displaced policy from the receipt-bound configuration. Verify expected controls by policy identity, not labels or a generic arm count. Prepare separate approval for worker deployment; no silent changes to paper economics.
5. **Archive and reproduce selection evidence:** recover original hash-bound inputs where possible, preserve new complete inputs durably, and rerun chronological/outlier/capacity/displacement checks before promotions or manager swaps. Do not replace original evidence with a current-data replay bearing the old date.
6. **Use existing dashboard surfaces:** one concise per-channel verdict showing current execution, relevant history, trial-limit state, and comparison coverage. Do not add another competing leaderboard.

Deployment coupling remains relevant: pushing/merging main can deploy both Vercel and Railway. Any proposed release must enumerate that effect and receive the necessary approval. None was attempted here.

## Verification and receipts

- All ten active channels inspected; active manifest stable during the execution audit.
- Both window calculations: 20/20 current-channel comparisons agree with independent canonical results; zero missing recent account routes after complete pagination.
- Ten production brief payload hashes independently verified; their executed totals match completed current-spec cohorts.
- Shadow-scoring groups have unique position pairs; excluded/censored rows retained in the audit receipt.
- Diagnostic scripts completed; no production writes. No deployable source code was edited, so no application build/deployment is claimed. Local diff whitespace check passed.

| Artifact / identity | Receipt |
|---|---|
| Active manifest | `manifest:proposal:07c47519-ead9-5084-bde8-a0aebee13b78` |
| Manifest content hash | `sha256:37b779cc9529a8c70171debc36c4fdf6bf90c149fbf01eee929a4735cbe03c98` |
| Configuration epoch | `sha256:f8c8b71474691b6afbf20c25429d5d732af12bb1e1b9e1d35d8953f29f29efd0` |
| Activation receipt | `ef97cc03-34aa-474a-868e-e0a44817f26b` |
| Stored roster bundle | `0c7acf23-f826-545c-beb7-b77c09f9a5d1` |
| Bound original packet SHA | `7723e889932cf1a58438a428e16a3d2b4442aef9958a47211ff8391e99767fa1` |
| Canonical ledger SHA | `bfc6a22ae560397bd9d51cf162ad1a144b6f30f92216e604019f120c81e92ca9` |
| Audit JSON SHA | `e4202d92d37d528836f38817d9883cb7d8d863d96817323fe6e3a3bd69d0d936` |
| Provenance supplement SHA | `91c133d3207d5a7572e4f825489328ca9929a6467e3eaf20f2783a18e466dcf9` |

Local evidence directory: `data/roster-evidence-audit-2026-08-31-1222/` in this worktree. `audit.mjs` and `trace.mjs` are reproducible read-only diagnostics; they create exclusive local outputs and must use a fresh output directory for a new run. `canonical/receipt.json` binds the raw snapshot and ledger. `audit.json` retains position/trade IDs, omitted sets, route rows, configuration identities, and paired-shadow receipts. `trace.json` retains production briefs, packet references, shadow enrollment inventory, and ORB admission IDs.

**Final status:** completed current-roster evidence and decision-impact audit, with original tournament reproduction explicitly unresolved. NO-GO for relying on the current month leaderboard or generic “keep collecting” label to make roster decisions. NO-GO for new manager/promotional activations from this audit alone. Exact rollback/repair proposals are the next action; none is live.
