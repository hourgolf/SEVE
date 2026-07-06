# INDEX-EXPANSION KIT — the codified IWM playbook (2026-07-05)

The desk's one validated, generalizing edge is gap-day momentum (V3/ALT), stronger
off-SPY — and the cross-index verdict says growth = **at-bats on new indices, not new
entries**. IWM proved the pipeline ad hoc in June; this kit makes the next index a
**one-day operation**. Candidates worth the day when forward data justifies it: DIA, MDY,
sector ETFs with $1-strike liquid 0DTE/1DTE chains (check strike grid + spread first).

Nothing here arms by default — steps 5–6 produce DRAFTS; arming is an operator word, and
new-index channels start at **A1 sizing** always.

---

## Step 0 · Qualify the candidate (30 min, no spend)
- Chain reality: near-the-money 0DTE/1DTE snapshot via the iv-bank probe pattern
  (`scripts/iv-bank.ts` fetch, or curl the snapshots endpoint): does it HAVE same/next-day
  expiries most days? Spread ≤ a few cents near the money? OI non-trivial?
- Strike grid $1 (the OCC/strike-rounding code assumes it — a $5-grid index needs code).
- Gap distribution sanity vs gap_min 0.25 (the A3 lesson: measure BEFORE assuming — IWM's
  gaps were LARGER than SPY's; a low-gap index may never co-fire).

## Step 1 · Buy the data (~$0.40, minutes)
```bash
npm run backfill:databento -- --underlying <SYM> --from 2024-05-01 --to <today-T2>
# multi-DTE chains land in data/databento-mdte-<sym>; OPRA history is T+1 embargoed
```

## Step 2 · Bars history (free, minutes)
```bash
npm run repair-bars-archive -- --underlying <SYM>   # fills data/bars-archive/<SYM> from Alpaca
```

## Step 3 · OOS-validate the edge (the gate that kills most candidates — hours)
Run the validated-entry family over the 5 regime windows on real NBBO:
```bash
npx tsx --env-file=.env.local engine/lever-probe.ts --underlying <SYM>   # V3/ALT faithful
npx tsx --env-file=.env.local engine/vb-fleet-probe.ts --underlying <SYM> # bank the vb prior too
```
PASS bar (same as IWM's MOVE-3): V3/ALT positive expectancy ≥4/5 windows, drop-the-best
survives. FAIL → stop here; the index is not owed a channel. Bank the outputs in docs/
either way (a banked negative prevents re-litigation).

## Step 4 · Wire the tape
- Worker symbols: `SYMBOLS` env default is code-side (`worker/src/config.ts`) — add <SYM>
  (Railway pins no override; confirm at boot: `seed[<SYM>]: N bars` + `chain M contracts`).
- market-ingest `UNDERLYINGS` env (Supabase edge secrets) — add <SYM> so option_quotes
  carries its chain (the vb replay + forensics peaks need it).
- iv-bank: add <SYM> to `IV_BANK_SYMBOLS` (or the default in scripts/iv-bank.ts).

## Step 5 · Clone the channels (SQL, minutes — mirror 45_iwm_channels.sql / 63_vb_cross_index.sql)
- V3/ALT clones: underlying=<SYM>, account=FIRST-TEAM only AFTER step 3 passes + operator
  word; otherwise LAB. **A1 sizing (RISK ≤$500, mc ≤6), flat (pyramid 0), ATM** (ITM was
  SPY-specific; er40 loosening was SPY-specific — clone the BASE config, not SPY's tweaks).
- vb fleet clones: the 63 pattern verbatim (drafts, signal-only, prior banked in step 3).

## Step 6 · First-session watch (the IWM checklist, verbatim)
1. Boot log: `seed[<SYM>]: N bars` + chain snapshot M>0 (a chain miss = NO trade, safe).
2. Gap stamps flowing on <SYM> entries (`rationale->>'gap'` non-null — the fail-closed check).
3. Day-report: <SYM> trades or stands down with gap_min visible; coverage ✓.
4. Expiry-calendar quirk: some indices lack same-day expiries some days → the cutoff-roll
   picks the nearest; verify the first roll books clean.
5. Rollback: `update strategists set status='draft' where slug like '%-<sym>';`

## Standing rules
- One new index at a time; ≥2 weeks between arms (attribution clarity).
- Every new-index channel gets its own pre-registered gate line in the registry before
  arming (the A8/A1 pattern), and its priors banked BEFORE forward data (step 3).
- The kit ships channels that stand down correctly far more often than they trade —
  selectivity is the design, not a bug (IWM took 3 trades in its first 8 sessions).
