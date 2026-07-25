# Monday T+1 and pre-open runbook — 2026-07-27

Status: **PREPARED · READ-ONLY / LOCAL-EVIDENCE DEFAULT**

This runbook authorizes no migration, deployment, strategy change, roster
change, Railway change, order, or production evidence write.

## 0. Non-negotiable boundaries

- Paper broker host only: `https://paper-api.alpaca.markets`.
- Current six-root release/configuration remains unchanged.
- Native, live-manager, and exact T+1 evidence remain separate.
- A missing exact result is censored; it is never estimated from snapshots,
  mids, approximate contracts, or a later quote.
- Exact results are research evidence, not a promotion or order instruction.
- Keep the exact-persistence migrations unapplied while the blockers in
  `exact-persistence-migration-review-2026-07-24.md` remain open.

## 1. Before pre-open

From a clean checkout of current `origin/main`:

```bash
git fetch origin --prune
git rev-parse origin/main
npm ci
npm run build
```

Stop if the remote hash is not the reviewed production lineage or if the build
fails.

Load the existing server-only environment locally. Do not copy service-role or
broker credentials into browser code, screenshots, chat, or logs.

Run the read-only readiness gate:

```bash
npm run preopen
```

Required:

- fund mode is `paper`;
- broker origin is exactly the paper endpoint;
- worker heartbeat is current and has no error;
- runtime/release/config hashes match the sealed release;
- every armed root, executor assignment, account, and configured limit matches;
- broker and desk books reconcile;
- no blocking failure is printed.

Warnings must be explained, not waved through. A stale or missing receipt is
not replaced by a green application poll.

## 2. At the opening bell

If the book is flat:

- confirm the dashboard says zero open;
- confirm the broker-reconciliation receipt agrees;
- do not manufacture an evidence event.

If a position opens:

```bash
npm run live-position-evidence
```

Required per open position:

- opportunity-bound decision and broker fill;
- immutable opened outcome and matching position plan;
- every expected manager arm admitted;
- observing/terminal state is explicit;
- held-contract capture is present or within its bounded initial latency;
- mark refresh remains a display input, not proof of executable exit price.

Re-run after a meaningful state transition, not continuously.

## 3. T+1 exact replay intake

First locate the canonical Friday freeze directory and inspect its receipt.
Do not use a remembered count or an unlabeled copy.

The receipt must provide:

- `sessionDateEt`;
- `freezeFileSha256`;
- `freezeCanonicalSha256`;
- the exact freeze path and contract manifest;
- `externalWrites: false`;
- `orderPathAuthorized: false`.

Set a task-specific path variable:

```bash
SEVE_FREEZE_DIR=/absolute/path/to/the/canonical/freeze
```

### 3A. Zero-network checksum plan

Run without `--estimate` or `--download`:

```bash
npm run dark-candidate-t1 -- \
  --freeze "$SEVE_FREEZE_DIR/freeze.json" \
  --expected-file-sha256 "<freezeFileSha256>" \
  --expected-canonical-sha256 "<freezeCanonicalSha256>" \
  --outdir "data/dark-candidate-t1/<sessionDateEt>"
```

Required:

- file checksum matches;
- canonical checksum matches;
- the freeze is non-empty;
- methodology is the sequential manager-specific exact replay;
- order authorization is false;
- the historical access gate time is printed.

Stop on any mismatch.

### 3B. Cost estimate

Only after the historical gate is open and provider-cost disclosure is
authorized:

```bash
npm run dark-candidate-t1 -- \
  --freeze "$SEVE_FREEZE_DIR/freeze.json" \
  --expected-file-sha256 "<freezeFileSha256>" \
  --expected-canonical-sha256 "<freezeCanonicalSha256>" \
  --outdir "data/dark-candidate-t1/<sessionDateEt>" \
  --estimate
```

Record the provider estimate. Do not download if the returned request identity,
contract count, cost, or gate time differs from the reviewed plan.

### 3C. Exact download and replay

Run only after the estimate is accepted:

```bash
npm run dark-candidate-t1 -- \
  --freeze "$SEVE_FREEZE_DIR/freeze.json" \
  --expected-file-sha256 "<freezeFileSha256>" \
  --expected-canonical-sha256 "<freezeCanonicalSha256>" \
  --outdir "data/dark-candidate-t1/<sessionDateEt>" \
  --download
```

The script is expected to:

- request only frozen exact OCC/window pairs;
- retry only bounded transient transport failures;
- resume only checksum-verified local objects;
- use last published CBBO state at or before each clock;
- keep manager-arm and sequential-overlap censors explicit;
- write local content-addressed artifacts only;
- write no Supabase or R2 receipt.

## 4. Exact replay review

Inspect `report.json` and `receipt.json`.

Pass criteria:

- `externalWrites` is false;
- `orderPathAuthorized` is false;
- `policyChangeAuthorized` is false;
- exact missing count is zero;
- every structural censor is listed;
- completed and censored manager arms reconcile to the expected arms;
- independent paths exclude overlapping re-entry clocks;
- all object and report checksums verify.

A partial or censored result is a valid evidence outcome. It is not a failed
experiment and it is not permission to weaken a guard.

## 5. Monday decision boundary

The Monday output may update the evidence ledger and UX review material. It
must not by itself:

- select a winning manager;
- change a stop, target, ratchet, or EOD rule;
- reset a root era;
- activate a prospect;
- change capital, quantity, account, or collision policy;
- apply either exact-persistence migration;
- merge or deploy the weekend UI branch.

Any of those actions requires a separate evidence review and explicit operator
authorization.
