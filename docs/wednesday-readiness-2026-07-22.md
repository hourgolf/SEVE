# Wednesday readiness — 2026-07-22

Status: prepared from `main@d14959969d76a67898bc2ba50424a54d6f26d7ba`. Paper-only release
behavior is unchanged. No roster, strategy, risk, quantity, broker, order, Supabase schema/data, R2,
or Railway worker change is part of this handoff.

## What landed Tuesday night

- Sentinel next-open classification is on `main`. A receipt that was current for the prior open can
  no longer remain green merely because it was recently published.
- The research-only family exact-replay bridge is on `main`. It joins a signed paper-root receipt or
  frozen dark candidate to exact Databento ask-to-bid manager paths and fails closed on missing or
  conflicting evidence.
- The Mac-independent morning Sentinel workflow and after-close research workflow are both present
  on the default branch and use GitHub-hosted runners.

## Wednesday pre-open gates

| Gate | Expected state before the publisher | Required state after the publisher |
| --- | --- | --- |
| Production web | available | available |
| Auth surface | password-gated operator session available | unchanged |
| Trading mode | Alpaca paper only | Alpaca paper only |
| Release | `weekend-day1-2026-07-21-rc5.3` with sealed configuration hash | exact match |
| Worker | current run ledger and process heartbeat fresh | fresh |
| Accounts | all three bound paper accounts reachable and distinct | reconciled |
| Positions | desk and broker counts agree | reconciled |
| Roots | six sealed paper roots; all other rows suppressed/dark | exact match |
| Capture | held-contract capture bounded at 12 samples / 60 seconds | ready |
| Manager observer | eight common arms remain observation-only | ready |
| Sentinel | stale-for-next-open is truthful before publication | current partial or richer receipt |

The first successful hosted invocation must write exactly one idempotent
`morning-publisher: start` → Sentinel → `morning-publisher: finish` chain for evidence session
`2026-07-21` and target session `2026-07-22`. The hosted receipt may remain yellow because it is
truthfully partial; yellow is not a worker-down claim. A later seasonal retry must no-op rather than
duplicate the receipt.

## What is deliberately unfinished

These are not Wednesday entry blockers:

1. **Rich hosted Sentinel.** The hosted publisher does not recreate the Mac-only terrain, IV/dealer
   inputs, or interpretive opportunity scan. The deterministic partial receipt is the honest remote
   fallback. Replacing the old Claude interpretation with a versioned Codex-owned analysis contract
   is a separate after-close build.
2. **First exact family replay.** July 21's 138 retained candidates collapse to 34 exact contracts.
   The corrected strict rolling-history gate opens at `2026-07-22T19:59:02.755Z` (12:59:02.755 Pacific). The runner
   must stop on provider refusal, missing contracts, checksum failure, boundary gaps, or failed
   identity joins.
3. **Exit-policy evidence floor.** One session is insufficient. Manager selection requires at least
   ten independent opportunities and five independent sessions per eligible comparison. No Tuesday
   result changes Wednesday policy.
4. **Full dashboard completion.** Remaining 909/Folio polish, deeper channel passports, and eventual
   Legacy Rooms retirement are product work, not trading-readiness gates.
5. **Supabase cost floor.** Query and egress reductions remain a continuing operational objective.
   They must be measured from new usage, not mixed into a pre-open strategy release.

## Wednesday operating rule

Keep RC5.3 and the six-root paper roster unchanged. Missing broker truth, a stale worker, a release
identity mismatch, an unreconciled open book, or a failed capture/observer prerequisite blocks new
entries and remains visible. Stale or partial Sentinel evidence is yellow/red research context; it
does not by itself assert that the executor is down.

## After-close order of work

1. Reconcile every paper position and all eight manager arms.
2. Verify held-contract capture gaps, drops, content hashes, and broker/desk agreement.
3. Inspect the hosted after-close artifact and candidate checksum ledger.
4. At the exact provider gate, run the family replay locally and preserve every censor.
5. Add the session to the prospective evidence ledger without pooling siblings or policy eras.
6. Continue Supabase query/egress profiling and the Codex-owned Sentinel design as separate slices.
