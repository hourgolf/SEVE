export const meta = {
  name: 'vocab-applicability-audit',
  description: 'Backtest new-vocab applications (3 archetypes + 2 channel augmentations) 5-window faithful, adversarially verify, synthesize',
  phases: [
    { title: 'Backtest', detail: 'each item × 5 regime windows (+ baseline for augmentations), faithful real-NBBO' },
    { title: 'Verify', detail: 'adversarially verify any item that looks +EV / beats baseline' },
    { title: 'Synthesize', detail: 'per-item verdict + which vocab application earns a channel' },
  ],
}

const REPO = '/Users/mattlynch/seve-dashboard'
// manifest (specs written to /tmp/vocab-audit by scripts/vocab-audit-prep.ts)
const ITEMS = [
  { label: 'arch:reversal-at-level', note: 'candle reversal at OR boundary — net-new mean-reversion shape', path: '/tmp/vocab-audit/reversal-at-level.json' },
  { label: 'arch:confluence-breakout', note: 'rolling-range break + >=2 of {macd-state, sma-cross, rel_vol, strong_trend}', path: '/tmp/vocab-audit/confluence-breakout.json' },
  { label: 'arch:candle-filtered-orb', note: 'ORB break ONLY when confirmed by a strong-trend candle + rel_vol', path: '/tmp/vocab-audit/candle-filtered-orb.json' },
  { label: 'augment:V3+candle (armed edge)', path: '/tmp/vocab-audit/V3-baseline-aug.json', baseline: '/tmp/vocab-audit/V3-baseline.json', note: 'candle confirmation added to breakout-alt-v3; vs its own baseline' },
  { label: 'augment:ORB+candle (benched)', path: '/tmp/vocab-audit/ORB-baseline-aug.json', baseline: '/tmp/vocab-audit/ORB-baseline.json', note: 'candle confirmation added to orb-trend-rider; vs its own baseline' },
]
const WINDOWS = [
  { name: 'CHOP-Mar26', from: '2026-03-01', to: '2026-03-31' },
  { name: 'TREND-AprMay26', from: '2026-04-01', to: '2026-05-31' },
  { name: 'TREND-OOS-MA25', from: '2025-05-01', to: '2025-08-31' },
  { name: 'TREND-24', from: '2024-05-01', to: '2024-08-31' },
  { name: 'CHOPMIX-25-26', from: '2025-11-01', to: '2026-02-28' },
]
const FLAGS = '--source real --options databento --risk 500 --daily-stop 500 --cost-gate 3 --prem-stop 50'

const BT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['label', 'pooledPnl', 'pooledTrades', 'windows'],
  properties: {
    label: { type: 'string' },
    pooledPnl: { type: 'number' }, pooledTrades: { type: 'integer' },
    baselinePooledPnl: { type: 'number' }, baselinePooledTrades: { type: 'integer' },
    windows: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'pnl', 'trades'],
      properties: { name: { type: 'string' }, pnl: { type: 'number' }, trades: { type: 'integer' }, baselinePnl: { type: 'number' }, baselineTrades: { type: 'integer' } } } },
    note: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['label', 'verdict', 'windowsPositive', 'oneWindowCarried', 'beatsBaseline', 'reasoning'],
  properties: {
    label: { type: 'string' },
    verdict: { type: 'string', enum: ['promising', 'marginal', 'refuted'] },
    windowsPositive: { type: 'integer', description: 'count of the 5 windows with positive P&L (variant)' },
    oneWindowCarried: { type: 'boolean', description: '>60% of pooled P&L from a single window?' },
    beatsBaseline: { type: 'string', enum: ['n/a', 'yes', 'no'], description: 'for augmentations: does the variant beat the channel baseline pooled AND on most windows? n/a for archetypes' },
    reasoning: { type: 'string' },
  },
}

