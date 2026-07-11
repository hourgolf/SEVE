# PERFORM/STUDIO rebuild — build spec (Fable weekend Mission 2, approved 2026-07-10)

**Status: GO — operator approved 2026-07-10 evening.** The desktop and mobile re-imagining is
design-frozen in `mocks/perform-2026-07/`. **`perform-mock-F-final.html` is the desktop spec;
`mobile-reimagined-gallery.html` is the mobile spec.** (A/B/C = the competing round-1 mocks,
D = the unified skin-toggle round, E = superseded studio-evocation round — archive, not spec.)

## Operator rulings (locked — do not relitigate)
1. TWO MODES, one instrument: **STUDIO** (tune: channel rack + inspector + master/tape + registry
   band) ⇄ **PERFORM** (watch: chart hero ~65% + right rail positions/sentinel/tape + chicklet dock).
2. **Frame toggle is GLOBAL**: BLACKOUT ⇄ CREAM skins the chrome in BOTH modes (`F` key + top-bar
   switch, persisted). Interior panels are dark glass in all four states.
3. STUDIO is **re-imagined in PERFORM's language** — NOT the current one-page skeuomorph.
4. **Readability outranks density**: fluid type (clamp), no numeric data below ~13px at 1440;
   silkscreen micro-type for labels only. Default readable; `D` = opt-in compact.
5. Mobile: tab bar = **STUDIO · COMMAND (center cream pad) · PERFORM**; Live/Desk/Mix retired.
   **Horizontal RISK fader OK. The 11-channel dock takes 2 ROWS** (not horizontal scroll).
   KILL on phone = hold-2s in the COMMAND sheet.
6. ⌘K COMMAND palette = the cream hardware module (from mock C's lineage), works over both rooms.

## Constraints (unchanged desk law)
- Data seam intact: hooks (`useMarketData` / `useDeskState` / `useDeskFeed`) called ONCE in
  `Surface`; components stay props-driven. No new deps; plain CSS; no chart libs beyond the
  existing lightweight-charts exception.
- Writes = existing `dispatch(SET_CONFIG)` + `persistConfig`, RLS-gated (`canWrite`); anon =
  read-only everywhere (pills/dials render static).
- Never ellipsize slugs. pk·win vocabulary as shipped in §04 v2. KILL = FLATTEN wording.
- **No functionality loss**: the legacy §01–§04 rooms (chain/ContractDetail, autopsy, shadow book,
  brief, P&L panels) remain reachable until each is natively migrated — initial build keeps them
  as scrollable sections inside STUDIO below the rack (anchor chips + ⌘K jump), exactly as today.
  Migrating them into the new language is FOLLOW-ON work, not this build.
- Parallel sessions share the repo: stage scoped, never `git add -A`.
- `color-scheme` handling for cream chrome (the preview rasterizer force-darkens light pages —
  verify cream via DOM computed styles, not pane screenshots).

## Slice map (build order; Opus builds, Fable reviews each diff + verifies in browser)
- **S1 — shell + tokens + state**: shared top bar (LED spot / day P&L / NAV / RUN·PAPER / KILL /
  clock / mode + frame switches / ⌘K + D affordances), `data-mode` + `data-skin` on the root
  (localStorage-persisted), the `--hw-*` skinnable hardware tokens + fluid type scale, keyboard
  map (S/F/D/⌘K/P). Desktop `Surface` branches mode under the one shell.
- **S2 — PERFORM surface**: chart hero (reuse `IntradayChart` + SENT ladder overlay + entry
  markers), right rail (positions w/ pk + ratchet badges · sentinel verdict chip + step-pad
  promote bar · live tape), dock chicklets (slug color · day P&L · pk·win · mute), pop-out (P).
- **S3 — STUDIO surface**: channel rack rows (LOCK/RIDE pair-writes, FIRES pills, to-scale shape
  bar w/ drag, STOP/day + RISK dials w/ LED arcs, M/B pads, day P&L) + selected-channel inspector
  (executor/DTE/strike/u-stop w/ uS·off flag/max-contracts/pyramid/event-policy/giveback-trail/
  lifecycle) + master strip + 2×8 session tape + registry A-test band (data: static-lite from a
  small config first; live wiring is follow-on). Legacy sections mount below.
- **S4 — ⌘K COMMAND palette**: command registry (mute/boost per channel, mode/frame/density,
  jumps, KILL w/ armed-hold row), auth-gated writes, cream module styling, both rooms.
- **S5 — mobile rework**: 3-pad tab bar, PERFORM single scroll, STUDIO accordion rack (one inline
  inspector), COMMAND bottom sheet (hold-2s KILL), 2-row chicklet dock, horizontal RISK fader.
- **S6 — polish + docs**: CLAUDE.md UI sections rewrite, memory update, screenshots.

Per-slice gate: `npx tsc --noEmit` + `npm run build` clean + browser verification (desktop 1440
& 2560, mobile 390) + Fable design-fidelity pass against mock F / the gallery before commit.
