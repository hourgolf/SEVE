# Hosted after-close research v1 — 2026-07-21

Status: implemented for review; no strategy, roster, order or position behavior changes.

## Purpose

The after-close gate-shadow pass must not depend on the operator's Mac remaining awake. The hosted
runner executes on GitHub Actions after the session archive has settled, publishes only idempotent
research rows to `virtual_trades`, and freezes its local reconstruction ledgers as a 30-day Actions
artifact.

## Schedule and boundary

- Scheduled weekdays at 21:30 UTC (17:30 ET during daylight time; 16:30 ET during standard time).
- The queried session is the current `America/New_York` calendar date.
- Exact ET-day bounds are converted to UTC with `Intl`, including 23/25-hour DST dates.
- Manual dispatch defaults to dry-run and accepts an explicit `YYYY-MM-DD` ET session.

## Required GitHub repository secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

No broker, Alpaca, Databento, R2, Railway or order credentials are present in the job.

## Outputs and safety

The job uploads:

- `data/gate-shadow.json`
- `data/vb-candidates.json`
- `data/vb-candidate-censors.json`
- `after-close-sha256.txt`

Remote publication is idempotent by `signal_id`. A failed workflow is visible in GitHub Actions and
does not authorize a configuration change, channel promotion, order, position action or release.
Exact Databento validation remains a separate T+1 gate.

For the corrected July 21 freeze, the 138 retained candidates collapse to 34 exact contracts. The
newest requested quote is 2026-07-21T19:59:02.755Z, so the strict 24-hour rolling-history gate opens at
2026-07-22T19:59:02.755Z (12:59:02.755 Pacific). The prepared validator must not download before that
instant and must stop on provider refusal, a missing exact contract, boundary failure, or quote gap.
The validator makes one bounded request per exact contract so provider responses and memory use cannot
expand into an unbounded all-session, all-contract payload.

The original later clock came from a UTC-day rather than ET-session boundary and remains documented
in `docs/july-21-research-boundary-correction-2026-07-21.md`.

## Enablement gate

The scheduled workflow becomes active only after this file reaches the default branch and both
repository secrets are configured. First enablement should be a manual dry-run, followed by an
operator-reviewed manual publication for a settled historical session before relying on the schedule.
