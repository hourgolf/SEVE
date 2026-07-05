// backup-archives — off-site copy of the IRREPLACEABLE local research data.
//
// The option-NBBO tape (data/quotes-archive) prunes from the DB at 7 days and is NOT
// reconstructable from any vendor; until now it lived only on this machine. This script
// mirrors the durable data/ artifacts into a sibling checkout (~/seve-data-backup) that
// pushes to the SAME GitHub remote on an orphan `data-archive` branch — no new
// credentials (rides the existing SSH deploy key), no history pollution on main
// (vercel.json disables deployments for the branch; the branch never merges).
//
//   npm run backup-archives      # rsync → commit (if changed) → push
//
// Runs nightly as a tier-2 step of capture-forward (failure-tolerant: a dead network
// night just retries tomorrow — archives are append-only so nothing is lost as long
// as the Mac survives the gap). First run seeds ~160MB; nightly deltas ≈ 4MB.

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

const REPO = resolve(__dirname, "..");
const DEST = process.env.SEVE_BACKUP_DIR || join(homedir(), "seve-data-backup");
const REMOTE = "git@github.com:hourgolf/SEVE.git";
const BRANCH = "data-archive";
// Everything irreplaceable or expensive-to-rebuild. Regenerable-but-cheap files ride
// along (forensics dataset, training store) so a bare Mac can resume analysis same-day.
const ITEMS = [
  "data/quotes-archive",
  "data/bars-archive",
  "data/broker-truth.json",
  "data/gate-shadow.json",
  "data/override-ledger.json",
  "data/reconcile-applied.json",
  "data/forensics-dataset.jsonl",
  "data/training",
  "data/iv-bank",
];

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function main() {
  // ---- ensure the backup checkout exists on the orphan branch ----
  if (!existsSync(join(DEST, ".git"))) {
    mkdirSync(DEST, { recursive: true });
    sh(`git init -b ${BRANCH}`, DEST);
    sh(`git remote add origin ${REMOTE}`, DEST);
    // The SEVE deploy key is wired repo-locally in the main checkout (core.sshCommand);
    // mirror it here or pushes auth as the wrong deploy key and 403.
    const sshCmd = sh("git config --get core.sshCommand", REPO);
    if (sshCmd) sh(`git config core.sshCommand ${JSON.stringify(sshCmd)}`, DEST);
    // Adopt the remote branch if a previous machine already seeded it.
    const fetch = spawnSync("git", ["fetch", "origin", BRANCH], { cwd: DEST, encoding: "utf8" });
    if (fetch.status === 0) sh(`git reset --hard origin/${BRANCH}`, DEST);
    writeFileSync(join(DEST, "README.md"),
      "# SEVE data archive (orphan branch)\n\nNightly off-site mirror of the irreplaceable local research data " +
      "(option-NBBO tape, bars archive, ledgers). Pushed by scripts/backup-archives.ts via capture-forward. " +
      "Never merge into main.\n");
    console.log(`  backup: initialized ${DEST} on orphan '${BRANCH}'`);
  }

  // ---- mirror (rsync -a: preserve; no --delete — archives are append-only) ----
  for (const item of ITEMS) {
    const src = join(REPO, item);
    if (!existsSync(src)) continue;
    const destParent = join(DEST, item, "..");
    mkdirSync(resolve(destParent), { recursive: true });
    sh(`rsync -a ${JSON.stringify(src)} ${JSON.stringify(resolve(destParent) + "/")}`, REPO);
  }

  // ---- commit when changed; ALWAYS push (a prior run may have committed but failed
  // to push — skipping the push here would strand those commits locally forever) ----
  sh("git add -A", DEST);
  const dirty = sh("git status --porcelain", DEST);
  if (dirty) {
    const day = new Date().toISOString().slice(0, 10);
    sh(`git -c user.name=seve-backup -c user.email=backup@seve.local commit -m "archive ${day}"`, DEST);
  }
  sh(`git push origin ${BRANCH}`, DEST);
  const size = sh("du -sh . | cut -f1", DEST);
  console.log(`  backup: ${dirty ? "committed + " : "no new changes — "}pushed → origin/${BRANCH} (${size} total)`);
}

main();
