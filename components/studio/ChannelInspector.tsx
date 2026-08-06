"use client";

import { useState } from "react";
import { Knob } from "@/components/console/hw/Knob";
import { ChannelConfigDraftPanel } from "@/components/studio/ChannelConfigDraftPanel";
import { ChannelDecisionCard } from "@/components/studio/ChannelDecisionCard";
import { ChannelRosterActivationConsole } from "@/components/studio/ChannelRosterActivationConsole";
import { ChannelDryPowderCurve } from "@/components/research/ChannelDryPowderCurve";
import { ChannelManagerEvidencePanel } from "@/components/research/ChannelManagerEvidencePanel";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useChannelConfigDraft } from "@/hooks/useChannelConfigDraft";
import { useChannelManagerProposal } from "@/hooks/useChannelManagerProposal";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, usd0 } from "@/lib/format";
import { strikeLabel } from "@/lib/studio/channelDecision";
import type { StrategistState, StrategistConfig } from "@/lib/desk/types";
import type { StudioChannelRow } from "@/lib/studio/deriveStudioView";
import type { ChannelPassport } from "@/lib/channels/channelPassport";
import { activeRootExitLabel } from "@/lib/channels/activeRelease";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { ChannelControlPlaneViewRead } from "@/hooks/useChannelControlPlaneView";
import type { ChannelDryPowderCurve as DryPowderCurve } from "@/lib/research/shadowResearch";
import type { ChannelManagerEvidence } from "@/lib/research/channelManagerEvidence";

const PYRAMID_ELIGIBLE = new Set(["breakout-alt-v3", "breakout-smart-entries"]);

