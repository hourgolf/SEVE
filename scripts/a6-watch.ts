// a6-watch — the A6-day AUTOPILOT (2026-07-05). The registry turned decisions into rules
// and a6-read turned the evaluation into code; this closes the loop so nobody has to
// REMEMBER the desk's own calendar:
//   · every night (capture chain): checks era-4 session count vs the A6 trigger (15)
//   · at T-1: pushes "A6 triggers next session"
//   · at trigger: runs the full a6-read, composes the DECISION MEMO — the read output plus
//     a pre-filled, rule-quoted SQL block for every registered A6-day decision (C1 arm,
//     A9 gate-or-consolidate, A10 unvalidated-size, R1 runner twins) — writes it to
//     docs/a6-decision-memo-<date>.md, and pushes the headline to the operator's phone.
//   DECIDES NOTHING. Every SQL block waits for the operator's word — the autopilot's job
//   is that on trigger day the entire read + every choice is one push away, pre-framed by
//   rules written before the outcomes existed.
// Idempotent via data/a6-watch.json (fires each stage once). Deterministic — no LLM.
//
//   npm run a6-watch            # nightly via capture-forward
//   npm run a6-watch -- --force # re-fire the memo (overwrites state)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ERA4_START = "2026-06-30";
const TRIGGER_SESSIONS = 15;
const STATE_PATH = "data/a6-watch.json";
const FORCE = process.argv.includes("--force");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

interface WatchState { t1Pushed?: boolean; firedMemo?: string }
const loadState = (): WatchState => (existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {});
const saveState = (s: WatchState) => writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));

async function push(title: string, body: string): Promise<void> {
  const appUrl = process.env.APP_URL, secret = process.env.PUSH_SECRET;
  if (!appUrl || !secret) { console.log(`  a6-watch: push skipped (no APP_URL/PUSH_SECRET) — ${title}`); return; }
  try {
    await fetch(`${appUrl}/api/push-send`, {
      method: "POST", headers: { "content-type": "application/json", "x-push-secret": secret },
      body: JSON.stringify({ title, body, tag: "seve-a6", url: "/" }), signal: AbortSignal.timeout(8000),
    });
  } catch (e) { console.log(`  a6-watch: push failed — ${(e as Error).message}`); }
}

// The pre-filled A6-day decision blocks. STATIC BY DESIGN: each quotes its registry rule and
// carries the exact SQL — the READ (embedded above them in the memo) supplies the evidence;
// the operator supplies the word. Keep in sync with docs/pre-registered-tests-2026-07.md.
const DECISIONS = `
## THE A6-DAY DECISIONS (each on the operator's word — SQL pre-filled, rules quoted)

### 1 · C1 — arm the stack cap (registry C1: "arm C1 as the first post-A6 action")
Check first: the era-4 depth table ABOVE and the gate-shadow would-haves (kill criterion:
capped entries net POSITIVE at N≥30 blocked → the cap dies instead of arming).
\`\`\`sql
update fund_state set stack_cap_n = 4;  -- block the 5th+ same-underlying+direction entry
\`\`\`

### 2 · A9 — breakout(base): gate it or consolidate the SPY slot
Rule: flat-open exp < 0 at n≥15 AND gap-day exp ≥ 0 → gate VALIDATED (see the A9 section of
the read above). Then choose ONE:
\`\`\`sql
-- Option A: arm the (dark-built) gap gate on base
update strategist_config set gap_min = 0.25
 where strategist_id = (select id from strategists where slug = 'breakout');
-- Option B: consolidate the SPY gap-day slot instead (bench the loser(s) of base/V3/ALT)
-- update strategists set status='draft' where slug in ('<losers>');
\`\`\`

### 3 · A10 — ride sizing (rule: no passing expectancy verdict at the read → max RISK $1,000)
Applies today to momo-shape ($1,800). This one is a RULE-application, not a choice — skip
only if momo-shape somehow reached N≥40 with positive expectancy (see the A10 table above).
\`\`\`sql
update strategist_config c set capital_pct = 1000
  from strategists s where c.strategist_id = s.id and s.slug = 'momo-shape' and c.capital_pct > 1000;
\`\`\`

### 4 · R1 — configure the runner A/B twins (registry R1; mechanism is dark-built + reviewed)
Pick the LOCK channel the A6b near-miss table nominates (fattest near-miss rate at N≥40).
Template (example on pb-ride-2 — substitute the nominee): duplicate it twice via the UI
(or SQL), put the twins in SEPARATE accounts at A1 sizing, then:
\`\`\`sql
-- runner twin: retain half at TP, ratchet the rest (giveback from the A6b read)
update strategist_config c set runner_frac = 0.5, runner_giveback_pct = 25,
  capital_pct = 500, max_contracts = 6, daily_stop_usd = 1000
  from strategists s where c.strategist_id = s.id and s.slug = '<nominee>-run';
-- all-out control twin: A1 sizing, knobs otherwise identical (runner_frac stays 0)
\`\`\`
Kill/pass at N≥40 each, per R1.

### 5 · A6 LOCK verdicts — per the table above
Channels flagged "⚑ FLAG: RIDE mode or bench (CI upper < own bar)" at N≥40: choose RIDE
(set take_profit_pct=0) or bench (status='draft') per channel. Channels below N≥40: deferred
read — no action.

*(A5 gamma-open and the vb mining pass have their own clocks — not A6-day decisions.)*
`;

