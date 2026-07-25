"use client";

import { useRef, useState } from "react";
import { FiresPill, TradeShapeBar } from "@/components/console/ChannelStrip";
import { ChannelConfigDraftPanel } from "@/components/studio/ChannelConfigDraftPanel";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useChannelConfigDraft } from "@/hooks/useChannelConfigDraft";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, usd0 } from "@/lib/format";
import type { ChannelPnl, StrategistState, StrategistConfig } from "@/lib/desk/types";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { ChannelPassport } from "@/lib/channels/channelPassport";
import { day1RootExitLabel } from "@/lib/channels/day1Release";
import { channelDecisionState } from "@/lib/studio/channelDecision";

// =============================================================================
// MOBILE · STUDIO RACK ROW (S5) — the accordion channel row + its INLINE
// inspector (the gallery mock's studio rack). Collapsed = a 56px row (dot · slug
// · mode/A13 tag · fires summary · day P&L · chevron). Tapping expands ONE
// inspector at a time (the parent enforces single-open). Inside: the REUSED
// FiresPill + TradeShapeBar write paths (identical to the desktop ChannelRackRow),
// the LOCK/RIDE matched-pair write, plus mobile-native ≥44px controls where the
// desktop hardware knobs don't suit touch — a STOP/day stepper and the operator-
// approved HORIZONTAL RISK fader. Every write is optimistic dispatch(SET_CONFIG)
// + auth-gated persistConfig; anon = read-only.
// =============================================================================