export function ChannelInspector({ strategist, summary, passport, write, controlPlane, dryPowder, managerEvidence, onClose }: {
  strategist: StrategistState | undefined;
  summary?: StudioChannelRow;
  passport?: ChannelPassport;
  write: SurfaceProps["write"];
  controlPlane?: ChannelControlPlaneViewRead;
  dryPowder?: DryPowderCurve;
  managerEvidence?: ChannelManagerEvidence;
  onClose?: () => void;
}) {
  const dispatch = useDeskDispatch();
  const { persistConfig, setChannelStatus, duplicateChannel, deleteChannel } = write;
  const activeSpec = strategist
    ? controlPlane?.view?.bySlug[strategist.slug] ?? null
    : null;
  const draft = useChannelConfigDraft(
    strategist,
    passport,
    activeSpec,
    controlPlane?.view?.configurationEpochId,
  );
  const managerProposal = useChannelManagerProposal({
    model: draft.model,
    activeSpec,
    onSealed: draft.discard,
  });
  const [confirmDel, setConfirmDel] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passportOpen, setPassportOpen] = useState(false);

  if (!strategist) return <aside className="inspector mixer-inspector collapsed" aria-label="Channel inspector; select a fleet row to open">
    <div className="inspector-rail" aria-hidden="true"><span>02</span><b>INSPECTOR</b><i>SELECT CHANNEL</i></div>
  </aside>;

  const { id, slug, underlying, color, status, config: databaseConfig } = strategist;
  const sealed = passport?.release.state === "verified";
  const rootPolicy = passport?.rootPolicy;
  const config = draft.active
    ? draft.proposed ?? draft.baseConfig ?? databaseConfig
    : draft.baseConfig ?? databaseConfig;
  const canPersist = write.canDirectConfigure && !sealed;
  const canTune = draft.active || canPersist;
  const dte = config.entry_dte ?? 0;
  const eventPolicy = config.event_policy ?? "standdown";
  const ustop = config.underlying_stop_pct ?? 0;
  const premStop = config.premium_stop_pct ?? 50;
  const ustopOff = ustop > 0 && ustop * 180 >= premStop;
  const pyr = config.pyramid_adds ?? 0;
  const pyrEligible = PYRAMID_ELIGIBLE.has(slug);
  const managerLabel = rootPolicy?.managerLabel;
  const a13 = rootPolicy?.runner === "a13";

  const stageCfg = (patch: Partial<StrategistConfig>) => draft.active ? draft.update(patch) : dispatch({ type: "SET_CONFIG", slug, patch });
  const commitCfg = (patch: Partial<StrategistConfig>) => draft.active ? draft.update(patch) : persistConfig(id, patch);
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
  const seg = <T extends string | number>(cur: T, opts: { v: T; label: string }[], onPick: (v: T) => void) => <span className="iseg">{opts.map((o) => <button key={String(o.v)} type="button" className={o.v === cur ? "on" : ""} disabled={!canTune} onClick={() => canTune && onPick(o.v)}>{o.label}</button>)}</span>;
  const step = (label: string, value: string, dec: () => void, inc: () => void) => <span className="istep"><button type="button" disabled={!canTune} onClick={dec} aria-label={`decrease ${label}`}>−</button><b>{value}</b><button type="button" disabled={!canTune} onClick={inc} aria-label={`increase ${label}`}>+</button></span>;
  const knob = (value: number, min: number, max: number, stepBy: number, label: string, format: (v: number) => string, key: keyof StrategistConfig, cap?: string, writable = true) => (
    <Knob value={value} min={min} max={max} step={stepBy} size="sm" label={label} format={format} disabled={!canTune || (!writable && !draft.active)}
      color="var(--pm)" cap={cap} onChange={(next) => stageCfg({ [key]: next })} onCommit={(next) => commitCfg({ [key]: next })} />
  );

  return (
    <aside className="inspector mixer-inspector" style={{ ["--pm" as string]: pmVar(color) }}>
      <div className="insp-head"><span className="idx">02</span><span className="t">INSPECTOR</span><span className="grow" /><button type="button" className="insp-close" onClick={onClose} aria-label="Close channel inspector">×</button></div>
      <div className="insp-hero">
        <span className="ih-slug">{slug}</span><span className="ih-tk">{underlying}</span>
        {passport && <span className={`ih-tag lane-${passport.lifecycle}`}>{passport.effective.execution.label}</span>}
        {a13 && <span className="ih-tag amber">⚡ A13</span>}
        <span className="ih-stats">state <b>{summary?.stateLabel ?? status.toUpperCase()}</b> · open <b>{summary?.pnl.openCount ?? 0}</b> · day <b>{signedUsd(summary?.pnl.dayPnl ?? 0)}</b></span>
      </div>
      <div className="mixer-deck">
        <ChannelDryPowderCurve curve={dryPowder} defaultContracts={rootPolicy?.quantity ?? 2} compact />
        <ChannelManagerEvidencePanel evidence={managerEvidence} currentManagerLabel={managerLabel} currentConfigurationEpochId={controlPlane?.view?.configurationEpochId} compact />
        <section className="mix-bank mix-bank--entry"><header>{draft.active ? "LOCAL DRAFT · ENTRY CONFIG" : rootPolicy ? "SEALED RUNTIME · ENTRY CONFIG" : "DATABASE ENTRY CONFIG · FUTURE EPOCH"}</header><div className="mix-bank-body">
          <div className="ctl"><span className="cl">entry dte</span>{seg(dte, [{ v: 0, label: "0DTE" }, { v: 1, label: "1DTE" }], (v) => setCfg({ entry_dte: v }))}</div>
          <div className="ctl"><span className="cl">strike offset</span><span className="ival" title="effective configured strike offset">{strikeLabel(config.strike_offset ?? 0)}</span></div>
          <div className="ctl"><span className="cl">event policy</span>{seg(eventPolicy, [{ v: "standdown", label: "STAND-DOWN" }, { v: "ignore", label: "TRADE-THRU" }], (v) => setCfg({ event_policy: v }))}</div>
        </div></section>

        <section className="mix-bank mix-bank--gain"><header>{draft.active ? "LOCAL DRAFT · RISK + SIZE" : rootPolicy ? "SEALED RUNTIME · RISK + SIZE" : "DATABASE KNOBS · FUTURE EPOCH"}</header><div className="knob-bank">
          {knob(config.capital_pct, 25, 5000, 25, "RISK / TRADE", (v) => usd0(v), "capital_pct")}
          {knob(config.daily_stop_usd, 0, 5000, 50, "ENTRY LATCH", (v) => v === 0 ? "OFF" : `−${usd0(v)}/d`, "daily_stop_usd", "#25272a")}
          {knob(premStop, 10, 90, 5, "PREM STOP · POLICY", (v) => `−${v}%`, "premium_stop_pct", "#25272a", false)}
          {knob(config.max_contracts, 1, 12, 1, "HARD CAP", (v) => `${v} ct`, "max_contracts")}
        </div></section>

        <section className="mix-bank"><header>{draft.active ? "LOCAL DRAFT · EXIT SHAPE" : "EXIT SHAPE"}</header><div className="mix-bank-body two-col">
          <div className="ctl"><span className="cl">u-stop %{ustopOff && <span className="uoff">uS·off</span>}</span>{step("u-stop", ustop === 0 ? "off" : `${ustop.toFixed(2)}%`, () => setCfg({ underlying_stop_pct: Math.max(0, +(ustop - 0.05).toFixed(2)) }), () => setCfg({ underlying_stop_pct: Math.min(2, +(ustop + 0.05).toFixed(2)) }))}</div>
          <div className="ctl"><span className="cl">take profit</span>{step("take profit", config.take_profit_pct ? `+${config.take_profit_pct}%` : "ride", () => setCfg({ take_profit_pct: Math.max(0, (config.take_profit_pct ?? 0) - 5) }), () => setCfg({ take_profit_pct: Math.min(300, (config.take_profit_pct ?? 0) + 5) }))}</div>
          {pyrEligible ? <div className="ctl"><span className="cl">pyramid</span>{seg(pyr > 0 ? "on" : "off", [{ v: "off", label: "OFF" }, { v: "on", label: "+3 · CAP12" }], (v) => setCfg(v === "on" ? { pyramid_adds: 3, max_contracts: Math.max(config.max_contracts, 12) } : { pyramid_adds: 0 }))}</div> : <div className="ctl"><span className="cl">pyramid</span><span className="ival muted">n/a</span></div>}
          <div className="ctl"><span className="cl">manager profile</span><span className="ival">{managerLabel ?? "—"}</span></div>
        </div></section>

        <section className="mix-bank mix-bank--posture"><header>CHANNEL POSTURE</header><div className="posture-pads">
          <button type="button" className={databaseConfig.muted ? "on mute" : ""} disabled={!canPersist} onClick={() => setCfg({ muted: !databaseConfig.muted })}><i />MUTE<small>{databaseConfig.muted ? "held" : "ready"}</small></button>
          <button type="button" className={databaseConfig.boosted ? "on boost" : ""} disabled={!canPersist} onClick={() => setCfg({ boosted: !databaseConfig.boosted })}><i />BOOST<small>{databaseConfig.boosted ? "2× today" : "normal"}</small></button>
        </div></section>
        <div className="mixer-meter">
          <span><small>RUNTIME</small><b>{passport?.effective.execution.label ?? "UNVERIFIED"}</b></span>
          <span><small>DATABASE</small><b>{passport ? `${passport.database.state} · ${passport.database.executor}` : status.toUpperCase()}</b></span>
          <span><small>POLICY</small><b>{passport?.rootPolicy?.familyId ?? "NO-FILL EVIDENCE"}</b></span>
        </div>
        <section className={`mix-bank mix-bank--runtime lane-${passport?.lifecycle ?? "unverified"}${passportOpen ? " open" : " collapsed"}`}>
          <button
            type="button"
            className="desktop-passport-toggle"
            aria-expanded={passportOpen}
            onClick={() => setPassportOpen((open) => !open)}
          >
            <span>RUNTIME PASSPORT · BASELINE, NOT LEARNED</span>
            <b>{passport?.lifecycleLabel ?? "UNVERIFIED"}</b>
            <i aria-hidden="true">{passportOpen ? "▾" : "▸"}</i>
          </button>
          {passportOpen && <div className="runtime-bank">
            <p>{passport?.lifecycleFact ?? "Runtime lifecycle is not verified."}</p>
            {passport?.rootPolicy ? <>
              <span><small>FAMILY</small><b>{passport.rootPolicy.familyId}</b></span>
              <span><small>SIZE</small><b>{passport.rootPolicy.quantity} contracts</b></span>
              <span><small>RISK</small><b>{usd0(passport.rootPolicy.riskBudgetUsd)}</b></span>
              <span><small>PREMIUM / DEBIT</small><b>${passport.rootPolicy.premiumCap.toFixed(2)} / {usd0(passport.rootPolicy.aggregateDebitCap)}</b></span>
              <span><small>MANAGER</small><b>{passport.rootPolicy.managerLabel}</b></span>
              <span><small>EXIT</small><b>{activeRootExitLabel(passport.rootPolicy)}</b></span>
              <span><small>ADMISSION</small><b>priority {passport.rootPolicy.priority} · one/family</b></span>
            </> : passport?.lifecycle === "paper-root"
              ? <span className="runtime-wide"><small>RECEIPT-BOUND ROOT</small><b>exact economics are governed by immutable control-plane evidence</b></span>
              : <span className="runtime-wide"><small>RESEARCH PATH</small><b>candidate stamp → exact OCC → T+1 Databento reconstruction</b></span>}
          </div>}
        </section>
        {passport?.effective && <ChannelDecisionCard effective={passport.effective} controlPlane={controlPlane} />}
        <ChannelRosterActivationConsole selectedSlug={slug} controlPlane={controlPlane} />
        <ChannelConfigDraftPanel
          model={draft.model}
          active={draft.active}
          canStart={write.canWrite && sealed}
          onStart={draft.begin}
          onDiscard={draft.discard}
          canSeal={managerProposal.canSeal}
          sealBusy={managerProposal.busy}
          sealReason={managerProposal.reason}
          sealNotice={managerProposal.notice}
          sealError={managerProposal.error}
          onSeal={() => void managerProposal.seal()}
        />
      </div>

      <div className="insp-foot">
        <button type="button" className="life" disabled={!canPersist} onClick={toggleBench}>{status === "armed" ? "BENCH" : "RE-ARM"}</button>
        <button type="button" className="life" disabled={!canPersist || busy} onClick={doDuplicate}>{busy ? "…" : "DUPLICATE"}</button>
        {!confirmDel ? <button type="button" className="life del" disabled={!canPersist} onClick={() => setConfirmDel(true)}>DELETE</button> : <><button type="button" className="life del" onClick={doDelete}>CONFIRM</button><button type="button" className="life" onClick={() => setConfirmDel(false)}>CANCEL</button></>}
      </div>
      {sealed && <div className="insp-note sealed">RECEIPT-BOUND RUNTIME · DIRECT WRITES FENCED · FORK A GOVERNED DRAFT FOR REVIEW</div>}
      {(msg || err) && <div className={`insp-note${err ? " err" : ""}`}>{err ?? msg}</div>}
    </aside>
  );
}
