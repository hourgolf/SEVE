"use client";

import { useState } from "react";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { pmVar } from "@/lib/desk/colors";
import type { StrategistState, StrategistConfig } from "@/lib/desk/types";

// =============================================================================
// STUDIO · CHANNEL INSPECTOR (PERFORM/STUDIO rebuild · slice S3)
// The selected channel's advanced knobs — the ChannelStrip flip-card editor
// RE-LAID-OUT into the right rail (mock F #inspector). Same fields, same write
// paths: setCfg (dispatch SET_CONFIG + persistConfig) for the config knobs,
// setChannelExecutor / setChannelStatus / duplicateChannel / deleteChannel for
// executor + lifecycle. Nothing new is written; only the layout changed. Anon =
// read-only (the write helpers no-op without a session; we also gate the UI).
//
// Read-only here (no config column to write): STRIKE (there is no strike_offset
// in strategist_config) and the A13 GIVEBACK TRAIL (a worker config map, not a
// per-channel column). Both are surfaced honestly as display-only, matching the
// mock's intent without inventing a write path.
// =============================================================================

// The giveback-trail note is worker-side (worker/src/config.ts GIVEBACK_TRAIL) — display only.
const GIVEBACK_NOTE: Record<string, string> = {
  "momo-shape": "arm +50% · keep ⅔",
};
const PYRAMID_ELIGIBLE = new Set(["breakout-alt-v3", "breakout-smart-entries"]);

