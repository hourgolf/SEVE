# Dirty Dashboard verification receipt — 2026-08-20

- Generated: `2026-08-20T21:56:31Z`
- Base: origin/main `495eb172cfdd204225d5867958cd70196cbebb54`
- Branch: `codex/dirty-dashboard-trust-2026-08-20`
- Worktree: `/private/tmp/seve-dirty-dashboard-20260820`
- Production writes: `0`
- Order/configuration/roster/manager/sizing authority: `false`
- Migration or schedule changes: `0`
- Push/merge/deploy/publication: `not performed`

## Automated verification

- `npx tsc --noEmit` — PASS
- `npm run build` — PASS
- `npm run shadow-research-selftest` — PASS
- `npm run decision-atlas-selftest` — PASS
- `npm run decision-atlas-preview-selftest` — PASS
- `npm run channel-decision-briefs-selftest` — PASS
- `npm run ui-clarity-selftest` — PASS
- `npx tsx lib/research/channelEvidenceScope.selftest.ts` — PASS
- `npx tsx lib/research/channelLineup.selftest.ts` — PASS
- `git diff --check` — PASS

## Acceptance coverage

- ORB `1s / 2`, executed `23s / 46`, structural `28s / 60`, and virtual
  `28s / 83` source boundaries — PASS fixture/selftest.
- VB ledger `137` versus Atlas `197` count explanation — PASS selftest.
- Receipt-only churn, genuine entry reset, manager-only entry retention,
  quantity-only per-contract retention, capacity portfolio-era boundary — PASS.
- Five-session/ten-opportunity maturity, stale/tiny suppression, exit leak,
  weak entry, consistently negative, and fragile loss-tail groups — PASS.
- Persistent virtual/executed/Atlas/manager/capacity source identity — PASS.
- Entry → Finish uses observed typical final return, not reconstructed capture — PASS.
- Below-entry finishes retain 0%; favorable move cannot display below zero — PASS.
- Older briefs without a same-cohort distribution cannot lead a comparable
  fleet conclusion or actionable next step — PASS authenticated regression.
- Inline selected-row placement — PASS static regression.

## Visual verification

- 1440×900 blackout — PASS
- 1280×720 cream — PASS
- 820×1180 tablet — PASS, no horizontal overflow
- 390×844 mobile portrait, cream + blackout — PASS, no horizontal overflow
- Browser zoom — 100%
- Empty/low/stale/fragile/established behavior — deterministic fixture/selftest
- Executed-only/virtual-only/conflicting-source behavior — component/selftest
- Authenticated SELECT-only live-data view after market close — PASS. Research
  loaded 87 virtual paths through 2026-08-20; the real `orb-ustop-ctl` Inspector
  exposed and correctly explained its current-versus-Atlas count boundary.
- Desktop 1440×1000 cream + blackout — PASS.
- Tablet 820×1180 cream — PASS.
- Mobile 390×844 cream — PASS; the ATLAS tab and inline Channel Inspector remain
  available without horizontal overflow.
- Existing production briefs through 2026-08-19 predate the new
  `decisionDistribution` field. Comparable fleet conclusions are deliberately
  withheld and labeled `BRIEF NEEDS REFRESH` until a separately authorized
  research publication regenerates them.

## Screenshot hashes

- `after-desktop-1280-cream.png` — `b1d96e5390c1f977e5cde6418552717f2924015848588975c1c83242e8f023d7`
- `after-desktop-1440-blackout.png` — `f35d8166c351aabb0559cbed6f8cad333d80f0b4f546059571d29234df001bd4`
- `after-mobile-390-blackout.png` — `318d128f7c990a77d824daa2b405a18d7d7a5b6def128472a8b139874290a6c4`
- `after-mobile-390-cream-decision.png` — `418f6929d0923e06b34cf521ad2408efaa21f364d8c12d78d566ddfd9825aac5`
- `authenticated-research-current-desktop-1440x1000.png` — `499c06207a872807a828c5021acf75e70ce2f58d31125dc88ed342b959889352`
- `authenticated-research-mobile-390x844.png` — `dda7e6cf6cf27fae9afd8adbe2176e5ef61e43b92eaa714d8a150a71bc12779a`
- `authenticated-orb-inspector-desktop-1440x1000.png` — `529240fdefb7e866283fb169879d31ed6a6da33addcea7dc04ff80656b84deb5`
- `authenticated-orb-inspector-blackout-1440x1000.png` — `330015df9e4af2108eed86909e0ccc9f1d9ae4910e6a36f66d4cc0b17048ff83`
- `authenticated-orb-inspector-tablet-820x1180.png` — `16618eb99261e15b46e33120a76ef1b44017c03af81d37dfb892670a27653183`
- `authenticated-orb-inspector-mobile-390x844.png` — `3e12b4892da7640f264128354277290ce06397f47639a4302719154c6be58e12`

Separate operator approval is required before push, merge, deploy, schedule
activation, or production research publication.
