"use client";

import { useState } from "react";
import { Knob } from "@/components/console/hw/Knob";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, usd0 } from "@/lib/format";
import { strikeLabel } from "@/lib/studio/channelDecision";
import type { StrategistState, StrategistConfig } from "@/lib/desk/types";
import type { StudioChannelRow } from "@/lib/studio/deriveStudioView";
import type { ChannelPassport } from "@/lib/channels/channelPassport";
import type { SurfaceProps } from "@/components/surfaceTypes";

const GIVEBACK_NOTE: Record<string, string> = { "momo-shape": "arm +50% · keep ⅔" };
const PYRAMID_ELIGIBLE = new Set(["breakout-alt-v3", "breakout-smart-entries"]);

export function ChannelInspector({ strategist, summary, passport, write }: {
  strategist: StrategistState | undefined;
  summary?: StudioChannelRow;
  passport?: ChannelPassport;
  write: SurfaceProps["write"];
}) {
  const dispatch = useDeskDispatch();
  const { persistConfig, setChannelStatus, duplicateChannel, deleteChannel } = write;
  const canWrite = write.canWrite && passport?.release.state !== "verified";
  const [confirmDel, setConfirmDel] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!strategist) return <aside className="inspector mixer-inspector"><div className="insp-head"><span className="idx">02</span><span className="t">INSPECTOR</span><span className="grow" /><span className="x">select a fleet row</span></div><div className="insp-empty">no channel selected</div></aside>;

  const { id, slug, underlying, color, status, config } = strategist;
  const dte = config.entry_dte ?? 0;
  const eventPolicy = config.event_policy ?? "standdown";
  const ustop = config.underlying_stop_pct ?? 0;
  const premStop = config.premium_stop_pct ?? 50;
  const ustopOff = ustop > 0 && ustop * 180 >= premStop;
  const pyr = config.pyramid_adds ?? 0;
  const pyrEligible = PYRAMID_ELIGIBLE.has(slug);
  const giveback = GIVEBACK_NOTE[slug];

  const stageCfg = (patch: Partial<StrategistConfig>) => dispatch({ type: "SET_CONFIG", slug, patch });
  const commitCfg = (patch: Partial<StrategistConfig>) => persistConfig(id, patch);
  const setCfg = (patch: Partial<StrategistConfig>) => { stageCfg(patch); commitCfg(patch); };
  const toggleBench = () => {
    const next = status === "armed" ? "draft" : "armed";
    dispatch({ type: "SET_STATUS", slug, status: next });
    setChannelStatus(id, next).then((r) => { if (!r.ok) { dispatch({ type: "SET_STATUS", slug, status }); setErr(r.error ?? "status change failed"); } });
  };
  const doDuplicate = async () => {
    setErr(null); setMsg(null); setBusy(true);
    const r = await duplicateChannel(id); setBusy(false);
    if (r.ok) setMsg(`✓ ${r.name} — drafted on the bench.`); else setErr(r.error ?? "duplicate failed");
  };
  const doDelete = async () => {
    const r = await deleteChannel(id);
    if (r.ok) { setConfirmDel(false); dispatch({ type: "REMOVE", slug }); }
    else { setConfirmDel(false); setErr(r.error ?? "remove failed"); }
  };
  const seg = <T extends string | number>(cur: T, opts: { v: T; label: string }[], onPick: (v: T) => void) => <span className="iseg">{opts.map((o) => <button key={String(o.v)} type="button" className={o.v === cur ? "on" : ""} disabled={!canWrite} onClick={() => canWrite && onPick(o.v)}>{o.label}</button>)}</span>;
  const step = (label: string, value: string, dec: () => void, inc: () => void) => <span className="istep"><button type="button" disabled={!canWrite} onClick={dec} aria-label={`decrease ${label}`}>−</button><b>{value}</b><button type="button" disabled={!canWrite} onClick={inc} aria-label={`increase ${label}`}>+</button></span>;
  const knob = (value: number, min: number, max: number, stepBy: number, label: string, format: (v: number) => string, key: keyof StrategistConfig, cap?: string, writable = true) => (
    <Knob value={value} min={min} max={max} step={stepBy} size="sm" label={label} format={format} disabled={!canWrite || !writable}
      color="var(--pm)" cap={cap} onChange={(next) => stageCfg({ [key]: next })} onCommit={(next) => commitCfg({ [key]: next })} />
  );

  return (
    <aside className="inspector mixer-inspector" style={{ ["--pm" as string]: pmVar(color) }}>
      <div className="insp-head"><span className="idx">02</span><span className="t">INSPECTOR</span><span className="grow" /><span className="x">{slug}</span></div>
      <div className="insp-hero">
        <span className="ih-slug">{slug}</span><span className="ih-tk">{underlying}</span>
        {passport && <span className={`ih-tag lane-${passport.lifecycle}`}>{passport.lifecycleLabel}</span>}
        {giveback && <span className="ih-tag amber">⚡ A13 ratchet</span>}
        <span className="ih-stats">state <b>{summary?.stateLabel ?? status.toUpperCase()}</b> · open <b>{summary?.pnl.openCount ?? 0}</b> · day <b>{signedUsd(summary?.pnl.dayPnl ?? 0)}</b></span>
      </div>
      <div className="mixer-meter">
        <span><small>RUNTIME</small><b>{passport?.lifecycleLabel ?? "UNVERIFIED"}</b></span>
        <span><small>DATABASE</small><b>{passport ? `${passport.database.state} · ${passport.database.executor}` : status.toUpperCase()}</b></span>
        <span><small>POLICY</small><b>{passport?.rootPolicy?.familyId ?? "NO-FILL EVIDENCE"}</b></span>
      </div>

      <div className="mixer-deck">
        <section className={`mix-bank mix-bank--runtime lane-${passport?.lifecycle ?? "unverified"}`}><header>SEALED RUNTIME · BASELINE, NOT LEARNED</header><div className="runtime-bank">
          <p>{passport?.lifecycleFact ?? "Runtime lifecycle is not verified."}</p>
          {passport?.rootPolicy ? <>
            <span><small>FAMILY</small><b>{passport.rootPolicy.familyId}</b></span>
            <span><small>SIZE</small><b>{passport.rootPolicy.quantity} contracts</b></span>
            <span><small>RISK</small><b>{usd0(passport.rootPolicy.riskBudgetUsd)}</b></span>
            <span><small>PREMIUM / DEBIT</small><b>${passport.rootPolicy.premiumCap.toFixed(2)} / {usd0(passport.rootPolicy.aggregateDebitCap)}</b></span>
            <span><small>EXIT</small><b>−{passport.rootPolicy.premiumStopPct}% · RIDE · {passport.rootPolicy.eodEt} ET</b></span>
            <span><small>ADMISSION</small><b>priority {passport.rootPolicy.priority} · one/family</b></span>
          </> : <span className="runtime-wide"><small>RESEARCH PATH</small><b>candidate stamp → exact OCC → T+1 Databento reconstruction</b></span>}
        </div></section>

        <section className="mix-bank mix-bank--entry"><header>DATABASE ENTRY CONFIG · FUTURE EPOCH</header><div className="mix-bank-body">
          <div className="ctl"><span className="cl">entry dte</span>{seg(dte, [{ v: 0, label: "0DTE" }, { v: 1, label: "1DTE" }], (v) => setCfg({ entry_dte: v }))}</div>
          <div className="ctl"><span className="cl">strike offset</span><span className="ival" title="effective configured strike offset">{strikeLabel(config.strike_offset ?? 0)}</span></div>
          <div className="ctl"><span className="cl">event policy</span>{seg(eventPolicy, [{ v: "standdown", label: "STAND-DOWN" }, { v: "ignore", label: "TRADE-THRU" }], (v) => setCfg({ event_policy: v }))}</div>
        </div></section>

        <section className="mix-bank mix-bank--gain"><header>DATABASE KNOBS · NOT ACTIVE RC5</header><div className="knob-bank">
          {knob(config.capital_pct, 100, 2500, 50, "RISK / TRADE", (v) => usd0(v), "capital_pct")}
          {knob(config.daily_stop_usd, 100, 5000, 50, "ENTRY LATCH", (v) => `−${usd0(v)}/d`, "daily_stop_usd", "#25272a")}
          {knob(premStop, 10, 90, 5, "PREM STOP · POLICY", (v) => `−${v}%`, "premium_stop_pct", "#25272a", false)}
          {knob(config.max_contracts, 1, 60, 1, "HARD CAP", (v) => `${v} ct`, "max_contracts")}
        </div></section>

        <section className="mix-bank"><header>EXIT SHAPE</header><div className="mix-bank-body two-col">
          <div className="ctl"><span className="cl">u-stop %{ustopOff && <span className="uoff">uS·off</span>}</span>{step("u-stop", ustop === 0 ? "off" : `${ustop.toFixed(2)}%`, () => setCfg({ underlying_stop_pct: Math.max(0, +(ustop - 0.05).toFixed(2)) }), () => setCfg({ underlying_stop_pct: Math.min(2, +(ustop + 0.05).toFixed(2)) }))}</div>
          <div className="ctl"><span className="cl">take profit</span>{step("take profit", config.take_profit_pct ? `+${config.take_profit_pct}%` : "ride", () => setCfg({ take_profit_pct: Math.max(0, (config.take_profit_pct ?? 0) - 5) }), () => setCfg({ take_profit_pct: Math.min(300, (config.take_profit_pct ?? 0) + 5) }))}</div>
          {pyrEligible ? <div className="ctl"><span className="cl">pyramid</span>{seg(pyr > 0 ? "on" : "off", [{ v: "off", label: "OFF" }, { v: "on", label: "+3 · CAP12" }], (v) => setCfg(v === "on" ? { pyramid_adds: 3, max_contracts: Math.max(config.max_contracts, 12) } : { pyramid_adds: 0 }))}</div> : <div className="ctl"><span className="cl">pyramid</span><span className="ival muted">n/a</span></div>}
          <div className="ctl"><span className="cl">giveback trail{giveback ? " · A13" : ""}</span><span className="ival">{giveback ?? "—"}</span></div>
        </div></section>

        <section className="mix-bank mix-bank--posture"><header>CHANNEL POSTURE</header><div className="posture-pads">
          <button type="button" className={config.muted ? "on mute" : ""} disabled={!canWrite} onClick={() => setCfg({ muted: !config.muted })}><i />MUTE<small>{config.muted ? "held" : "ready"}</small></button>
          <button type="button" className={config.boosted ? "on boost" : ""} disabled={!canWrite} onClick={() => setCfg({ boosted: !config.boosted })}><i />BOOST<small>{config.boosted ? "2× today" : "normal"}</small></button>
        </div></section>
      </div>

      <div className="insp-foot">
        <button type="button" className="life" disabled={!canWrite} onClick={toggleBench}>{status === "armed" ? "BENCH" : "RE-ARM"}</button>
        <button type="button" className="life" disabled={!canWrite || busy} onClick={doDuplicate}>{busy ? "…" : "DUPLICATE"}</button>
        {!confirmDel ? <button type="button" className="life del" disabled={!canWrite} onClick={() => setConfirmDel(true)}>DELETE</button> : <><button type="button" className="life del" onClick={doDelete}>CONFIRM</button><button type="button" className="life" onClick={() => setConfirmDel(false)}>CANCEL</button></>}
      </div>
      {passport?.release.state === "verified" && <div className="insp-note sealed">SEALED RELEASE · CONTROLS ARE READ-ONLY · FORK A NEW CONFIGURATION EPOCH TO TUNE</div>}
      {(msg || err) && <div className={`insp-note${err ? " err" : ""}`}>{err ?? msg}</div>}
    </aside>
  );
}
