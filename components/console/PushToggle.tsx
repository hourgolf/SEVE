"use client";

import { usePush } from "@/hooks/usePush";

// "🔔 Manual alerts" toggle — enables web-push so the operator is pinged when a
// `-manual` twin opens a position. Best from the installed iOS PWA (required there).
export function PushToggle() {
  const { state, enable } = usePush();
  const label =
    state === "on" ? "🔔 Manual alerts ON" :
    state === "working" ? "🔔 enabling…" :
    state === "denied" ? "🔕 alerts blocked (allow in settings)" :
    state === "unsupported" ? "🔕 alerts unsupported (install PWA)" :
    state === "noconfig" ? "🔕 alerts not configured" :
    state === "error" ? "🔔 enable failed — retry" :
    state === "loading" ? "🔔 manual alerts…" :
    "🔔 Enable manual alerts";
  const live = state === "off" || state === "error";
  return (
    <button
      type="button"
      className={`push-toggle${state === "on" ? " on" : ""}`}
      onClick={live ? enable : undefined}
      disabled={!live && state !== "on"}
      title="Web push when a manual-exit twin opens a position"
      aria-pressed={state === "on"}
    >
      {label}
    </button>
  );
}
