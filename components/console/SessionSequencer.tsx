"use client";

// SESSION SEQUENCER — the 909 step-tape made load-bearing (909-redesign slice 1,
// mock: docs/ui-909-redesign-mockup-2026-07-02.html). 16 steps map the RTH
// session 9:30→16:00 ET (~24.4 min each): steps carry the day's fills as
// channel-colored dots (solid = entry, hollow = exit), future steps carry the
// desk's PROGRAMMED events (FOMC stand-down · 0DTE cutoff roll · EOD flatten),
// and the red running LED is market time. Tap a step → slice readout of that
// window on the LCD strip. READ-ONLY: renders entirely off the feed the desk
// already polls — no new subscriptions, no trade-path involvement.
//
// Two skins: `bezel` (desktop — cream bezel under the Live Book, collapsible)
// and `dock` (mobile — slim pattern bar pinned above the tab bar, closed by
// default, tap to expand). Fold state persists per-skin.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { eventsOn } from "@/engine/market-events";
import { KitToggle } from "@/components/console/KitToggle";
import { playKit, voiceForClose, type KitVoice } from "@/lib/desk/kit";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd } from "@/lib/format";
import type { Position, StrategistState } from "@/lib/desk/types";

const OPEN_MIN = 570; // 9:30 ET
const CLOSE_MIN = 960; // 16:00 ET
const N_STEPS = 16;
const STEP_LEN = (CLOSE_MIN - OPEN_MIN) / N_STEPS; // 24.375 min

// Programmed-day markers (DISPLAY ONLY — the worker owns the real behavior):
// FOMC stand-down flatten opens 13:50 (decide.ts); 0DTE entries roll to 1DTE
// inside the last 31 min (config OPEN_0DTE_CUTOFF_MIN → 15:29); the EOD
// hard-flatten sweeps ~15:55 (fastExitSweep, wall-clock).
const FOMC_STANDDOWN_MIN = 830; // 13:50 ET
const CUTOFF_MIN = CLOSE_MIN - 31; // 15:29 ET
const EOD_FLATTEN_MIN = 955; // 15:55 ET

// ---- ET time helpers (same locale-shift idiom as Shell/MobileApp inRth) ----
function etNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function etMinuteOf(iso: string): number | null {
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const m = d.getHours() * 60 + d.getMinutes();
  return Number.isFinite(m) ? m : null;
}
function etDateOf(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
  } catch {
    return "";
  }
}
function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const mm = Math.floor(min % 60);
  return `${h}:${String(mm).padStart(2, "0")}`;
}
function stepOf(min: number): number {
  return Math.max(0, Math.min(N_STEPS - 1, Math.floor((min - OPEN_MIN) / STEP_LEN)));
}

/** Current session step (0-based) — null outside RTH / on weekends. Also feeds
 *  the shell's STEP LED. */
export function sessionStep(): number | null {
  const et = etNow();
  const dow = et.getDay();
  const min = et.getHours() * 60 + et.getMinutes();
  if (dow < 1 || dow > 5 || min < OPEN_MIN || min >= CLOSE_MIN) return null;
  return stepOf(min);
}

type FillKind = "entry" | "exit";
interface Fill {
  min: number;
  kind: FillKind;
  slug: string;
  text: string;
  neg?: boolean;
  /** kit voice for ▶ REPLAY (entry = kick; exits voiced by close_reason/sign) */
  voice: KitVoice;
}
interface StepEvt {
  key: "FOMC" | "CUT" | "EOD";
  note: string;
}

