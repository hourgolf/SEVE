# Forward-data capture — the automated nightly job

The data flywheel's foundation: bank every trading day's forward data so it never evaporates.
Replaces the **manual** "run export-quotes / day-report same-week" rituals that were silently
losing data whenever nobody ran them (the desk was ~5 trading days behind when this shipped,
2026-06-19, with un-archived days approaching the 7-day prune).

## What runs

`npm run capture` → `scripts/capture-forward.ts` orchestrates the existing scripts (no logic
duplicated), each idempotent + catch-up:

- **Tier 1 (irreplaceable — must succeed):**
  - `export-quotes` → `data/quotes-archive/<day>.json.gz` — the option NBBO tape. **Prunes from
    the DB at 7d and is NOT reconstructable.** This is the whole reason the job exists.
  - `export-bars` → `data/bars-archive/<SYM>/<day>.json` — the 1-min underlying tape (SPY+QQQ;
    reconstructable from Alpaca, but cheap to keep).
- **Tier 2 (best-effort):**
  - `day-report --date <d>` for the last 6 ET days — upserts the override + foul-out ledgers from
    the still-live 7d quotes, and publishes the §03 forensics panel.
  - `build-training-store` — accumulates the conviction-sizing dataset (`data/training/`).

Re-running only re-exports **un-archived** days (the last archived day is always redone in case it
was partial), so it's safe to run twice a day / on every wake.

**GAP CHECK:** the job ends by reporting how many trading days behind the quotes archive is and
exits non-zero (or screams) if it's ≥5 — i.e. nearing the 7d prune where data is lost for good. If
you ever see that, the schedule has been failing — investigate.

## The schedule (launchd, operator's Mac)

The archive lives on local disk (`data/`, gitignored), so the job runs on the operator's machine,
not in the cloud. A LaunchAgent runs it twice a day + on login:

- Plist: `~/Library/LaunchAgents/com.seve.capture.plist` (machine-specific absolute paths — NOT in
  the repo; the canonical copy is below).
- Times: 02:15 + 13:15 local, `RunAtLoad`, and launchd re-runs missed calendar times on wake.
- Log: `~/Library/Logs/seve-capture.log` (tail it to audit that it ran).

Reproduce the plist on a new machine (adjust the `/Users/mattlynch` paths + `/usr/local/bin` if
node lives elsewhere — `which node`):

```xml
<!-- ~/Library/LaunchAgents/com.seve.capture.plist -->
<dict>
  <key>Label</key><string>com.seve.capture</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/npm</string><string>run</string><string>capture</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/mattlynch/seve-dashboard</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key><array>
    <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>15</integer></dict>
    <dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>15</integer></dict>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/Users/mattlynch/Library/Logs/seve-capture.log</string>
  <key>StandardErrorPath</key><string>/Users/mattlynch/Library/Logs/seve-capture.log</string>
</dict>
```

### Manage it

```bash
# load / enable
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.seve.capture.plist
# run it now, on demand
launchctl kickstart -k gui/$(id -u)/com.seve.capture
# check it's registered (col 1 = PID while running, col 2 = last exit code)
launchctl list | grep seve
# DISABLE / remove
launchctl bootout gui/$(id -u)/com.seve.capture
```

## Durability note (open follow-on)

The archive is local-only — robust if the Mac is on most days (the catch-up window + gap-check
cover gaps), but a dead/long-off laptop past the 7d window still loses the tape. A cloud backstop
(push the gzipped day archives to Supabase Storage / a bucket after export) would make the corpus
durable independent of the Mac. Not built yet — flagged as the next hardening step if the laptop
isn't reliably on.
