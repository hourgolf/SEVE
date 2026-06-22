export const meta = {
  name: 'discover-levels-sweep',
  description: 'Phase B: sweep discovered-levels params × 5 windows, adversarially verify, verdict',
  phases: [
    { title: 'Sweep', detail: 'run the config grid (LEVELS=discovered|split + params) across 5 windows' },
    { title: 'Verify', detail: 'adversarially verify every config that beats the −$10.4k baseline' },
    { title: 'Synthesize', detail: 'keep-or-park verdict with honest framing' },
  ],
}

// ── Known anchors from this session (same harness; do not re-run) ─────────────
// Per-window NBBO P&L. baseline = LEVELS=warmup (−$10,425); the sweep is judged vs it.
const WINDOWS = ['2024-TREND', '2025-TREND-OOS', 'CHOPMIX-25-26', 'MAR26-CHOP', 'APRMAY26-TREND']
const BASELINE = { total: -10425, windows: { '2024-TREND': -2765, '2025-TREND-OOS': -16190, 'CHOPMIX-25-26': 7775, 'MAR26-CHOP': -1360, 'APRMAY26-TREND': 2115 } }
const DISCOVERED = { total: -16020, windows: { '2024-TREND': 3645, '2025-TREND-OOS': -15855, 'CHOPMIX-25-26': 40, 'MAR26-CHOP': -1660, 'APRMAY26-TREND': -2190 } }
const SPLIT_TOTAL = -6005 // split default already beat both; the sweep gets its full per-window breakdown

// ── The config grid (focused around the split winner) ────────────────────────
const GRID = [
  { label: 'split_default',          env: 'LEVELS=split' },
  { label: 'split_edge0.5',          env: 'LEVELS=split EDGE_PROX=0.5' },
  { label: 'split_edge1.5',          env: 'LEVELS=split EDGE_PROX=1.5' },
  { label: 'split_edge2.0',          env: 'LEVELS=split EDGE_PROX=2.0' },
  { label: 'split_top8',             env: 'LEVELS=split TOP_N=8' },
  { label: 'split_top24',            env: 'LEVELS=split TOP_N=24' },
  { label: 'split_top32',            env: 'LEVELS=split TOP_N=32' },
  { label: 'split_near20',           env: 'LEVELS=split NEAR=20' },
  { label: 'split_near50',           env: 'LEVELS=split NEAR=50' },
  { label: 'split_bin0.10',          env: 'LEVELS=split BIN=0.10' },
  { label: 'split_bin0.50',          env: 'LEVELS=split BIN=0.50' },
  { label: 'split_hl6',              env: 'LEVELS=split HALFLIFE=6' },
  { label: 'split_hl24',             env: 'LEVELS=split HALFLIFE=24' },
  { label: 'split_look15',           env: 'LEVELS=split LOOKBACK=15' },
  { label: 'split_look60',           env: 'LEVELS=split LOOKBACK=60' },
  { label: 'split_swing5',           env: 'LEVELS=split SWING_WIN=5' },
  { label: 'split_swing12',          env: 'LEVELS=split SWING_WIN=12' },
  { label: 'split_edge1.5_top24',    env: 'LEVELS=split EDGE_PROX=1.5 TOP_N=24' },
  { label: 'disc_prox1.5',           env: 'LEVELS=discovered LEVEL_PROX=1.5 EDGE_PROX=1.5' },
  { label: 'disc_prox2.0_top24',     env: 'LEVELS=discovered LEVEL_PROX=2.0 EDGE_PROX=2.0 TOP_N=24' },
]

