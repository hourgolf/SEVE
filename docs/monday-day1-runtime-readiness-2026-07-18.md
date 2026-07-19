# Monday Day 1 runtime readiness

Status: review-branch evidence; production unchanged by this document.

Target session: 2026-07-20. Release: `weekend-day1-2026-07-20-rc5` at configuration SHA-256
`5a4112fd5991b470aa185d8c9271a57e82b975f9999d89096b29e76b9ad64eba` and worker
`stream-2026-07-17g`.

## Current verdict

**Ready for the Monday paper session, with one expected evidence yellow.** The runtime identity, paper
boundary, account routes, six roots, capture posture, and shadow-manager posture are sealed and
startup-enforced. No Monday RC5 candidate has existed yet, so the first candidate/path/manager receipt
cannot truthfully be green before the session begins.

| Gate | State | Evidence |
| --- | --- | --- |
| Paper boundary | Green | Fund is paper, Alpaca origin is `paper-api.alpaca.markets`, `dryRun=true`, and `liveTrading=false`. |
| Worker liveness and identity | Green | Read-only preopen check observed fresh `stream-2026-07-17g`, clean, on the sealed release. |
| Release identity | Green | Latest dedicated startup receipt matches the exact RC5 release id and configuration hash. |
| Broker/desk reconciliation | Green | FIRST-TEAM, LAB, and MORGUE are distinct active paper accounts; broker and desk books are all flat. |
| Root routing | Green | All six sealed roots resolve to the correct account, underlying, stream executor, and a DB contract ceiling that supports the sealed quantity. |
| Held-path capture posture | Green, configured | Startup refuses unless capture is enabled at 12 samples / 60 seconds, bounded to 10,000 samples / 8 MiB, five attempts, five-second adapter deadline, 15-second flush deadline, and 30-second shutdown deadline. |
| Shadow manager posture | Green, configured | Startup refuses unless the observer is enabled with a 15-second quote-age ceiling; all eight preregistered arms are sealed. |
| Candidate provenance | Green, code path | The executed signal rationale carries the pre-admission candidate detail. The release-policy suite pins this requirement. |
| Sentinel next-open evidence | Yellow, classified and fixed on review branch | The frozen Friday receipt is semantically current for July 20 but lacked literal v2 `session`. A later v2 publish labeled Saturday 07-18 as `session` while its brief evidence remains Friday and its target is Monday. Explicit schema identity cannot turn a non-trading or conflicting session into green; the shared classifier and preopen gate now report `SESSION IDENTITY CONFLICT`. The publisher fix stamps `brief.asOf` (or the verified scan-through session) instead of its weekend run date on the next publish. |
| Local close publisher | Green at last close | Gate 0 recorded 21 runs, last exit code 0, and a fully green final Tier 1/2 summary at 2026-07-17 20:31:01Z. |
| First RC5 session evidence | Yellow, expected | No July 20 candidate, held path, manager scorecard, collision censor, or close receipt can exist before the cohort starts. This is an evidence wait, not a configuration gap. |

## Private data-plane cutover verification

The operator-facing database tables became private before this audit. The browser correctly reads them
through an authenticated user session and the worker correctly uses the service role, but the first
post-cutover preopen run exposed a separate local-tooling dependency: trusted Node scripts still created
anonymous clients. Those reads were denied by RLS and initially presented as false readiness blockers.

The Monday-critical trusted tooling now uses one fail-closed server-only client that requires
`SUPABASE_SERVICE_ROLE_KEY`. The helper is statically barred from the browser entry points. The corrected
boundary covers preopen, health, Sentinel query/publisher, day report and its child simulations, broker
reconciliation, held/benched/ratchet/stairstep research reads, raw quote/bar export, forensics, training
store, weekly/MFE/A6 diagnostics, and the evening digest. No service credential is copied into a public
anonymous-key variable by these paths.

Read-only post-cutover evidence:

- authoritative preopen gate: **all hard gates pass**; exact RC5 release/hash, six roots ready, 19
  historical DB-armed rows correctly dark under the release overlay, 12/60 capture and eight manager
  arms confirmed;
