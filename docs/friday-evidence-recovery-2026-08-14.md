# Friday evidence recovery — 2026-08-14

Status: canonical shadow ledger repaired and independently verified; exact OPRA scoring is queued for the provider's T+1 boundary on Saturday.

## Canonical shadow result

- 91 manifest-bound virtual paths were reconstructed for the Friday session.
- Six legacy, configuration-unstamped payloads differed from the current source-bound reconstruction. The bounded reconciler updated only those six rows and verified all six readbacks.
- One earlier `pb-ride` row remains in `virtual_trades` outside the current sequential-walk manifest. It was preserved, reported as unscoped, and excluded from the current-run payload hash. No row was deleted.
- Local and scoped-remote hashes now match: `sha256:e9b4e894c5529443411d0462796115a439b8ad3f8cbb84786ec4aeda0197e32f`.
- Write boundary: `virtual_trades` only; zero inserts, zero deletes, zero event writes, zero provenance changes, and no order or configuration authority.

## Exact Friday scope

- 975 signal decisions and 975 execution observations joined into 975 validated raw decisions.
- Zero eligible decisions were censored by the freezer.
- The decisions deduplicated to 28 exact option contracts and at most 647,063 one-second rows.
- Freeze hash: `795e8247bcd755c001ca6cd2f719c761dfd98ecbbd3947d32797048fc3b9be3d`.
- The provider correctly refused download before `2026-08-15T19:57:04.854Z`. No exact research row or R2 object was written by the premature attempt.

## Clean Atlas refresh

- 68 channel dossiers rebuilt through 2026-08-14.
- 7,339 logical opportunities; overlapping runner/polling rows remain collapsed.
- Atlas hash: `sha256:f06104d4b8661ebb26ec5db03fb798e36f62b2bcc129e3b72a05c321eec4b7c3`.
- 68 concise dashboard briefs published and 68 independently read back.
- Dashboard publication wrote only `decision_atlas_channel_reports`; event inserts and trading/configuration authority remained zero.

## Permanent prevention

- The shared `virtual_trades` table is now verified against the run's manifest-bound subset. Rows from other historical publishers are preserved and explicitly reported instead of being mislabeled as corrupt extras.
- A verifier failure no longer prevents current candidate capture or prior-session exact scoring. The job still ends failed after preserving all downstream research artifacts, so the integrity blocker remains visible.
- A Saturday 21:30 UTC research-only job scores Friday after the T+1 archive gate, rebuilds the Atlas, and refreshes the same concise briefs. Manual dry runs cannot publish.

No roster, account, sizing, manager, entry, exit, order, position, routing, broker, or worker behavior changed in this recovery.
