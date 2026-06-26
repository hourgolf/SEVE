// Visibility-aware polling. Runs `fn` every `ms`, but PAUSES while the tab is
// hidden (backgrounded) and resumes — with an immediate catch-up run — when it
// returns to the foreground.
//
// Why: the dashboard's pollers (chart/chain in useMarketData, the book in
// useDeskFeed, live marks in usePositionMarks) re-read large Supabase payloads
// every few seconds. Left running in a background tab or after hours — when the
// 1-minute tape isn't even changing — they were the dominant EGRESS driver that
// pushed the org over its quota. Pausing on hidden + a slower interval cuts that
// without touching the live trader. SSR-safe (no-op when `document` is absent).
//
// Returns a cleanup function that stops the interval and detaches the listener.
export function startVisibilityPoll(fn: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (id == null) id = setInterval(fn, ms);
  };
  const stop = () => {
    if (id != null) {
      clearInterval(id);
      id = null;
    }
  };
  const onVis = () => {
    if (typeof document === "undefined") return;
    if (document.hidden) stop();
    else {
      fn(); // immediate refresh so the foreground view isn't stale on return
      start();
    }
  };
  const hidden = typeof document !== "undefined" && document.hidden;
  if (!hidden) start();
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", onVis);
  return () => {
    stop();
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVis);
  };
}

// True only when we're in a hidden tab — used to skip realtime-triggered refetches
// while backgrounded (the websocket keeps firing even when the interval is paused).
export const isHidden = () =>
  typeof document !== "undefined" && document.hidden;
