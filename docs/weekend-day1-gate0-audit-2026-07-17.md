# SEVE Weekend Day 1 — Frozen Gate 0 Audit

Session: 2026-07-17 ET  
Frozen: 2026-07-17T20:48:06Z  
Branch point: `aa6f4797a9189ffb20c02e7b54b0ef85e209ea4b`  
Machine receipt: `docs/weekend-day1-gate0-receipt-2026-07-17.json`  
Machine-receipt SHA-256: `967f342378922b4e8c12e1d9bef01739bde40ae014cb54dd65c56cc021c7f819`

## Gate 0 result

**PASS WITH ONE RECORDED SCHEMA YELLOW.** July 17 trading, manager, capture, R2, publisher,
reporting, and reconstruction evidence reconciles without unexplained active state or silent loss.
The final Sentinel evidence has an unambiguous session identity through `meta.date=2026-07-17` and
`meta.brief.asOf=2026-07-17`, with the correct `forDate=2026-07-20`, but it does not contain a
literal `session` field.

The primary owner accepts `date/asOf` as the deployed July 17 session contract for purposes of
freezing the existing evidence. This is not a claim that the schema is ideal. The July 17 receipt is
preserved unchanged, and a future publisher contract must add an explicit versioned `session` field.
This classified schema yellow does not create evidence-identity ambiguity and does not authorize a
configuration, migration, roster, merge, or deployment.

## Acceptance matrix

| Acceptance item | Result | Frozen evidence |
|---|---|---|
| Paper-only boundary | Pass | Fund and all three accounts report `paper`; the read-only readiness gate used `https://paper-api.alpaca.markets`. |
| Desk and broker flat | Pass | 66 July 17 positions, all closed; zero open desk rows. FIRST-TEAM, LAB, and MORGUE each had zero broker OCCs and matched zero desk OCCs at 20:40:54–20:40:56Z. |
| Broker/desk reconciliation | Pass | Broker and desk realized P&L both `-$43,747`; signed difference `$0`; sum of absolute per-OCC drift `$2`, below the `$200` gate. |
| Position evidence | Pass | 66/66 multi-contract; 66/66 with peak and trough observations; first open 13:49:02.178103Z; last close 19:16:02.729Z; day P&L `-$6,488`. |
| Manager terminality | Pass | 534 runs across all 66 positions: 528 terminal, six censored, zero active. All use `manager-shadow-book-v2` / `manager-lab-preregister-v1`, 15-second quote freshness, and a five-minute cutoff. |
| Six manager censors | Pass, classified | Exactly two each for `breakout-alt-v3-iwm`, `breakout-smart-entries-iwm`, and `vb-squeeze-break-qqq`; all are `BELL/no-stop` / `no_fresh_cutoff_bid`. |
| Censor cause | Expected provider inactivity at illiquid 0DTE cutoff | Targeted fetches continued through 19:55:38.829Z, while provider quote events for the affected contracts ended from 19:02:08.598Z through 19:53:27.869Z. This is not an observer scheduling boundary or missing final request. No midpoint, stale quote, or approximation was substituted. |
| Held-capture coverage | Pass | 20,794 receipts cover all 66 positions and 20 OCCs; 102,545 samples, 101,554 successful/eligible, and 991 explicit missing quotes. Zero request failures, invalid quotes, stale snapshots, stale quote events, gaps, dropped samples, oversize rejections, or health rows. Maximum observation interval: 11,378 ms. |
| R2 object/manifest/receipt chain | Pass | Exhaustive read-only verification of 20,794 gzip objects and 20,794 manifests: exactly 41,588 keys, zero missing or unexpected. Every compressed SHA, decompressed content SHA, gzip line count, R2 metadata hash, manifest identity, count, checksum, and source field matched. |
| Sentinel session/forDate | Yellow, classified | Event created 20:19:29.997145Z: `message=sentinel: 2026-07-17`, `date=2026-07-17`, `brief.asOf=2026-07-17`, `forDate=2026-07-20`; literal `session` absent. |
| Local capture publisher | Pass | Final summary at 20:31:01Z; every required Tier 1/2 step green. Launch job is not running, with 21 runs and last exit code 0. |
| Post-close day/forensics reports | Pass | Paper day report updated 20:05:34.419Z; combined report receipt SHA-256 `f7971644e329be9febb9dab53318435891daeafdf46b827946c7da6218df2374`. Forensics payload generated 20:27:55.178Z; SHA-256 `f33fe40e4f59373fc120556543433923ada2c4da7ac31f11ca295c553bc47841`. |
| VB reconstruction | Pass as development evidence only | 1,179 blocked `vb-* / not_armed` decisions and 139 reconstructed virtual trades across 34 channels; zero `no_quotes`; latest insert 20:08:57.625013Z. The six-round cap and synthetic entry-ask/exit-mid basis remain explicit limitations. |
| Family observations | Pass, classified | Seven observations, all sibling collisions, across `PB` and `ORB-SPY`; these are correlated groups rather than independent fills. |

