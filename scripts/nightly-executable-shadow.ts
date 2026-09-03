// Run the two registered FOMC/PM research forks on the just-closed session.
// Pilot construction is SELECT-only; optional publication writes only the
// append-only evidence ledger and carries no runtime or order authority.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const has = (name: string): boolean => process.argv.includes(`--${name}`);
const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const session = value("session");
if (!/^\d{4}-\d{2}-\d{2}$/.test(session)) throw new Error("--session YYYY-MM-DD is required");
const outDir = resolve(value("out-dir", `data/decision-atlas/runs/${session}/executable-shadow`));
mkdirSync(outDir, { recursive: true });
const publish = has("publish");
const tsx = resolve("node_modules/.bin/tsx");
if (!existsSync(tsx)) throw new Error("tsx runtime is missing");

const arms = [
  { slug: "pm-momentum-follow", managers: "reference-s30,reference-s50,full-r35-k67", quantity: "2", itm: "1" },
  { slug: "fomc-event-follow", managers: "reference-s30,full-r35-k67", quantity: "1", itm: "" },
];

for (const arm of arms) {
  const report = resolve(outDir, `${arm.slug}.json`);
  const pilotArgs = ["scripts/executable-shadow-pilot.ts", "--slug", arm.slug, "--from", session, "--through", session,
    "--managers", arm.managers, "--quantity", arm.quantity, "--max-debit-usd", "350", "--max-risk-usd", "105",
    "--force-exit-et", "15:25", "--output", report];
  if (arm.itm) pilotArgs.push("--itm-steps", arm.itm);
  const pilot = spawnSync(tsx, pilotArgs, { stdio: "inherit", env: process.env });
  if (pilot.status !== 0) throw new Error(`${arm.slug}: executable-shadow pilot failed`);
  const publishArgs = ["scripts/publish-executable-shadow.ts", "--report", report];
  if (publish) publishArgs.push("--publish", "--ack-authority-dark");
  const publisher = spawnSync(tsx, publishArgs, { stdio: "inherit", env: process.env });
  if (publisher.status !== 0) throw new Error(`${arm.slug}: executable-shadow publication failed`);
}

console.log(JSON.stringify({ kind: "nightly-executable-shadow", session, outDir, published: publish, executionAuthority: false, orderAuthority: false }, null, 2));