export function ChannelInspector({ strategist, pk, win, n }: {
  strategist: StrategistState | undefined;
  pk?: number | null;
  win?: number | null;
  n?: number | null;
}) {
  const dispatch = useDeskDispatch();
  const { persistConfig, setChannelExecutor, setChannelStatus, duplicateChannel, deleteChannel, canWrite } = useDeskWrite();
  const [confirmDel, setConfirmDel] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!strategist) {
    return (
      <aside className="inspector">
        <div className="insp-head"><span className="idx">02</span><span className="t">INSPECTOR</span><span className="grow" /><span className="x">click a rack row to select</span></div>
        <div className="insp-empty">no channel selected</div>
      </aside>
    );
  }

  const { id, slug, underlying, color, status, config } = strategist;
  const executor = strategist.executor ?? "cron";
  const dte = config.entry_dte ?? 0;
  const eventPolicy = config.event_policy ?? "standdown";
  const ustop = config.underlying_stop_pct ?? 0;
  const premStop = config.premium_stop_pct ?? 50;
  const ustopOff = ustop > 0 && ustop * 180 >= premStop; // premium stop fires first → u-stop never binds
  const pyr = config.pyramid_adds ?? 0;
  const pyrEligible = PYRAMID_ELIGIBLE.has(slug);
  const giveback = GIVEBACK_NOTE[slug];

  const setCfg = (patch: Partial<StrategistConfig>) => {
    dispatch({ type: "SET_CONFIG", slug, patch });
    persistConfig(id, patch);
  };
  const flipExecutor = (next: "cron" | "stream") => {
    if (next === executor) return;
    dispatch({ type: "SET_EXECUTOR", slug, executor: next });
    setChannelExecutor(id, next).then((r) => { if (!r.ok) { dispatch({ type: "SET_EXECUTOR", slug, executor }); setErr(r.error ?? "executor change failed"); } });
  };
  const toggleBench = () => {
    const next = status === "armed" ? "draft" : "armed";
    dispatch({ type: "SET_STATUS", slug, status: next });
    setChannelStatus(id, next).then((r) => { if (!r.ok) { dispatch({ type: "SET_STATUS", slug, status }); setErr(r.error ?? "status change failed"); } });
  };
  const doDuplicate = async () => {
    setErr(null); setMsg(null); setBusy(true);
    const r = await duplicateChannel(id);
    setBusy(false);
    if (r.ok) setMsg(`✓ ${r.name} — drafted on the bench.`);
    else setErr(r.error ?? "duplicate failed");
  };
  const doDelete = async () => {
    const r = await deleteChannel(id);
    if (r.ok) { setConfirmDel(false); dispatch({ type: "REMOVE", slug }); }
    else { setConfirmDel(false); setErr(r.error ?? "remove failed"); }
  };

  // a compact segmented control (reads the inspector .iseg styling)
  const seg = <T extends string | number>(cur: T, opts: { v: T; label: string }[], onPick: (v: T) => void) => (
    <span className="iseg">
      {opts.map((o) => (
        <button key={String(o.v)} type="button" className={o.v === cur ? "on" : ""}
          disabled={!canWrite} onClick={() => canWrite && onPick(o.v)}>{o.label}</button>
      ))}
    </span>
  );
  const step = (label: string, value: string, dec: () => void, inc: () => void) => (
    <span className="istep">
      <button type="button" disabled={!canWrite} onClick={dec} aria-label={`decrease ${label}`}>−</button>
      <b>{value}</b>
      <button type="button" disabled={!canWrite} onClick={inc} aria-label={`increase ${label}`}>+</button>
    </span>
  );

  return (
    <aside className="inspector">
      <div className="insp-head"><span className="idx">02</span><span className="t">INSPECTOR</span><span className="grow" /><span className="x">{slug}</span></div>

      <div className="insp-hero">
        <span className="ih-slug" style={{ ["--pm" as string]: pmVar(color) }}>{slug}</span>
        <span className="ih-tk">{underlying}</span>
        {giveback && <span className="ih-tag amber">⚡ A13 ratchet</span>}
        <span className="ih-stats">
          pk <b>{pk != null ? `+${pk}%` : "—"}</b> · win <b>{win != null ? `${win}%` : "—"}</b> · N <b>{n ?? "—"}</b>
        </span>
      </div>

      <div className="insp-grid">
        <div className="ctl"><span className="cl">executor</span>
          {seg(executor, [{ v: "stream", label: "STREAM" }, { v: "cron", label: "CRON" }], flipExecutor)}</div>
        <div className="ctl"><span className="cl">entry dte</span>
          {seg(dte, [{ v: 0, label: "0DTE" }, { v: 1, label: "1DTE" }], (v) => setCfg({ entry_dte: v }))}</div>
        <div className="ctl"><span className="cl">strike</span>
          <span className="ival" title="no strike-offset column to write — informational">ATM</span></div>
        <div className="ctl">
          <span className="cl">u-stop %{ustopOff && <span className="uoff" title="premium stop fires first — the underlying stop never binds">uS·off</span>}</span>
          {step("u-stop", ustop === 0 ? "off" : `${ustop.toFixed(2)}%`,
            () => setCfg({ underlying_stop_pct: Math.max(0, +(ustop - 0.05).toFixed(2)) }),
            () => setCfg({ underlying_stop_pct: Math.min(2, +(ustop + 0.05).toFixed(2)) }))}</div>
        <div className="ctl"><span className="cl">max contracts</span>
          {step("max contracts", String(config.max_contracts),
            () => setCfg({ max_contracts: Math.max(1, config.max_contracts - 1) }),
            () => setCfg({ max_contracts: Math.min(60, config.max_contracts + 1) }))}</div>
        <div className="ctl"><span className="cl">take-profit %</span>
          {step("take profit", config.take_profit_pct ? `+${config.take_profit_pct}%` : "ride",
            () => setCfg({ take_profit_pct: Math.max(0, (config.take_profit_pct ?? 0) - 5) }),
            () => setCfg({ take_profit_pct: Math.min(300, (config.take_profit_pct ?? 0) + 5) }))}</div>
        {pyrEligible ? (
          <div className="ctl"><span className="cl">pyramid</span>
            {seg(pyr > 0 ? "on" : "off", [{ v: "off", label: "OFF" }, { v: "on", label: "+3·CAP12" }],
              (v) => setCfg(v === "on" ? { pyramid_adds: 3, max_contracts: Math.max(config.max_contracts, 12) } : { pyramid_adds: 0 }))}</div>
        ) : (
          <div className="ctl"><span className="cl">pyramid</span><span className="ival" style={{ color: "var(--dk-dim)" }}>n/a</span></div>
        )}
        <div className="ctl"><span className="cl">event policy · fomc</span>
          {seg(eventPolicy, [{ v: "standdown", label: "STAND-DOWN" }, { v: "ignore", label: "TRADE-THRU" }], (v) => setCfg({ event_policy: v }))}</div>
        <div className="ctl insp-wide"><span className="cl">giveback trail{giveback ? " · A13" : ""}</span>
          <span className="ival" style={giveback ? undefined : { color: "var(--dk-dim)" }}>{giveback ?? "—"}</span></div>
      </div>

      <div className="insp-foot">
        <button type="button" className="life" disabled={!canWrite} onClick={toggleBench}
          title={status === "armed" ? "bench: stop entries; open positions wind down" : "re-arm: trades again next cycle"}>
          {status === "armed" ? "BENCH" : "RE-ARM"}
        </button>
        <button type="button" className="life" disabled={!canWrite || busy} onClick={doDuplicate}
          title="clone as a draft for an A/B variant">{busy ? "…" : "DUPLICATE"}</button>
        {!confirmDel ? (
          <button type="button" className="life del" disabled={!canWrite} onClick={() => setConfirmDel(true)}>DELETE</button>
        ) : (
          <>
            <button type="button" className="life del" onClick={doDelete}>CONFIRM</button>
            <button type="button" className="life" onClick={() => setConfirmDel(false)}>CANCEL</button>
          </>
        )}
        <span className="reg">⚖ registry governs — changes log to calibration</span>
      </div>
      {(msg || err) && <div className={`insp-note${err ? " err" : ""}`}>{err ?? msg}</div>}
    </aside>
  );
}
