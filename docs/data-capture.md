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

## Cloud durability — the Mac-independent backstop (BUILT)

The local archive alone covers Mac-DEATH only if the Mac was running to capture; it does NOT cover
the Mac being OFF past the 7d prune (nothing gets captured to begin with). So the **always-on Railway
worker** also uploads each COMPLETE day's `option_quotes` (gz, format-identical to the local archive)
to a private **Supabase Storage bucket `forward-data`** (`quotes/<date>.json.gz`), post-close — fully
Mac-independent. `worker/src/archive.ts` + `store.ts` helpers; boot run = catch-up for missed days, a
20-min timer fires once/day after 16:15 ET. Service-role only (bypasses RLS — no object policies);
off the trade path; `ARCHIVE_QUOTES=0` disables it. Only COMPLETE days upload (prior days always; today
only post-close) → no partial-day risk, so skip-if-already-uploaded is safe.

Size: ~3.5 MB gz/day × ~250 trading days ≈ **~875 MB/yr** — fits the Storage free tier (1 GB) for ~a
year. Revisit the tier / roll old days to colder storage before then. Only the quotes tape is uploaded
(the one irreplaceable thing); bars/training/ledgers are reconstructable, so they stay local-only.

Inspect what's in the cloud:
```sql
select name, (metadata->>'size')::int as bytes from storage.objects
where bucket_id = 'forward-data' order by name desc;   -- via Supabase SQL
```
Restore a day: download `quotes/<date>.json.gz` from the bucket into `data/quotes-archive/`.
