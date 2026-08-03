# 2026-08-03 production recovery

Production paper execution was contained after valid broker fills exposed two evidence-persistence defects:

- configuration-epoch validation recognized legacy activation receipts but not active roster-bundle receipts;
- position-route evidence rejected the governed SHA-256 configuration epoch as though it were a UUID.

PR #51 repairs both paths and adds regressions. The database migration was applied transactionally before the worker release. During rollout, entry admission remained contained by account disarm and then by the global fund halt so the sealed worker could restart with its governed account roster armed.

This marker records the deliberate worker redeploy after containment was switched to the global halt. New entries remain prohibited until the fresh worker boot, immutable route evidence, broker/desk congruence, and operational readiness are verified.
