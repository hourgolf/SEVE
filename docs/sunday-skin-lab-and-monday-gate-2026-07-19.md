# Sunday Skin Lab and Monday gate — 2026-07-19

Status: review-branch implementation. No RC5, Railway, Supabase, R2, strategy,
configuration, order, or production mutation is authorized by this document.

## Outcome

The alternate presentation remains a sibling shell over the existing
page-owned seam. `app/page.tsx` still owns every remote hook and cross-source
derivation. The 909 workstation and the current Folio study receive the same
`SurfaceProps`, authenticated actions, incident policy, channel release
identity, position-close flow, Sentinel classification, tape model, and Ops
readiness model.

Folio is available only at `/skin-lab` in local development and Vercel preview
deployments. `VERCEL_ENV=production` fails closed with a 404. The production
root cannot select or persist Folio, and 909 remains the only production shell.

Atlas proved that a second shell could preserve the seam and full operator
surface, but it was retired after the authenticated phone pass. Folio replaces
it rather than remaining as a second dead implementation. Folio deliberately
explores a different product character: warm paper, espresso navigation, bold
mustard/coral/indigo/teal blocks, modern rounded cards, and a calmer summary
hierarchy. It is inspired by the supplied financial-app reference without
copying that app's layout or reducing SEVE to a banking use case.

The study still reuses mature workspace leaves. It evaluates whether the frame,
navigation, summary hierarchy, density, responsive composition, and visual
language can change without forking functional logic. A later skin may replace
more presentation leaves only after equivalent contracts and tests exist.

## Historical Atlas seam receipt

An authenticated read-only smoke of the now-retired Atlas shell was completed
against the Vercel preview on July 19. It remains useful evidence that the
presentation seam preserves functionality; it is not a Folio visual approval.
The in-app mobile viewport was 529×998 and the desktop override was 1440×900.

- Mobile Live, Channels, Book, Review, and Ops each rendered the shared live
  model with no horizontal overflow. Book retained broker reconciliation, open
  positions, aggregate exposure, recent exits, signals, and the option chain.
- Desktop Overview, Markets, Positions, Channels, Sentinel, Review, and Ops
  each rendered with no horizontal overflow. Markets retained seven chart
  canvases; Channels showed the 12-channel RC5-aware fleet; Ops showed the
  configured-versus-observed Day 1 evidence contract.
- Account controls, authenticated operator access, and exactly one protected
  KILL control remained present. No destructive or mutating control was used.
- Legacy Rooms mounted as the sole workspace, retained its five-room console
  and one KILL control, then returned to the lab at `/skin-lab` without overflow.
- The preview root `/` rendered the 909 workstation, not the lab presentation.
- Browser console warnings/errors: zero across the complete navigation pass.

The follow-up 390×844 phone pass also completed without horizontal overflow or
browser warnings/errors. Live retained seven chart canvases and an internally
scrollable workspace; Channels, Book, Review, and Ops each retained their own
bounded vertical scroll container. The authenticated settings/log dialog opened
and closed normally.

Atlas was closed as a design direction. At 390px, several header
controls measured only 18–28px high and the bottom navigation measured 42px
high. The shared functional seam is proven, but this presentation does not meet
the next skin's mobile ergonomics bar. Future candidates require at least 44px
primary touch targets, a clearer phone information hierarchy, and a deliberate
mobile composition rather than a compressed desktop aesthetic.

## Authenticated Folio preview receipt

The replacement was then exercised against the authenticated Vercel preview at
1440×900 and 390×844.

- Desktop Home, Markets, Book, Channels, Sentinel, Review, and Ops each selected
  the correct shared workspace with no page or display-level horizontal
  overflow. The settled live summary showed the real $985k paper NAV, -$3,884
  day result, zero positions, live process, and flat broker state.
- The desktop frame retained account selection, operator status, one protected
  KILL assembly, Legacy Rooms, the full chart, incident/session truth, Sentinel,
  Tape, and the 12-channel dock.
- Phone Home, Channels, Book, Review, and Ops each selected the correct room.
  Neither the page nor the bounded workspace overflowed horizontally.
