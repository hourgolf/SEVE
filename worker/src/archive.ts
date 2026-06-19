// ============================================================================
//  Forward-data durability backstop — the cloud half of the data flywheel.
//
//  The local launchd capture (scripts/capture-forward.ts) archives the option_quotes tape to
//  the operator's Mac. That covers Mac-DEATH only if the Mac was running to capture; it does
//  NOT cover the Mac being OFF past the 7d DB prune (nothing gets captured). This closes that
//  gap from the ALWAYS-ON Railway worker: post-close, it uploads each COMPLETE day's quotes
//  (gz, format-identical to the local archive) to Supabase Storage — Mac-independent.
//
//  Only COMPLETE days are uploaded (prior days always; today only post-close) → no partial-day
//  risk, so skip-if-already-uploaded is safe (no re-do needed). Idempotent + restart-safe (it
//  reads Storage to know what's done). Gated on the service role + ARCHIVE_QUOTES!=0. Wrapped so
//  it can never crash the trader (off the trade path entirely — runs post-close / at boot).
// ============================================================================

import { gzipSync } from "node:zlib";
import { config } from "./config.js";
import { info, warn } from "./log.js";
import * as store from "./store.js";
import { etParts } from "./alpaca.js";

const CATCHUP_DAYS = 4;          // prior days re-checked each run (covers a multi-day deploy/restart gap)
const POST_CLOSE_MIN = 975;      // 16:15 ET — today is "complete" + settled after this
const enabled = () => config.hasServiceRole && process.env.ARCHIVE_QUOTES !== "0";

let lastArchiveDay: string | null = null; // in-memory once-per-ET-day guard (Storage is the source of truth)

/** Upload every complete, not-yet-archived day's quotes to Storage. Safe to over-call. */
export async function archiveQuotesToStorage(reason: string): Promise<void> {
  if (!enabled()) return;
  try {
    const now = Date.now();
    const { min: nowMin, date: todayET } = etParts(now);
    // candidates: the last N PRIOR days (always complete) + today IF post-close
    const candidates: string[] = [];
    for (let i = 1; i <= CATCHUP_DAYS; i++) candidates.push(etParts(now - i * 86_400_000).date);
    if (nowMin >= POST_CLOSE_MIN) candidates.push(todayET);

    const existing = await store.listArchivedQuoteDays();
    const todo = candidates.filter((d) => !existing.has(d));
    if (!todo.length) { lastArchiveDay = todayET; return; }

    info(`archive(${reason}): ${todo.length} day(s) to upload → ${todo.join(", ")}`);
    for (const d of todo) {
      try {
        const rows = await store.fetchQuotesForDay(d);
        if (!rows.length) continue; // weekend / holiday — nothing to archive
        const gz = gzipSync(Buffer.from(JSON.stringify(rows)));
        const err = await store.uploadQuotesArchive(d, gz);
        if (err) await store.journal("WARN", `archive: upload ${d} FAILED — ${err}`);
        else await store.journal("EXEC", `archive: quotes ${d} → Storage (${rows.length} rows, ${(gz.length / 1024).toFixed(0)} KB)`);
      } catch (e) {
        await store.journal("WARN", `archive: ${d} failed — ${(e as Error).message}`);
      }
    }
    lastArchiveDay = todayET;
  } catch (e) {
    warn(`archive(${reason}) failed — ${(e as Error).message}`);
  }
}

/** Post-close tick (called on a timer): archive once per ET day after the close + settle. */
export async function maybeArchiveTick(): Promise<void> {
  if (!enabled()) return;
  const { min, date } = etParts(Date.now());
  if (min < POST_CLOSE_MIN) return;        // before settle — wait
  if (lastArchiveDay === date) return;      // already done today
  await archiveQuotesToStorage("post-close");
}
