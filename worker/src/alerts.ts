// ============================================================================
//  "The desk summons you" — operator push alerts (consultant item, built
//  2026-06-12). The desk's job split: the machine trades, the operator decides —
//  so the desk pages him at the moments his judgment is worth dollars (a ripper
//  crossing +75%, a peak giving back, a daily-stop latch, an event stand-down,
//  a zero-size block, a halt) instead of him staring at the screen.
//
//  Transport: POST to the app's /api/push-send — the SAME route + secret the
//  cron's ✋ manual-twin ping uses. NO-OP unless APP_URL + PUSH_SECRET are set
//  (fail-safe: alerts are informational; a missing env never blocks trading —
//  every alert also lands in the worker log either way).
//
//  Dedup: in-memory, once per ET day per (kind, scope). A restart can re-fire
//  at most one page per key — acceptable for an informational ping. NEVER an
//  exit path: alerts read state, they don't act on it.
// ============================================================================

import { config } from "./config.js";
import { info, warn } from "./log.js";

const enabled = !!(config.appUrl && config.pushSecret);

let day = "";
const fired = new Set<string>();

/** Page the operator once per ET day per (kind, scope). */
export function alertOnce(todayET: string, kind: string, scope: string, title: string, body: string): void {
  if (todayET !== day) { fired.clear(); day = todayET; }
  const key = `${kind}:${scope}`;
  if (fired.has(key)) return;
  fired.add(key);
  void send(title, body);
}

/** Re-open a dedup slot (e.g. halt cleared — a SECOND halt today should page again). */
export function alertClear(kind: string, scope: string): void {
  fired.delete(`${kind}:${scope}`);
}

/** The ✋ manual-twin ping — fires on EVERY twin entry (no dedup: each open is a
 *  fresh "your exit" obligation). Tag matches the cron's firePush so a migrated
 *  twin's pings group with the historical ones on the phone. This is the piece
 *  whose absence blocked the twin stream-migration (cron parity). */
export function pushManual(title: string, body: string): void {
  void send(title, body, "seve-manual");
}

async function send(title: string, body: string, tag = "seve-alert"): Promise<void> {
  info(`alert: ${title} — ${body}${enabled ? "" : " (push off: APP_URL/PUSH_SECRET unset)"}`);
  if (!enabled) return;
  try {
    await fetch(`${config.appUrl}/api/push-send`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-push-secret": config.pushSecret },
      body: JSON.stringify({ title, body, tag, url: "/" }),
    });
  } catch (e) {
    warn(`alert push failed — ${(e as Error).message}`);
  }
}