- Phone account buttons and both header controls measured 44px high. Each of the
  five bottom-navigation controls measured 56px high.
- Browser warnings/errors: zero across both viewport passes.
- The production-target guard returned HTTP 200 for `/` and HTTP 404 for
  `/skin-lab` from the built artifact.

This receipt establishes functional and responsive eligibility for design
review. It does not constitute visual approval or authorize production use.

## Native Folio Home/Live slice

After the shell direction was accepted for continued exploration, Home/Live was
recomposed as the first native Folio functional workspace. It no longer mounts
the old PERFORM overview as one dark inherited panel. The new composition keeps
the exact shared chart, authenticated position-close controller, channel-mute
controller, incident policy, Sentinel digest, event tape, and account-scoped
roster while changing only their hierarchy and presentation.

- Desktop uses one focused dark market card, light health/position/Sentinel/
  activity cards, and a subordinate channel drawer.
- Phone retains the chart as a primary tool but reveals the Open Positions card
  below it, making the vertical workflow discoverable. Sentinel and Activity
  remain reachable in the same bounded scroll container.
- The collapsed phone channel drawer is 59px high; expanded content is capped at
  42% of viewport height and does not overflow horizontally.
- At 1440×900 and 390×844, the page and native workspace had no horizontal
  overflow. All chart instrument, range, interval, and indicator controls
  remained available. Browser warnings/errors were zero.
- Manual close and post-close rationale still use `usePositionCloseFlow`; mute
  still uses the existing desk dispatch/write controller. No skin-owned fetch,
  subscription, or mutation path was introduced.

Markets, Book, Channels, Sentinel, Review, and Ops continue to use the mature
shared leaves. The next native slices should be Book and Channels because they
contain the highest-value operator actions and evidence context.

## Skin Lab acceptance

- one set of page-owned hooks regardless of shell;
- no skin-owned fetch or subscription;
- no new mutation path;
- 909 remains `/` and Folio remains preview/local `/skin-lab`;
- desktop exposes Overview, Markets, Positions, Channels, Sentinel, Review,
  Ops, Legacy Rooms, operator access, and KILL;
- mobile exposes Live, Channels, Book, Review, Ops, account selection,
  settings/auth, and KILL;
- mobile primary actions are at least 44px and bottom navigation controls are
  at least 56px high;
- desktop and mobile use deliberate, independently composed card hierarchies
  rather than compressing the 909 workstation;
- all workspaces remain usable without horizontal page overflow and the browser
  console remains free of warnings and errors;
- loading, empty, error, stale, unreconciled, and incident states remain the
  shared model's states rather than presentation guesses;
- production build includes a fail-closed route guard.

## Monday gate remains separate

The Skin Lab does not change the sealed release. Before 06:30 PT on July 20,
run the existing authoritative read-only gate from latest `origin/main`:

```sh
npm run preopen
```

Require green for the paper boundary, release ID/hash, worker/run ledger,
account routing and broker/desk reconciliation, six roots, 12/60 held capture,
eight shadow-manager arms, Sentinel session/forDate, and local publisher
readiness. The absence of a first RC5 candidate/fill remains an expected yellow
before the cohort begins. Do not tune configuration during the check.

## Monday proof order

1. Confirm the first candidate's release, family, configuration, admission,
   OCC, source-bar, and quote provenance.
2. Confirm any fill belongs to one of the six roots, uses quantity two, and
   respects premium/debit/family/global limits.
3. Confirm bounded exact-contract capture or an explicit censor.
4. Confirm all eight manager arms share the native root path.
5. Confirm collision and dark-channel opportunities retain reasons/clocks.
6. If a natural paper position is closed manually, verify authenticated reason,
   broker result, desk state, and outcome partition.
7. After close, require flat books, successful publisher exit, object/manifest
   integrity, next-session Sentinel identity, and a non-pooled Day 1 scorecard.

## Promotion boundary

Folio is not eligible for a production selector until its authenticated desktop
and phone drills pass against the same functional checklist as 909 and the
visual direction is explicitly accepted. Monday runtime evidence takes priority
over aesthetic promotion. Skin work may continue on review branches because it
cannot alter the sealed release.