async function main() {
  const { data } = await sb.from("positions").select("opened_at").eq("status", "closed").gte("opened_at", ERA4_START);
  const sessions = new Set(((data ?? []) as { opened_at: string }[]).map((r) => r.opened_at.slice(0, 10))).size;
  const state = FORCE ? {} : loadState();
  console.log(`  a6-watch: era-4 sessions ${sessions}/${TRIGGER_SESSIONS}${state.firedMemo ? ` · memo already fired (${state.firedMemo})` : ""}`);

  if (sessions >= TRIGGER_SESSIONS && !state.firedMemo) {
    const read = spawnSync("npm", ["run", "a6-read"], { encoding: "utf8", env: process.env });
    const readOut = (read.stdout ?? "").replace(/^[\s\S]*?a6-read\.ts\n/, ""); // strip the npm banner
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    const memoPath = `docs/a6-decision-memo-${day}.md`;
    const memo = [
      `# A6 DECISION MEMO — ${day} (auto-generated by a6-watch at trigger)`,
      ``,
      `The era-4 evaluation triggered (${sessions} sessions ≥ ${TRIGGER_SESSIONS}). Below: the full`,
      `mechanized read, then every pre-registered A6-day decision with its SQL. Rules:`,
      `docs/pre-registered-tests-2026-07.md. Nothing below executes without the operator's word.`,
      ``,
      "```",
      readOut.trim(),
      "```",
      DECISIONS,
    ].join("\n");
    mkdirSync("docs", { recursive: true });
    writeFileSync(memoPath, memo);
    saveState({ ...state, firedMemo: memoPath });
    await push("⚖ A6 TRIGGERED — decision memo ready", `${sessions} era-4 sessions. Read + pre-filled SQL for C1/A9/A10/R1 + LOCK verdicts → ${memoPath}`);
    console.log(`  a6-watch: ⚖ TRIGGERED — memo written → ${memoPath}, push sent`);
    return;
  }
  if (sessions === TRIGGER_SESSIONS - 1 && !state.t1Pushed) {
    saveState({ ...state, t1Pushed: true });
    await push("A6 triggers next session", `era-4 at ${sessions}/${TRIGGER_SESSIONS} — the read + decision memo auto-generate after the next close.`);
    console.log("  a6-watch: T-1 heads-up pushed");
  }
}

main().catch((e) => { console.error(`a6-watch fatal — ${(e as Error).message}`); process.exit(1); });
