// ============================================================================
//  Forward-data durability backstop — the cloud half of the data flywheel.
//
//  The local launchd capture (scripts/capture-forward.ts) archives the option_quotes tape to
//  the operator's Mac. That covers Mac-DEATH only if the Mac was running to capture; it does
//  NOT cover the Mac being OFF past the 7d DB prune (nothing gets captured). This closes that
//  gap from the ALWAYS-ON Railway worker: post-close, it uploads each COMPLETE day's quotes
//  (gz, format-identical to the local archive) to Supabase Storage — Mac-independent.
//  A separately gated v1 also writes a content-addressed object+manifest to R2
//  and seals that path only after its compact private receipt agrees.
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
import { archiveCycleMaySeal, POST_CLOSE_ARCHIVE_MIN } from "./archiveModel.js";

const CATCHUP_DAYS = 4;          // prior days re-checked each run (covers a multi-day deploy/restart gap)
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
    if (nowMin >= POST_CLOSE_ARCHIVE_MIN) candidates.push(todayET);

    const existing = await store.listArchivedQuoteDays();
    let r2Existing = new Set<string>();
    let r2Ready = false;
    let r2ReceiptError: string | null = null;
    if (config.quoteArchiveR2Enabled) {
      const receiptStore = await import("./quoteArchiveReceiptStore.js");
      const receiptState = await receiptStore.listVerifiedQuoteArchiveDays();
      r2Existing = receiptState.days;
      r2ReceiptError = receiptState.error;
      r2Ready = !receiptState.error;
      if (r2ReceiptError) await store.journal("WARN", `archive: R2 receipt schema/read unavailable — ${r2ReceiptError}`);
    }
    const todo = candidates.filter((d) => !existing.has(d) || (r2Ready && !r2Existing.has(d)));
    if (!todo.length) {
      const failedDays = config.quoteArchiveR2Enabled && !r2Ready ? 1 : 0;
      if (archiveCycleMaySeal({ nowEtMinute: nowMin, failedDays })) lastArchiveDay = todayET;
      return;
    }

    info(`archive(${reason}): ${todo.length} day(s) to upload → ${todo.join(", ")}`);
    let failedDays = config.quoteArchiveR2Enabled && !r2Ready ? 1 : 0;
    for (const d of todo) {
      try {
        const rows = await store.fetchQuotesForDay(d);
        if (!rows.length) continue; // weekend / holiday — nothing to archive
        const gz = gzipSync(Buffer.from(JSON.stringify(rows)));
        if (!existing.has(d)) {
          const err = await store.uploadQuotesArchive(d, gz);
          if (err) {
            failedDays++;
            await store.journal("WARN", `archive: upload ${d} FAILED — ${err}`);
          }
          else await store.journal("EXEC", `archive: quotes ${d} → Storage (${rows.length} rows, ${(gz.length / 1024).toFixed(0)} KB)`);
        }
        if (r2Ready && !r2Existing.has(d)) {
          try {
            const { writeQuoteArchiveToR2 } = await import("./r2QuoteArchive.js");
            const receipt = await writeQuoteArchiveToR2({ sessionDateEt: d, rows });
            await store.journal("EXEC", `archive: quotes ${d} → R2 verified (${receipt.rowCount} rows · ${receipt.compressedSha256.slice(0, 12)})`);
          } catch (error) {
            failedDays++;
            await store.journal("WARN", `archive: R2 ${d} FAILED — ${(error as Error).message}`);
          }
        }
      } catch (e) {
        failedDays++;
        await store.journal("WARN", `archive: ${d} failed — ${(e as Error).message}`);
      }
    }
    if (archiveCycleMaySeal({ nowEtMinute: nowMin, failedDays })) lastArchiveDay = todayET;
    else if (failedDays) warn(`archive(${reason}): ${failedDays} day(s) failed; keeping retry guard open`);
  } catch (e) {
    warn(`archive(${reason}) failed — ${(e as Error).message}`);
  }
}

/** Post-close tick (called on a timer): archive once per ET day after the close + settle. */
export async function maybeArchiveTick(): Promise<void> {
  if (!enabled()) return;
  const { min, date } = etParts(Date.now());
  if (min < POST_CLOSE_ARCHIVE_MIN) return; // before settle — wait
  if (lastArchiveDay === date) return;      // already done today
  await archiveQuotesToStorage("post-close");
}
