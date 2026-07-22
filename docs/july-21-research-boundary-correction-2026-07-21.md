# July 21 research boundary correction

Status: corrected SELECT-only freeze complete. The original July 21 receipt remains preserved as
historical evidence; this receipt supersedes only its virtual session-close paths and downstream
exact-candidate checksum. No Supabase/R2 write, migration, order, position, release, roster, risk,
quantity or strategy setting was changed.

## Defect and correction

`gate-shadow` bounded option quotes with `YYYY-MM-DDT23:59:59Z`. That is a UTC-day boundary, not a
New York regular-session boundary. On July 21 it admitted quotes through 19:59 ET and allowed eight
untriggered virtual trades to flatten one hour after the 16:00 ET close.

The path now ends exclusively at `sessionCloseMin(sessionDateEt)`, converted through
`America/New_York` with `Intl`. It is DST-correct and honors maintained 13:00 ET early closes. The
same helper is pinned by summer, winter, DST and early-close tests.

## Corrected freeze

The isolated replay used:

```text
npm run gate-shadow -- --session 2026-07-21 --read-only --output-dir <isolated-dir>
```

Results:

- 152/152 distinct virtual trades rebuilt;
- 138/138 versioned exact-candidate receipts retained;
- zero fail-closed candidate censors;
- zero virtual exits at or after `2026-07-21T20:00:00Z`;
- latest virtual exit `2026-07-21T19:59:01.654686Z` (15:59:01 ET);
- corrected aggregate `-$358/contract` on the existing capital-blind, mid-basis diagnostic;
- corrected exact request end `2026-07-21T19:59:02.755Z`;
- strict T+1 gate `2026-07-22T19:59:02.755Z` (12:59:02.755 Pacific).

Corrected SHA-256 values:

- native virtual-trade ledger: `e0991e660956fddb23ad7fb5aabe48e5c1289c4201166fc65ff2a285e08905af`;
- candidate receipts: `1e4801f9d7ac27869ceaedc573d41a29d141dfa0cab03f6249255a3de1763cdb`;
- candidate censors: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.

The original recorded candidate and virtual-ledger hashes remain in
`docs/day1-after-close-2026-07-21.md`; they are not deleted or silently relabeled.

## Rows whose native flatten changed

| Channel | Original exit | Corrected exit | Original $/ct | Corrected $/ct |
| --- | --- | --- | ---: | ---: |
| `orb-ustop-ctl` | 20:59:01Z | 19:59:01Z | +27.00 | +21.00 |
| `orb-ustop` | 20:59:01Z | 19:59:01Z | +27.00 | +21.00 |
| `momo-shape` | 20:59:01Z | 19:59:01Z | +6.00 | 0.00 |
| `grind-v3-2` | 20:59:01Z | 19:59:01Z | -62.50 | -57.50 |
| `pb-ride-itm` | 20:59:01Z | 19:59:01Z | -28.50 | -30.00 |
| `power` | 20:59:01Z | 19:59:01Z | -19.00 | -21.50 |
| `power-smart-entries` | 20:59:01Z | 19:59:01Z | -19.00 | -21.50 |
| `power-final30` | 20:59:01Z | 19:59:01Z | -4.50 | +0.50 |

These corrections remain research-only and do not change Wednesday RC5.3 behavior.