- production health: paper, not halted, no active flags;
- Sentinel query smoke: pass against the private data plane;
- broker/desk reconciliation: 3/3 Alpaca paper accounts reached, 466 broker OCCs, broker and desk
  realized totals both `-$43,747`, aggregate per-OCC drift `$2` versus the `$200` gate;
- full 2026-07-17 read-only day report: 66/66 closed positions rebuilt; all three account coverage
  checks clean; override, foul-out, managed-exit, benched, one-account, ratchet, and give-back sections
  completed without an RLS or child-process permission failure;
- server credential boundary self-test: 49/49 pass; TypeScript, production build, incident policy,
  market calendar, runner, and durable manager-book suites pass.

The remaining scripts that still mention the anonymous key are non-runtime historical/probe utilities.
They are not in the Monday capture or readiness chain and remain follow-up cleanup; they must not be used
as a reason to weaken RLS.

## Sealed root book

| Root | Account | Underlying | Qty | Risk budget | Premium cap | Debit cap | Manager |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `pb-ride` | FIRST-TEAM | SPY | 2 | $210 | $3.50 | $700 | -30% catastrophe / ride / 15:25 ET |
| `momo-shape` | FIRST-TEAM | SPY | 2 | $135 | $2.25 | $450 | -30% catastrophe / ride / 15:25 ET |
| `orb-qqq-trail` | FIRST-TEAM | QQQ | 2 | $180 | $3.00 | $600 | -30% catastrophe / ride / 15:25 ET |
| `breakout-alt-v3-iwm` | FIRST-TEAM | IWM | 2 | $75 | $1.25 | $250 | -30% catastrophe / ride / 15:25 ET |
| `grind-v3` | MORGUE | SPY | 2 | $105 | $1.75 | $350 | -30% catastrophe / ride / 15:25 ET |
| `orb-ustop-ctl` | MORGUE | SPY | 2 | $120 | $2.00 | $400 | -30% catastrophe / ride / 15:25 ET |

The other 62 inventory channels are dark under RC5. Nineteen of those remain armed/active in the
database for historical/operational continuity, but the release overlay suppresses them from fills.
Database `armed` is therefore not the effective Monday roster.

## Verification receipts

- release-policy refusal and startup contract: 101/101 pass;
- intraminute capture isolation: 16/16 pass;
- held-contract capture, bounds, retry, and shutdown: 93/93 pass;
- shadow manager: 17/17 pass;
- durable shadow book: 149/149 pass;
- prospective scorer and duplicate/censor rules: 41/41 pass;
- Sentinel receipt identity, freshness, and evidence-session selection: 19/19 pass;
- TypeScript and production build passed on the review branch.

## First-session proof sequence

The first eligible Monday candidate should be checked in this order without changing configuration:

1. candidate rationale has root, family, release, policy/configuration identity, admission clock, OCC,
   quote provenance, and any suppression/censor reason;
2. an authorized root fill uses quantity two and respects the root premium/debit, family, underlying,
   global, and same-OCC ceilings;
3. held capture produces the bounded exact-contract observation chain or an explicit fail-closed censor;
4. the eight manager arms share the same root path and configuration epoch rather than generating
   sibling fills;
5. close evidence preserves executable-bid basis, manager outcome, peak/giveback, and any operator
   annotation;
6. the post-close publisher finishes successfully and emits explicit Sentinel v2 `session` and
   `forDate` identity for the next open.

Absence of a trade is not a failure. A candidate without provenance, a fill outside the six-root book,
an unclassified capture gap, or pooled evidence across configuration epochs is a failure and should
block interpretation until resolved.

## Operator timing

- Before 06:30 PT Monday: run the read-only preopen gate and require all hard gates green. Sentinel may
  remain yellow only for the already-classified legacy identity omission; stale or wrong-target evidence
  is a separate warning.
- After the first candidate/fill: inspect the six first-session proof steps above without altering the
  release.
- After close: verify publisher exit, R2/Supabase receipt chains, broker/desk flatness, exact held paths,
  and scorer admission. Do not tune channels from one session; the preregistered floor is 10 independent
  opportunities across five sessions for a policy comparison.
