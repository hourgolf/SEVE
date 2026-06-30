// ============================================================================
//  Shadow §03 forensics publish — the cloud-durable panel, MAC-INDEPENDENT.
//
//  The §03 override/foul-out scorecard + benched-sim used to publish ONLY when the
//  operator's Mac ran the nightly capture (scripts/capture-forward.ts → day-report).
//  So the panel was Mac-dependent. This runs the SAME day-report from the always-on
//  worker post-close, so the panel stays current with no Mac.
//
//  It REUSES the exact CLI — scripts/shadow-cron.ts loops scripts/day-report.ts
//  (override scorecard + foul-out re-score + benched-sim) — as a CHILD PROCESS, so
//  there is ZERO re-implementation and ZERO drift (the desk's repeated edge-fn-mirror
//  wound). Safety: the child is a SEPARATE process (a crash/OOM/hang can't take the
//  trader's heap), the spawn is NON-BLOCKING (the worker's event loop keeps running →
//  heartbeat stays alive while the child works), it's bounded by a hard timeout, and
//  the whole thing is wrapped + post-close + gated on the service role. Off the trade
//  path entirely. [[data-capture-automation]]
// ============================================================================

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config } from "./config.js";
import { warn } from "./log.js";
import * as store from "./store.js";
import { etParts } from "./alpaca.js";

const POST_CLOSE_MIN = 980;            // 16:20 ET — after the close + quote settle (staggered past the 16:15 quotes-archive)
const RUN_TIMEOUT_MS = 20 * 60_000;    // generous: SHADOW_CRON_DAYS × day-report × ~9 benched backtests (60s each)
const enabled = () => config.hasServiceRole && process.env.SHADOW_PUBLISH !== "0";

let lastPublishDay: string | null = null; // in-memory once-per-ET-day guard

/** Spawn the existing shadow-cron (the day-report loop) as a non-blocking child; resolve when it exits. */
function runShadowCron(): Promise<number> {
  return new Promise((done) => {
    // The worker runs from /app/worker (Dockerfile WORKDIR) → the repo root (where scripts/,
    // engine/, lib/, tsconfig.json are COPYed) is one up. Run the child there so the scripts'
    // relative imports + paths resolve like local dev.
    const repoRoot = resolve(process.cwd(), "..");
    const tsx = process.env.TSX_BIN || resolve(process.cwd(), "node_modules", ".bin", "tsx");
    const child = spawn(tsx, ["scripts/shadow-cron.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        // The scripts + engine read the NEXT_PUBLIC_* pair for their Supabase client, but the
        // worker's Railway env has SUPABASE_URL + SERVICE_ROLE (not the anon NEXT_PUBLIC_* pair).
        // Map them so the child runs with NO extra Railway vars (true zero-touch). Service-role
        // reads everything, so using it as the "anon" key for reads is fine.
        NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: config.supabaseServiceKey,
        SUPABASE_URL: config.supabaseUrl,
        // benched-sim/backtest read bars from the DB (60d retention covers the last 2 days) — force
        // DB reads so they don't depend on data/bars-archive, which isn't in the worker image.
        SEVE_BARS_ARCHIVE: "0",
        SHADOW_CRON_DAYS: process.env.SHADOW_CRON_DAYS ?? "2",
        TSX_BIN: tsx,
      },
      stdio: "inherit", // child logs flow into the worker's Railway logs
    });
    const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, RUN_TIMEOUT_MS);
    child.on("close", (code) => { clearTimeout(killer); done(code ?? 0); });
    child.on("error", (e) => { clearTimeout(killer); warn(`shadow-publish: spawn failed — ${(e as Error).message}`); done(-1); });
  });
}

/** Post-close tick (called on a timer): publish the §03 forensics once per ET day. NON-BLOCKING. */
export async function maybePublishForensicsTick(): Promise<void> {
  if (!enabled()) return;
  const { min, date } = etParts(Date.now());
  if (min < POST_CLOSE_MIN) return;        // before settle — wait
  if (lastPublishDay === date) return;     // already done today
  lastPublishDay = date;                    // set BEFORE the (long) run so the next tick can't double-fire; a
                                            // failed day is re-covered by tomorrow's SHADOW_CRON_DAYS catch-up.
  try {
    await store.journal("EXEC", "shadow-publish: running day-report (shadow §03 panel) post-close");
    const code = await runShadowCron();
    await store.journal(code === 0 ? "EXEC" : "WARN", `shadow-publish: day-report ${code === 0 ? "done" : `exited ${code}`}`);
  } catch (e) {
    warn(`shadow-publish failed — ${(e as Error).message}`);
  }
}