## Exact evidence identity

- Deployed worker: `stream-2026-07-17a`
- Worker git SHA: `7062af3b1f007457d2dcb53953fc86b0ee996ecc`
- Railway deployment: `a3f8aa3f-0fc3-4a36-b975-f80e8abf8e57`
- Capture schema: `held-contract-opra-snapshot-v1`
- Latest database migration: `20260717061821_phase_1k_g_held_contract_capture_receipts`
- Registry bundle SHA-256: `9bd18ffc5a9c35510fc3879d3575070aa400b489d3eb036a7c28bdefced7d0d5`
- Receipt identity SHA-256: `2258d1649085c92e597145b05ce239e4c7fe0334417b3771f1b977034b7ce9d7`
- SQL receipt-chain SHA-256: `2677b91a24e882a3fc1e7fec45d88ff3b2e59c7f46d26c9c92bd29dc4625c7ac`
- R2 key:size SHA-256: `069eedce4c5e0b6736299ad664aef0f98089e97958708bedb9eaa32b3d631892`

The exhaustive R2 verifier initially reported `completedAt` differences because PostgREST rendered UTC
as `+00:00` while manifests rendered the same instant as `Z`. A follow-up at 20:48:06Z compared parsed
instants and confirmed zero substantive mismatch. No receipt was modified.

## Storage and fragmentation

July 17 held-contract storage:

- R2 gzip objects: 16,139,289 bytes
- R2 manifest objects: 33,965,189 bytes
- R2 total for the session: 50,104,478 bytes
- Supabase receipt heap: 18,972,672 bytes
- Supabase receipt indexes: 18,710,528 bytes
- Supabase receipt total: 37,724,160 bytes
- Mean segment density: 4.9315 samples per receipt

At the July 17 rate, a linear 20-session projection is approximately 754,483,200 Supabase bytes and
1,002,089,560 held-evidence R2 bytes. The current database measured 409,693,331 bytes at the Gate 0
query. Raw evidence volume is acceptable; receipt and manifest fragmentation is the immediate storage
threat and remains Gate 1's first implementation priority.

The whole R2 bucket read at 20:45:14.826Z contained 88,029 keys and 6,285,806,304 bytes. This bucket-wide
number includes other retained evidence and is not attributed solely to held-contract capture.

## Local artifact checks

- `data/sentinel/2026-07-17.md`: `b1b631f5397bc90cd548f8ee415d3d431dab02a014a4cd6169b6d5297157b3b0`
- `data/sentinel/brief-latest.json`: `642ed8ce7bafc400040e7dec6970dffcfb0a9939e1970206430de805f6305e54`
- `data/weekly-readouts/2026-07-17.txt`: `ca9a8e6f9df400ae2de0acc54c7da5b59e72b12b8e5667e609fcaab259f30af6`
- `data/quotes-archive/2026-07-17.json.gz`: `2d63e86a8fcb0b759e04843d130bfae759a3528dc9298fbbf3346ea1a23d82c0`
- SPY bars: `a5709db6c89100df09d4a160f6051272c5339270565e58e0bc999008ccb53202`
- QQQ bars: `30837e0a934344b73d776d76dd146113ef4161f17673e99217f02f20b58844c5`
- IWM bars: `231ce2ba87b072f7c17b400971f7d37d6bb204958f29c0fee8dc830f3573e056`
- Capture log at freeze: `566d27bc6bce9a41f29a9a70b92a55fbc92f3b28e926cb988a3a447860cb65fd`

## Query and inspection record

- Broker/desk reconciliation: 20:40:36–20:40:39Z
- Paper-mode and flatness gate: 20:40:54–20:40:56Z
- Fleet/config SELECT: 20:42:29.796Z
- Historical evidence SELECT: 20:43:02.270Z
- Policy-epoch SELECT: 20:43:19.518Z
- Consolidated Supabase SELECT: 20:43:26.329614Z
- R2 inventory: 20:45:14.826Z
- Exhaustive R2 verification: 20:43:05–20:47:51Z
- R2 timestamp-normalization confirmation: 20:48:06Z

Production database reads were SELECT-only. Broker and R2 inspection were read-only. No Supabase or R2
row/object was inserted, updated, deleted, relabeled, or pooled; no strategy/configuration value was
changed; no order was placed or closed; and no merge or deployment occurred.

## Gate 0 handoff

Gate 0 is frozen by this audit and its machine receipt. Safe local Gate 1 implementation may begin.
The following remain prohibited without the operator reviews named in the authoritative plan:

1. applying a database migration;
2. applying strategy or configuration changes;
3. finalizing the Monday roster;
4. merging;
5. deploying Vercel or Railway.

The Sentinel schema yellow must be addressed only through a new versioned contract; the frozen July 17
event remains immutable.
