// ============================================================================
//  In-memory state — the streaming driver's second big win (docs/streaming-
//  worker.md). Holds the rolling 1-min bar window and the NTM option chain in
//  process, so decisions read live state with zero DB round-trips.
//
//  NOTE on VWAP: bars are stored as Alpaca delivers them (per-minute `vw`). The
//  decision layer (decide.ts) recomputes CUMULATIVE SESSION VWAP over the session
//  slice — matching the backtest (engine/realsource.ts), which is the source of
//  truth for the edges. (The cron worker uses the raw per-minute vw — a legacy
//  approximation the stream deliberately corrects.)
// ============================================================================

import type { Bar } from "../../engine/types";
import type { ChainQuote } from "./alpaca.js";

export class BarStore {
  private bars: Bar[] = [];
  constructor(private readonly cap: number) {}

  seed(bs: Bar[]): void {
    this.bars = [...bs].sort((a, b) => a.ts - b.ts);
    this.trim();
  }

  /** Insert/replace a bar by ts. Returns true when it's a NEW closed bar
   *  (the decision trigger), false for an update to the latest/an existing bar. */
  upsert(b: Bar): boolean {
    const n = this.bars.length;
    if (n === 0 || b.ts > this.bars[n - 1].ts) { this.bars.push(b); this.trim(); return true; }
    if (b.ts === this.bars[n - 1].ts) { this.bars[n - 1] = b; return false; }
    const idx = this.bars.findIndex((x) => x.ts === b.ts);
    if (idx >= 0) { this.bars[idx] = b; return false; }
    // Out-of-order older bar (rare): insert sorted, don't treat as a trigger.
    this.bars.push(b);
    this.bars.sort((a, c) => a.ts - c.ts);
    this.trim();
    return false;
  }

  all(): Bar[] { return this.bars; }
  get length(): number { return this.bars.length; }
  latest(): Bar | null { return this.bars.length ? this.bars[this.bars.length - 1] : null; }

  private trim(): void {
    if (this.bars.length > this.cap) this.bars = this.bars.slice(-this.cap);
  }
}

export class ChainStore {
  private q = new Map<string, ChainQuote>();
  private updatedMs = 0;

  seed(qs: ChainQuote[]): void { this.q.clear(); this.update(qs); }
  update(qs: ChainQuote[]): void {
    for (const x of qs) this.q.set(x.occ, x);
    this.updatedMs = Date.now();
  }
  byOcc(occ: string): ChainQuote | undefined { return this.q.get(occ); }
  get size(): number { return this.q.size; }
  get ageMs(): number { return this.updatedMs ? Date.now() - this.updatedMs : Infinity; }

  /** Smallest expiration strictly after `date` present in the chain (the 1DTE
   *  roll target), or null. */
  nextExpiryAfter(date: string): string | null {
    let best: string | null = null;
    for (const q of this.q.values()) {
      if (q.expiration > date && (best == null || q.expiration < best)) best = q.expiration;
    }
    return best;
  }
}
