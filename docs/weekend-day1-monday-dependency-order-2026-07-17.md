# Weekend Day 1 — Monday critical path

Status: dependency map only. No migration, configuration, seal, merge, push, or deployment is authorized.

| Item | Required before Monday capture | Safely deferrable to T+1 | Research-only | Requires migration | Requires Railway deployment | Requires operator configuration ratification |
|---|---:|---:|---:|---:|---:|---:|
| Future candidate provenance stamps in `signals.rationale` | yes | no | no | no | **yes** | no |
| Gate 1 held-capture deadlines and ratified 12/60 batching | yes, if held capture is enabled Monday | no | no | no | **yes** | ratified; production untouched |
| Root roster, quantities, premium/debit bounds, stops, EOD, collision caps | yes for proposed root execution | no | no | no | **yes** | ratified; application still stopped |
| Day 1 canonical receipt | yes before any configuration application | no | governance | no | no | seal prepared only after final verification |
| Gate 2 candidate/exact-path receipt tables | no | **yes** | research evidence | **yes** | no | no |
| Databento exact-path download, parser, canonical object, manifest, scorecard | no | **yes** | **yes** | no for local zero-write work | no | no |
| R2 exact-path publisher and Supabase compact receipt insert | no | **yes** | research evidence | **yes, first** | publisher deploy later | separate publication approval |
| Prospective opportunity-clustered scorer | no | **yes** | **yes** | no | no | 10 clocks / five sessions ratified |

## Direct answer on the Gate 2 dependency

**Yes. Monday can durably collect candidate provenance in the existing `signals` ledger before the Gate 2
receipt migration and exact-path publisher exist.** The existing `signals.rationale` JSON can retain the
source-bar clock, decision-observation clock, exact OCC, underlying/side, strategist/account, channel and
configuration identities, manager version, worker `source_version`, and the explicitly non-exact live ask.
That requires the corrected worker stamping code to be deployed before capture; it does not require a new
table.

T+1 can then read those immutable signal facts, request the exact OCC/window, build the versioned exact-path
object, and score it locally. What cannot happen before the migration is durable publication of the compact
candidate/exact-path receipts to their proposed tables. Missing Monday rationale fields cannot be recreated
from `signals.created_at` or an approximate quote later, so the worker provenance deployment is the hard
capture dependency while the receipt migration and publisher are not.
