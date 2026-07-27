// Import-safe identities with no environment or external-client side effects.
//
// WORKER_VERSION is part of the sealed Day 1 strategy identity. Changing it
// changes every root's channel/configuration/policy fingerprint and therefore
// requires a separately reviewed release reseal.
export const WORKER_VERSION = "stream-2026-07-21b" as const;

// RC5.4 is a separately sealed strategy era. Keep its identity dormant until
// RC54_RELEASE_ENABLED is explicitly turned on; RC5.3 continues to stamp the
// legacy WORKER_VERSION above while it remains the active release.
export const RC54_WORKER_VERSION = "stream-2026-07-27a" as const;

// WORKER_RUNTIME_VERSION identifies the deployed process implementation. It is
// intentionally separate so an evidence-plumbing/runtime-only deploy can be
// verified in the heartbeat and run ledger without mutating sealed strategy
// provenance.
export const WORKER_RUNTIME_VERSION = "stream-runtime-2026-07-27a" as const;

export function activeWorkerVersion(rc54ReleaseEnabled: boolean): string {
  return rc54ReleaseEnabled ? RC54_WORKER_VERSION : WORKER_VERSION;
}
