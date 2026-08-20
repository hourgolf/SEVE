# Dirty Dashboard visual QA — 2026-08-20

Before references supplied by the operator:

- `/var/folders/5x/8shxg2kd6lj0c2qhdn_bd0000000gn/T/codex-clipboard-6de050a6-3e20-4b46-bfd4-7b6012157d6c.png`
  — an exact-current `1s / 2` cohort presented as if it described the whole
  ORB evidence history.
- `/var/folders/5x/8shxg2kd6lj0c2qhdn_bd0000000gn/T/codex-clipboard-6ed9df9e-78a4-4bca-a286-f45b0af1c26b.png`
  — a virtual ledger requiring the operator to reconcile maturity, source,
  tails, and Atlas counts mentally.

After captures on this branch:

- `after-desktop-1280-cream.png`
- `after-desktop-1440-blackout.png`
- `after-mobile-390-cream-decision.png`
- `after-mobile-390-blackout.png`

All captures are at browser zoom 100%. Browser checks also covered 820×1180
tablet and confirmed no page, map, or decision-card horizontal overflow.

The protected local desk correctly stopped at operator authentication. The
captures use SEVE's non-production fixture lane, which performs zero live reads
and zero writes. Authenticated live-data QA remains an explicit separate gate;
it is not represented as completed by these fixture images.