const A13_SLUGS = new Set(["momo-shape"]);
const RISK_MIN = 0, RISK_MAX = 5000, RISK_STEP = 25;
const etTime = (iso: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(new Date(iso));

export function MobileRackRow({
  strategist, pnl, active, open, onToggle, write, passport,
}: {
  strategist: StrategistState;
  pnl: ChannelPnl | undefined;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  write: SurfaceProps["write"];
  passport?: ChannelPassport;
}) {
  const dispatch = useDeskDispatch();
  const { persistConfig } = write;
  const faderRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [passportOpen, setPassportOpen] = useState(false);
  const draft = useChannelConfigDraft(strategist, passport);
  const { id, slug, color, status, config: databaseConfig } = strategist;
  const config = draft.proposed ?? databaseConfig;
  const sealed = passport?.release.state === "verified";
  const canPersist = write.canWrite && !sealed;
  const canTune = draft.active || canPersist;

  const tp = config.take_profit_pct ?? 0;
  const premStop = config.premium_stop_pct ?? 50;
  const boosted = config.boosted ?? false;
  const ride = tp === 0;
  const day = pnl?.dayPnl ?? 0;
  const pnlCls = day > 0 ? "pos" : day < 0 ? "neg" : "flat";
  const pm = pmVar(color);

  const persistPatch = (patch: Partial<StrategistConfig>) => {
    if (draft.active) { draft.update(patch); return; }
    if (!canPersist) return;
    setWriteError(null);
    void persistConfig(id, patch).then((result) => {
      if (!result.ok) setWriteError(result.error ?? "config write failed");
    });
  };
  const stagePatch = (patch: Partial<StrategistConfig>) => draft.active
    ? draft.update(patch)
    : dispatch({ type: "SET_CONFIG", slug, patch });
  const setCfg = (patch: Partial<StrategistConfig>) => {
    stagePatch(patch);
    persistPatch(patch);
  };
  // LOCK/RIDE writes the matched pair (giveback doctrine) — verbatim from ChannelRackRow.
  const applyLock = () => {
    const nextTp = tp > 0 ? tp : 22;
    if (nextTp !== tp || premStop !== 30) setCfg({ take_profit_pct: nextTp, premium_stop_pct: 30 });
  };
  const applyRide = () => {
    if (tp !== 0 || premStop !== 50) setCfg({ take_profit_pct: 0, premium_stop_pct: 50 });
  };

  // Horizontal RISK fader (operator-approved for mobile) → capital_pct (RISK $/trade).
  const riskFrac = Math.min(1, config.capital_pct / RISK_MAX);
  const valueFromX = (clientX: number) => {
    const el = faderRef.current;
    if (!el) return config.capital_pct;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
    return Math.round((RISK_MIN + frac * (RISK_MAX - RISK_MIN)) / RISK_STEP) * RISK_STEP;
  };
  const faderMove = (clientX: number, commit: boolean) => {
    const v = valueFromX(clientX);
    if (v === config.capital_pct && !commit) return;
    stagePatch({ capital_pct: v });
    if (commit) persistPatch({ capital_pct: v });
  };

  const stepStop = (delta: number) => {
    const v = Math.max(0, Math.min(5000, config.daily_stop_usd + delta));
    if (v !== config.daily_stop_usd) setCfg({ daily_stop_usd: v });
  };
  const stepPremiumStop = (delta: number) => {
    const v = Math.max(10, Math.min(90, premStop + delta));
    if (v !== premStop) setCfg({ premium_stop_pct: v });
  };
  const stepTakeProfit = (delta: number) => {
    const v = Math.max(0, Math.min(300, tp + delta));
    if (v !== tp) setCfg({ take_profit_pct: v });
  };

  const databaseTag = databaseConfig.muted ? { txt: "DB MUTED", cls: "muted" }
    : status === "draft" ? { txt: "BENCH", cls: "darkch" }
    : status === "disabled" ? { txt: "OFF", cls: "darkch" }
    : null;
  const runtimeMayFill = passport?.lifecycle === "paper-root" || !passport || passport.lifecycle === "unverified";
  const dot = runtimeMayFill && active && status === "armed" && !config.muted;
  const runtimeTag = passport?.lifecycle === "paper-root" ? { txt: "PAPER ROOT", cls: "root" }
    : passport?.lifecycle === "dark-evidence" ? { txt: "DARK", cls: "dark" }
    : { txt: "UNVERIFIED", cls: "unverified" };
  const firesSummary = passport?.rootPolicy
    ? day1RootExitLabel(passport.rootPolicy, true)
    : passport?.lifecycle === "dark-evidence"
      ? "NO FILL · T+1 PATH"
      : ride ? `−${premStop}% · ride · EOD` : `−${premStop}/+${tp} · EOD`;

  return (
    <section id={`m2-channel-${slug}`} className={`m2-rack${config.muted ? " mutedch" : ""}${open ? " open" : ""}`} style={{ ["--pm" as string]: pm }}>
      <button type="button" className="m2-rrow" onClick={onToggle} aria-expanded={open}>
        <span className="m2-rr-left">
          <span className={`m2-rr-dot${dot ? " on" : ""}${A13_SLUGS.has(slug) ? " hot" : ""}`} />
          <span className="m2-rr-slug">{slug}</span>
          {A13_SLUGS.has(slug) && <span className="m2-rr-a13">⚡A13</span>}
          <span className={`m2-rr-tag ${runtimeTag.cls}`}>{runtimeTag.txt}</span>
          {databaseTag && <span className={`m2-rr-tag ${databaseTag.cls}`}>{databaseTag.txt}</span>}
        </span>
        <span className="m2-rr-right">
          <span className="m2-rr-fires num">{firesSummary}</span>
          <span className={`m2-rr-pnl num ${pnlCls}`}>{signedUsd(day)}</span>
          <span className="m2-rr-chev">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && (
        <div className="m2-insp">
          <div className="m2-fireslbl"><span className="fl">{draft.active ? "LOCAL DRAFT · EXIT SHAPE" : passport?.release.state === "verified" ? "DATABASE EXIT PREVIEW · NOT ACTIVE RC5" : "FIRES — BINDING EXITS · USE − / + OR TAP VALUE"}</span><span className="ln" /></div>
          <div className="m2-fpills">
            <div className="m2-fp stop">
              <div className="m2-exit-stepper">
                <button type="button" disabled={!canTune || premStop <= 10} onClick={() => stepPremiumStop(-5)} aria-label="decrease premium stop by 5 percent">−</button>
                <FiresPill
                  value={premStop} display={`−${premStop}%`}
                  onCommit={(v) => setCfg({ premium_stop_pct: v })}
                  min={10} max={90} className="m2-fp-val"
                  canWrite={canTune} label="premium stop percent" title="premium stop % — the binding downside"
                />
                <button type="button" disabled={!canTune || premStop >= 90} onClick={() => stepPremiumStop(5)} aria-label="increase premium stop by 5 percent">+</button>
              </div>
              <span className="m2-fp-cap">prem stop</span>
            </div>
            <div className={`m2-fp ${tp > 0 ? "take" : "ride"}`}>
              <div className="m2-exit-stepper">
                <button type="button" disabled={!canTune || tp <= 0} onClick={() => stepTakeProfit(-5)} aria-label="decrease take profit by 5 percent">−</button>
                <FiresPill
                  value={tp} display={tp > 0 ? `+${tp}%` : "ride"}
                  onCommit={(v) => setCfg({ take_profit_pct: v })}
                  min={0} max={300} className="m2-fp-val"
                  canWrite={canTune} label="take profit percent" title="take-profit % (0 = ride)"
                />
                <button type="button" disabled={!canTune || tp >= 300} onClick={() => stepTakeProfit(5)} aria-label="increase take profit by 5 percent">+</button>
              </div>
              <span className="m2-fp-cap">{tp > 0 ? "take" : "no take"}</span>
            </div>
            <span className="m2-fp eod"><b>EOD</b><span className="m2-fp-cap">flatten</span></span>
          </div>

          <div className="m2-lr" role="group" aria-label="exit mode">
            {canTune ? (
              <>
                <button type="button" className={`m2-lrbtn lock${ride ? "" : " on"}`} onClick={applyLock}
                  title="LOCK — take profit + a tight −30% stop">LOCK</button>
                <button type="button" className={`m2-lrbtn ride${ride ? " on" : ""}`} onClick={applyRide}
                  title="RIDE — no take, loose −50% stop">RIDE</button>
              </>
            ) : (
              <span className={`m2-lrbtn on ${ride ? "ride" : "lock"}`}>{ride ? "RIDE" : "LOCK"}</span>
            )}
          </div>

          <div className="m2-shape">
            <TradeShapeBar
              tp={tp} premStop={premStop} canWrite={canTune}
              onChange={stagePatch}
              onCommit={persistPatch}
            />
          </div>

          <div className="m2-dials">
            <div className="m2-stopday">
              <span className="m2-dial-lbl">stop/day</span>
              <div className="m2-stepper">
                <button type="button" disabled={!canTune} onClick={() => stepStop(-250)} aria-label="decrease stop per day">−</button>
                <b className="num">{usd0(config.daily_stop_usd)}</b>
                <button type="button" disabled={!canTune} onClick={() => stepStop(250)} aria-label="increase stop per day">+</button>
              </div>
            </div>
            <div className="m2-riskwrap">
              <div
                ref={faderRef}
                className="m2-hfader"
                onPointerDown={(e) => { if (!canTune) return; e.preventDefault(); (e.currentTarget as Element).setPointerCapture(e.pointerId); dragging.current = true; faderMove(e.clientX, false); }}
                onPointerMove={(e) => { if (dragging.current) faderMove(e.clientX, false); }}
                onPointerUp={(e) => { if (dragging.current) { dragging.current = false; faderMove(e.clientX, true); try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* */ } } }}
              >
                <div className="m2-hf-track" />
                <div className="m2-hf-fill" style={{ width: `${riskFrac * 100}%` }} />
                <div className="m2-hf-cap" style={{ left: `${riskFrac * 100}%` }} />
              </div>
              <div className="m2-dial-cap"><span className="m2-dial-lbl">risk</span><b className="num">{usd0(config.capital_pct)}</b></div>
            </div>
          </div>

          <div className="m2-padrow">
            <button type="button" className={`m2-bigpad${databaseConfig.muted ? " lit-m" : ""}`} disabled={!canPersist}
              onClick={() => { dispatch({ type: "TOGGLE_MUTE", slug }); persistPatch({ muted: !databaseConfig.muted }); }}>
              {databaseConfig.muted ? "MUTED" : "MUTE"}
            </button>
            <button type="button" className={`m2-bigpad${boosted ? " lit-b" : ""}`} disabled={!canPersist}
              onClick={() => { const next = !boosted; dispatch({ type: "SET_CONFIG", slug, patch: { boosted: next } }); persistPatch({ boosted: next }); }}>
              {boosted ? "BOOST 2×" : "BOOST"}
            </button>
          </div>
          {writeError && <div className="m2-write-error" role="alert" title={writeError}>WRITE FAILED · CHANGE NOT CONFIRMED</div>}
          <div className={`m2-passport lane-${passport?.lifecycle ?? "unverified"}${passportOpen ? " open" : " collapsed"}`}>
            <button type="button" className="m2-passport-toggle" onClick={() => setPassportOpen((value) => !value)} aria-expanded={passportOpen}>
              <span>RUNTIME PASSPORT</span><b>{passport?.lifecycleLabel ?? "UNVERIFIED"}</b><i>{passportOpen ? "▾" : "▸"}</i>
            </button>
            {passportOpen && <>
              <p>{passport?.lifecycleFact ?? "Runtime lifecycle is not verified."}</p>
              <div>
                <span><small>DATABASE</small><b>{passport ? `${passport.database.state} · ${passport.database.executor}` : status.toUpperCase()}</b></span>
                <span><small>FAMILY</small><b>{passport?.rootPolicy?.familyId ?? "NO-FILL EVIDENCE"}</b></span>
                <span><small>DECISIONS</small><b>{passport?.evidence.recentSignals ?? 0} · {passport?.evidence.censoredSignals ?? 0} censored</b></span>
                <span><small>OBSERVER</small><b>{passport?.observer.configuredArms ?? 0} arms</b></span>
                {passport?.rootPolicy && <>
                  <span><small>SIZE / CAP</small><b>{passport.rootPolicy.quantity} ct · {usd0(passport.rootPolicy.aggregateDebitCap)}</b></span>
                  <span><small>EFFECTIVE EXIT</small><b>{day1RootExitLabel(passport.rootPolicy, true)}</b></span>
                  <span><small>IDENTITY</small><code>{passport.rootPolicy.configurationEpochId.slice(0, 10)}…</code></span>
                </>}
              </div>
              <section className="m2-decision-ledger" aria-label="Recent channel decision receipts">
                {(passport?.evidence.recentDecisions ?? []).map((signal) => {
                  const state = channelDecisionState(signal);
                  return <span key={signal.id} className={state.tone}><time>{etTime(signal.created_at)} ET</time><b>{state.label}</b><small>{state.fact}</small></span>;
                })}
                {!passport?.evidence.recentDecisions.length && <i>no recent decision receipt in account feed</i>}
              </section>
              {sealed && <footer>SEALED READ-ONLY · ACTIVE RC5 CONTROLS CANNOT BE MUTATED</footer>}
            </>}
          </div>
          <ChannelConfigDraftPanel model={draft.model} active={draft.active} canStart={write.canWrite && sealed} onStart={draft.begin} onDiscard={draft.discard} compact />
        </div>
      )}
    </section>
  );
}