phase('Backtest')
log(`Auditing ${ITEMS.length} new-vocab applications × ${WINDOWS.length} windows (faithful real-NBBO, gate 3)`)
const results = (await parallel(ITEMS.map((it) => () =>
  agent(
    `Backtest one new-vocab channel candidate across 5 regime windows, faithfully. Run from a shell, one window at a time (each ~15-40s; set the Bash timeout to 300000):
  cd ${REPO} && npm run backtest -- --spec ${it.path} ${FLAGS} --from <W.from> --to <W.to>
${it.baseline ? `This is an AUGMENTATION — ALSO backtest its baseline channel (same windows + flags) for comparison:\n  cd ${REPO} && npm run backtest -- --spec ${it.baseline} ${FLAGS} --from <W.from> --to <W.to>` : 'This is a new ARCHETYPE — no baseline.'}

Windows: ${JSON.stringify(WINDOWS)}

Parse from each run's output: "Total P&L  $X (net of cost)" (NOTE the negative format is "-$X" — minus BEFORE the $) and "Trades  N (x/day)". Sum across windows for pooledPnl/pooledTrades.
Return the structured result for label "${it.label}": per-window {name, pnl, trades${it.baseline ? ', baselinePnl, baselineTrades' : ''}} + pooledPnl/pooledTrades${it.baseline ? ' + baselinePooledPnl/baselinePooledTrades' : ''}. note="${it.note}". Report only real parsed numbers; if a run errors set that window's pnl/trades to 0.`,
    { label: `bt:${it.label}`, phase: 'Backtest', schema: BT_SCHEMA }
  )
))).filter(Boolean)

phase('Verify')
// verify items that are +EV pooled (archetypes) OR beat baseline pooled (augmentations)
const toVerify = results.filter((r) => r && (r.baselinePooledPnl != null ? r.pooledPnl > r.baselinePooledPnl : r.pooledPnl > 0))
log(`${results.length} backtested; ${toVerify.length} look worth verifying`)
const verdicts = toVerify.length ? (await parallel(toVerify.map((r) => () =>
  agent(
    `Adversarially verify whether this new-vocab channel candidate is a REAL, robust edge or a mirage. Be a skeptic — the desk's history is a graveyard of refuted entry tweaks (ema-stretch, level-gate, chop-gate all died); default to skepticism. Alpha on this desk is hard-won.

CANDIDATE (faithful 5-window backtest, real NBBO, gate 3, RISK 500):
${JSON.stringify(r, null, 2)}

Judge:
- windowsPositive: how many of the 5 windows are positive (variant pnl).
- oneWindowCarried: is >60% of pooled P&L from a single window? (esp. CHOPMIX-25-26 = the desk's known no-ex-ante-signal rising-tide window, or a single trend window).
- beatsBaseline (augmentations only): does the variant beat its channel baseline POOLED *and* on ≥3/5 windows? Note: a candle filter that cuts trades 5× and lifts pooled may just be over-fitting to a few lucky trades — check trade counts. "n/a" for archetypes.
- verdict: promising (robust, +EV across ≥3 windows, not one-window-carried, augment clearly beats baseline) | marginal (real but fragile/small/one-window) | refuted (net-negative, or doesn't beat baseline, or one-window mirage).
Return the structured verdict for "${r.label}".`,
    { label: `verify:${r.label}`, phase: 'Verify', schema: VERDICT_SCHEMA }
  )
))).filter(Boolean) : []

phase('Synthesize')
const report = await agent(
  `Write the NEW-VOCAB APPLICABILITY AUDIT verdict for SEVE. Audience: the operator (sophisticated; wants the honest call). Markdown, tight.

CONTEXT: We built new channel-input vocab this session (anyOf confluence, candle shapes pin/engulfing/strong_trend/stale_extreme/curl, range_break, sma_cross, macd state-mode, custom levels). A DB check confirmed 0 of 21 live/benched channels use ANY of it (it's a toolkit, unused). This audit tested WHERE it earns a place: 3 NEW ARCHETYPES (reversal-at-level, confluence-gated breakout, candle-filtered ORB) + 2 AUGMENTATIONS (candle confirmation added to the armed V3 and the benched ORB), all faithful 5-window real-NBBO.

BACKTESTS:
${JSON.stringify(results, null, 2)}

ADVERSARIAL VERDICTS:
${JSON.stringify(verdicts, null, 2)}

Write:
1. Headline: does the new vocab earn a place anywhere — a new archetype worth a paper-lab channel, or an augmentation worth wiring? Or is it all refuted (toolkit stays on the shelf)? One sentence.
2. Per-item table: candidate · pooled P&L · windows-positive · verdict · one-line why.
3. The augmentations specifically: does adding a candle filter to V3 (armed edge) or ORB (benched) help, or does it just cut trades (over-fit)? Honest read on trade-count collapse.
4. The reversal archetype specifically: the desk has NO reversal channel and chop is its unsolved problem — did reversal-at-level show ANY life, or does it confirm directional-cleverness-for-chop is dead (the chop-router grave)?
5. Recommendation: which (if any) candidate graduates to a paper-lab/shadow channel, which to park, and the single highest-value next step.`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { coverage: '0/21 channels use new vocab (DB-confirmed)', results, verdicts, report }