const REPO = '/Users/mattlynch/seve-dashboard'
const CFG_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['label', 'env', 'totalNbbo', 'totalKit', 'totalTrades', 'windows'],
        properties: {
          label: { type: 'string' }, env: { type: 'string' },
          totalNbbo: { type: 'number' }, totalKit: { type: 'number' }, totalTrades: { type: 'number' },
          error: { type: 'string' },
          windows: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['name', 'nbbo', 'kit', 'trades', 'winPct', 'revT', 'revPnl', 'brkT', 'brkPnl'],
              properties: {
                name: { type: 'string' }, nbbo: { type: 'number' }, kit: { type: 'number' },
                trades: { type: 'number' }, winPct: { type: 'number' },
                revT: { type: 'number' }, revPnl: { type: 'number' },
                brkT: { type: 'number' }, brkPnl: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['label', 'totalDelta', 'windowsBeatingBaseline', 'looSurvives', 'oneWindowCarried', 'eraArtifactRisk', 'stillNetNegative', 'plateau', 'verdict', 'reasoning'],
  properties: {
    label: { type: 'string' },
    totalDelta: { type: 'number', description: 'config NBBO total − baseline (−10425). positive = beats baseline' },
    windowsBeatingBaseline: { type: 'integer', description: 'count (0-5) of windows where config NBBO > baseline NBBO' },
    looSurvives: { type: 'boolean', description: 'leave-one-out: drop the single best-delta window — does the remaining 4-window sum still beat baseline on those 4?' },
    oneWindowCarried: { type: 'boolean', description: 'true if >60% of the total improvement comes from one window (esp. 2024-TREND or the CHOPMIX fluke)' },
    eraArtifactRisk: { type: 'string', enum: ['low', 'medium', 'high'], description: 'gain concentrated in oldest 2024 window vs 2025-26 = IEX market-share-drift suspicion' },
    stillNetNegative: { type: 'boolean', description: 'is the config total still < 0 (beating baseline but not actually profitable)?' },
    plateau: { type: 'boolean', description: 'do neighboring grid configs also beat baseline (robust region) vs a lone spike?' },
    verdict: { type: 'string', enum: ['keep', 'marginal', 'park'] },
    reasoning: { type: 'string' },
  },
}

// ── Phase 1: Sweep (parallel batches of 4 configs) ───────────────────────────
phase('Sweep')
log(`Sweeping ${GRID.length} configs across ${WINDOWS.length} windows vs baseline −$10,425`)
const BATCH = 4
const batches = []
for (let i = 0; i < GRID.length; i += BATCH) batches.push(GRID.slice(i, i + BATCH))

const sweepBatches = await parallel(batches.map((batch, bi) => () =>
  agent(
    `You are a deterministic backtest runner. Run each config below and parse phase2's stdout.

For EACH config, run this from a shell (one config at a time):
  cd ${REPO} && <ENV> NO_ARTIFACTS=1 npx tsx engine/nakamoto/phase2.ts 2>&1 | tail -16
where <ENV> is the config's env string (e.g. \`LEVELS=split EDGE_PROX=1.5\`). Each run takes ~1-3 min, so set the Bash tool timeout to 300000 (5 min) on every run call. Run configs one at a time (sequentially within your batch).

The output has, per window, two lines like:
  2024-TREND         85     540  28%    +$3,645   +$7    +$9,464  +$18    +$5,819  -$6,890  ...
      setups: reversal 472t +$6,080 · breakout 68t -$2,435
Columns after the window name: sessions, trades, win%, NBBO P&L, NBBO $/t, KIT P&L, KIT $/t, ...
And a final line:  TOTAL: 1927 trades · NBBO -$6,005 (-$3/t) · zero-spread +$1,645 (+$1/t) · ...

Parse money tokens by stripping '$' and ',' and reading the sign ('-$1,234' → -1234, '+$40' → 40).
The 5 window names are exactly: ${JSON.stringify(WINDOWS)}.

Configs for this batch:
${JSON.stringify(batch, null, 2)}

Return the structured results array. For each config: totalNbbo, totalKit, totalTrades, and per-window {name, nbbo, kit, trades, winPct, revT, revPnl, brkT, brkPnl}. If a run errors or prints no TOTAL, set error and totalNbbo=0 with empty windows. Do NOT fabricate numbers — only report what the runs print.`,
    { label: `sweep:batch${bi + 1}`, phase: 'Sweep', schema: CFG_RESULT_SCHEMA }
  ).then(r => (r && r.results) ? r.results : [])
))
const swept = sweepBatches.filter(Boolean).flat()
log(`Swept ${swept.length}/${GRID.length} configs`)

// candidates that beat the −$10,425 baseline, best first
const candidates = swept
  .filter(c => c && typeof c.totalNbbo === 'number' && !c.error && c.totalNbbo > BASELINE.total)
  .sort((a, b) => b.totalNbbo - a.totalNbbo)
const topK = candidates.slice(0, 6)
log(`${candidates.length} configs beat baseline; verifying top ${topK.length}`)

// ── Phase 2: Verify (parallel adversarial verdict per top candidate) ─────────
phase('Verify')
const sweptBrief = swept.map(c => ({ label: c.label, env: c.env, totalNbbo: c.totalNbbo, windows: (c.windows || []).map(w => ({ name: w.name, nbbo: w.nbbo })) }))
const verdicts = topK.length ? (await parallel(topK.map(c => () =>
  agent(
    `Adversarially verify whether this discovered-levels config is a ROBUST improvement or a mirage. Be a skeptic — the desk's entire research history is a graveyard of one-window-carried "edges" that died OOS. Default to skepticism.

BASELINE (LEVELS=warmup) per-window NBBO and total:
${JSON.stringify(BASELINE, null, 2)}
Pure DISCOVERED (reference, net WORSE): ${JSON.stringify(DISCOVERED)}

THIS CONFIG:
${JSON.stringify({ label: c.label, env: c.env, totalNbbo: c.totalNbbo, totalKit: c.totalKit, totalTrades: c.totalTrades, windows: c.windows }, null, 2)}

The full swept grid (for the plateau check — do NEIGHBORING configs also beat baseline, or is this a lone spike?):
${JSON.stringify(sweptBrief, null, 2)}

Compute and judge:
1. totalDelta = config.totalNbbo − (${BASELINE.total}).
2. windowsBeatingBaseline = count of the 5 windows where config NBBO > baseline NBBO (use the baseline per-window numbers above).
3. looSurvives (leave-one-out): identify the window contributing the largest positive delta vs baseline; drop it; does the config still beat baseline summed over the OTHER 4 windows? true/false.
4. oneWindowCarried: is >60% of totalDelta from a single window? Flag especially if it's 2024-TREND (oldest) or if it merely stops the CHOPMIX-25-26 window from being given back.
5. eraArtifactRisk: the discovered finder runs on SPARSE IEX volume; IEX market share drifted 2024→2026. If the gain is concentrated in 2024-TREND and degrades through 2025-26, that smells like a data-era artifact, not level quality — rate low/medium/high.
6. stillNetNegative: is config.totalNbbo still < 0? (beating −10,425 is not the same as profitable.)
7. plateau: do nearby configs in the grid also beat baseline (robust region) or is this isolated?
8. verdict: keep (robust, worth wiring the vocab for) | marginal (real but small/fragile) | park (mirage / one-window / era-artifact).

Return the structured verdict.`,
    { label: `verify:${c.label}`, phase: 'Verify', schema: VERDICT_SCHEMA }
  )
))).filter(Boolean) : []

// ── Phase 3: Synthesize ──────────────────────────────────────────────────────
phase('Synthesize')
const report = await agent(
  `Write the Phase-B verdict for SEVE's discovered-levels experiment. Audience: the desk operator (sophisticated; wants the honest call, not hype). Markdown, tight.

CONTEXT: We ported David's discover_levels_v2 (volume-at-price + swing clustering) as a TS level provider and ran it through the Nakamoto Phase-2 level-strategy on real Databento NBBO across 5 regime windows. The question was: do better (data-driven) levels flip the −$10,425 weak-grid baseline toward +EV? Three known anchors: warmup baseline = −$10,425; pure discovered = −$16,020 (worse); split mode (grid reversal + discovered breakout) = −$6,005 (best of the three, zero-spread +$1,645).

THE FULL SWEEP (${swept.length} configs):
${JSON.stringify(swept.map(c => ({ label: c.label, env: c.env, totalNbbo: c.totalNbbo, totalKit: c.totalKit, windows: (c.windows || []).map(w => `${w.name}:${w.nbbo}(r${w.revPnl}/b${w.brkPnl})`) })), null, 2)}

ADVERSARIAL VERDICTS on the configs that beat baseline:
${JSON.stringify(verdicts, null, 2)}

Write:
1. **Headline verdict** — is there a robust discovered-levels config that beats baseline OOS, or is this a dead/marginal axis? One sentence.
2. **The numbers** — a compact table of the best configs vs baseline (total + per-window), and what the param sweep revealed (which knobs mattered: EDGE_PROX, TOP_N, BIN, etc; is the best config on a plateau or a spike).
3. **The split insight** — does grid-reversal + discovered-breakout hold up across the sweep? Is the breakout-side improvement the real signal?
4. **The honest caveats** — still-net-negative? one-window-carried? IEX-era-artifact risk? Remember the desk's settled view: alpha here is net-negative and this is about a CAPABLE level-input vocab, not trading David's strategy.
5. **Recommendation** — one of: (a) PROCEED to Phase C (wire the discovered-level vocab: a 'discovered' level ref + break-at-level into the strategySpec/specEvaluate/computeFeatures, with the winning config) because the levels demonstrably help; (b) KEEP the provider as infra but DON'T wire yet — go to vocab item #2 (feature-count); or (c) PARK. Justify with the evidence.`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { baseline: BASELINE.total, splitTotal: SPLIT_TOTAL, sweptCount: swept.length, candidates: candidates.map(c => ({ label: c.label, total: c.totalNbbo })), verdicts, report }
