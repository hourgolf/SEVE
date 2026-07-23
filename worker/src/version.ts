// Import-safe identities with no environment or external-client side effects.
//
// WORKER_VERSION is part of the sealed Day 1 strategy identity. Changing it
// changes every root's channel/configuration/policy fingerprint and therefore
// requires a separately reviewed release reseal.
export const WORKER_VERSION = "stream-2026-07-21b" as const;

// WORKER_RUNTIME_VERSION identifies the deployed process implementation. It is
// intentionally separate so an evidence-plumbing/runtime-only deploy can be
// verified in the heartbeat and run ledger without mutating sealed strategy
// provenance.
export const WORKER_RUNTIME_VERSION = "stream-runtime-2026-07-22b" as const;
