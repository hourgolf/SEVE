// ---------------------------------------------------------------------------
//  morning-brief — pre-market (launchd ~06:00 PT, before the 06:30 open): refresh
//  the freshest inputs, then republish the SENTINEL (which now folds in the
//  desk-briefing forward terrain) so the combined brief lands on the §04 dashboard
//  panel BEFORE the open / first trades.
//
//  Best-effort refresh (the evening capture already banked yesterday; this catches
//  the overnight tape + any pre-market dealer re-bank); the load-bearing step is
//  `sentinel`, which builds + publishes the combined artifact. Children load their
//  own --env-file, so keys flow without this wrapper needing them.
//
//  ⚠ launchd fires on schedule only while the Mac is awake (or wakes for it). If it
//  sleeps overnight, add a power wake:  pmset repeat wake MTWRF 05:55:00
//
//    npm run morning-brief
// ---------------------------------------------------------------------------
import { spawnSync } from "node:child_process";

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
function run(label: string, args: string[]): boolean {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${label} … `);
  const r = spawnSync("npm", ["run", ...args], { stdio: "inherit", env: process.env });
  const ok = r.status === 0 && !r.error;
  process.stdout.write(`${ok ? "✓" : "✗"} ${((Date.now() - t0) / 1000).toFixed(1)}s${ok ? "" : ` (${r.error?.message ?? `exit ${r.status}`})`}\n`);
  return ok;
}

async function main() {
  console.log(`\n══ morning-brief · ${stamp()} ══`);
  // freshest available inputs — best-effort, never block the publish
  run("export-bars", ["export-bars"]);   // overnight/pre-market tape → auto S/R levels current
  run("iv-bank", ["iv-bank"]);           // dealer positioning (session-gated internally; refreshes if allowed)
  // the artifact: sentinel folds in the desk-briefing terrain + publishes to the §04 panel
  const ok = run("sentinel", ["sentinel"]);
  console.log(ok
    ? `\n  ✓ brief published to the desk — terrain + scan on §04 before the open.`
    : `\n  ✗ sentinel publish FAILED — check .env.local / network (the brief did not update).`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(`morning-brief fatal — ${(e as Error).message}`); process.exit(1); });