export function SessionSequencer({
  positions,
  recentTrades,
  strategists,
  variant = "bezel",
}: {
  positions: Position[];
  /** Today's closed trades (the feed's recentTrades). */
  recentTrades: Position[];
  strategists: StrategistState[];
  variant?: "bezel" | "dock";
}) {
  // Re-render every 30s so the running LED / past-future split tracks the clock.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const iv = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(iv);
  }, []);

  const todayET = useMemo(() => {
    void nowTick; // recompute on the clock tick (midnight/DST safety)
    return etDateOf(new Date().toISOString());
  }, [nowTick]);

  const et = etNow();
  const dow = et.getDay();
  const nowMin = et.getHours() * 60 + et.getMinutes();
  const inSession = dow >= 1 && dow <= 5 && nowMin >= OPEN_MIN && nowMin < CLOSE_MIN;
  const cur = inSession ? stepOf(nowMin) : null;
  const afterClose = dow >= 1 && dow <= 5 && nowMin >= CLOSE_MIN;

  const colorOf = (slug: string) => pmVar(strategists.find((s) => s.slug === slug)?.color ?? "green");
  const nameOf = (slug: string) => strategists.find((s) => s.slug === slug)?.name ?? slug;

  // ---- fills per step: entries from open rows + today's closed; exits from closes ----
  const fills = useMemo(() => {
    const out: Fill[][] = Array.from({ length: N_STEPS }, () => []);
    const put = (min: number | null, f: Omit<Fill, "min">) => {
      if (min == null || min < OPEN_MIN || min >= CLOSE_MIN) return;
      out[stepOf(min)].push({ ...f, min });
    };
    const ct = (p: Position) => `${p.strike.toFixed(0)}${p.opt_type === "call" ? "C" : "P"}`;
    for (const p of positions) {
      if (p.opened_at && etDateOf(p.opened_at) === todayET) {
        put(etMinuteOf(p.opened_at), {
          kind: "entry",
          slug: p.strategist_slug,
          text: `in ${ct(p)} ×${Math.abs(p.qty)}`,
          voice: "kick",
        });
      }
    }
    for (const t of recentTrades) {
      if (t.opened_at && etDateOf(t.opened_at) === todayET) {
        put(etMinuteOf(t.opened_at), {
          kind: "entry",
          slug: t.strategist_slug,
          text: `in ${ct(t)} ×${Math.abs(t.qty)}`,
          voice: "kick",
        });
      }
      if (t.closed_at && etDateOf(t.closed_at) === todayET) {
        const pnl = t.realized_pnl ?? 0;
        const why = (t.close_reason ?? "").replace(/^manual:?/, "✋").replace(/_/g, " ").trim();
        put(etMinuteOf(t.closed_at), {
          kind: "exit",
          slug: t.strategist_slug,
          neg: pnl < 0,
          text: `out ${ct(t)} ${signedUsd(pnl)}${why ? ` · ${why}` : ""}`,
          voice: voiceForClose(t.close_reason, pnl),
        });
      }
    }
    for (const arr of out) arr.sort((a, b) => a.min - b.min);
    return out;
  }, [positions, recentTrades, todayET]);

  // ---- programmed events per step (FOMC from the calendar; CUT/EOD daily) ----
  const evts = useMemo(() => {
    const out: (StepEvt | null)[] = Array.from({ length: N_STEPS }, () => null);
    for (const e of eventsOn(todayET)) {
      if (e.minET != null) {
        out[stepOf(FOMC_STANDDOWN_MIN)] = {
          key: "FOMC",
          note: `${e.label} — stand-down 13:50–14:30 (flatten + block entries)`,
        };
      }
    }
    if (!out[stepOf(CUTOFF_MIN)])
      out[stepOf(CUTOFF_MIN)] = { key: "CUT", note: "0DTE entry cutoff 15:29 — entries roll to 1DTE" };
    if (!out[stepOf(EOD_FLATTEN_MIN)])
      out[stepOf(EOD_FLATTEN_MIN)] = { key: "EOD", note: "EOD hard-flatten ~15:55 — nothing rides overnight" };
    return out;
  }, [todayET]);

  // ---- selection: explicit tap > current step > last step with activity ----
  const [sel, setSel] = useState<number | null>(null);
  let lastActive: number | null = null;
  for (let i = N_STEPS - 1; i >= 0; i--) {
    if (fills[i].length) {
      lastActive = i;
      break;
    }
  }
  const selEff = sel ?? cur ?? lastActive ?? 0;

  // ---- fold state, persisted per-skin (desktop open / dock closed by default) ----
  const foldKey = variant === "dock" ? "seve-sq-dock" : "seve-sq-open";
  const [open, setOpen] = useState(variant !== "dock");
  useEffect(() => {
    try {
      const s = window.localStorage.getItem(foldKey);
      if (s != null) setOpen(s === "1");
    } catch {
      /* */
    }
  }, [foldKey]);
  const toggle = () =>
    setOpen((o) => {
      try {
        window.localStorage.setItem(foldKey, o ? "0" : "1");
      } catch {
        /* */
      }
      return !o;
    });

  // ---- ▶ REPLAY DAY (slice 4): chase the 16 steps, slice readout follows,
  // fills voice through the kit (playKit no-ops while the KIT pad is off).
  const [chase, setChase] = useState<number | null>(null);
  const [replaying, setReplaying] = useState(false);
  const replayIv = useRef<number | null>(null);
  useEffect(() => () => { if (replayIv.current != null) window.clearInterval(replayIv.current); }, []);
  const stopReplay = () => {
    if (replayIv.current != null) window.clearInterval(replayIv.current);
    replayIv.current = null;
    setChase(null);
    setSel(null);
    setReplaying(false);
  };
  const replay = () => {
    if (replayIv.current != null) { stopReplay(); return; }
    if (!open) toggle();
    setReplaying(true);
    let i = 0;
    replayIv.current = window.setInterval(() => {
      if (i >= N_STEPS) { stopReplay(); return; }
      setChase(i);
      setSel(i);
      fills[i].slice(0, 4).forEach((f, j) => {
        window.setTimeout(() => playKit(f.voice), j * 90);
      });
      i++;
    }, 340);
  };

  const steps = (
    <div className="sq-steps">
      {Array.from({ length: N_STEPS }, (_, i) => {
        const start = OPEN_MIN + i * STEP_LEN;
        const evt = evts[i];
        const cls = ["sq-step"];
        if (i % 4 === 0) cls.push("acc");
        if (cur != null ? i < cur : afterClose) cls.push("past");
        if (i === cur) cls.push("cur");
        if (i === sel) cls.push("sel");
        if (i === chase) cls.push("chased");
        return (
          <button
            key={i}
            type="button"
            className={cls.join(" ")}
            onClick={() => setSel((s) => (s === i ? null : i))}
            title={`step ${i + 1} · ${fmtMin(start)}–${fmtMin(start + STEP_LEN)} ET${evt ? ` · ${evt.key}` : ""}`}
            aria-label={`step ${i + 1}, ${fmtMin(start)} ET, ${fills[i].length} fills`}
          >
            <span className="sq-num">{i + 1}</span>
            <span className="sq-time">{fmtMin(start)}</span>
            {evt && <span className={`sq-evt sq-evt--${evt.key}`}>{evt.key}</span>}
            <span className="sq-dots">
              {fills[i].slice(0, 8).map((f, j) => (
                <i
                  key={j}
                  className={`sq-d${f.kind === "exit" ? " sq-d--x" : ""}`}
                  style={{ ["--c" as string]: colorOf(f.slug) }}
                />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );

  const sliceStart = OPEN_MIN + selEff * STEP_LEN;
  const slice = (
    <div className="sq-slice">
      <span className="sq-slk">
        Step {selEff + 1} · {fmtMin(sliceStart)}–{fmtMin(sliceStart + STEP_LEN)}
      </span>
      {fills[selEff].length === 0 && !evts[selEff] && (
        <span className="sq-sld">{cur != null && selEff > cur ? "ahead — nothing programmed" : "quiet — no fills"}</span>
      )}
      {fills[selEff].map((f, j) => (
        <span key={j} className="sq-sle">
          <b style={{ color: colorOf(f.slug) }}>{nameOf(f.slug)}</b>{" "}
          <span className={f.kind === "exit" ? (f.neg ? "sq-dn" : "sq-up") : undefined}>
            {fmtMin(f.min)} {f.text}
          </span>
        </span>
      ))}
      {evts[selEff] && <span className="sq-sld">⚑ {evts[selEff]!.note}</span>}
    </div>
  );

  if (variant === "dock") {
    const mini = (
      <span className="m-sq-mini" aria-hidden>
        {Array.from({ length: N_STEPS }, (_, i) => {
          const style: CSSProperties = {};
          if (fills[i].length) style.background = colorOf(fills[i][0].slug);
          const evt = evts[i];
          if (evt) {
            style.background =
              evt.key === "FOMC" ? "var(--stripe-red)" : evt.key === "CUT" ? "#b07d10" : "var(--stripe-orange)";
            style.opacity = 0.55;
          }
          if (i === cur) {
            style.background = "var(--led-red)";
            style.boxShadow = "0 0 5px var(--led-red)";
            style.opacity = 1;
          }
          return <i key={i} style={style} />;
        })}
      </span>
    );
    return (
      <div className={`m-sqdock${open ? " open" : ""}`}>
        <div className="m-sqhead">
          <button type="button" className="m-sqbar" onClick={toggle} aria-expanded={open} aria-label="session sequencer">
            <span className="m-sq-lbl">Seq</span>
            {mini}
            <span className="m-sq-step">{cur != null ? `${cur + 1}·16` : afterClose ? "done" : "pre"}</span>
            <span className="m-sq-ch">{open ? "▼" : "▲"}</span>
          </button>
          <button type="button" className={`m-sq-play${replaying ? " busy" : ""}`} onClick={replay} title="replay the day through the kit" aria-label="replay day">
            {replaying ? "■" : "▶"}
          </button>
        </div>
        {open && (
          <div className="m-sqbody">
            {steps}
            {slice}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`sqz${open ? "" : " folded"}`}>
      <div className="sqz-head">
        <button type="button" className="sqz-bar" onClick={toggle} aria-expanded={open}>
          <span className="sqz-title">Session Sequencer</span>
          <span className="sqz-sub">16 steps · 9:30 → 16:00 ET · fills light the pattern · events programmed ahead</span>
          <span className="sqz-now">{cur != null ? `step ${cur + 1}·16` : afterClose ? "session done" : "pre-open"}</span>
          <span className="sqz-ch">{open ? "▾" : "▸"}</span>
        </button>
        <button type="button" className={`sqz-play${replaying ? " busy" : ""}`} onClick={replay} title="replay the day — chases the pattern; fills voice through the kit when it's on">
          {replaying ? "■ STOP" : "▶ REPLAY DAY"}
        </button>
        <KitToggle />
      </div>
      {open && (
        <>
          <div className="sq-leds">
            {Array.from({ length: N_STEPS }, (_, i) => (
              <i key={i} className={`sq-led${i === cur ? " on" : ""}`} />
            ))}
          </div>
          {steps}
          {slice}
        </>
      )}
    </div>
  );
}
