"use client";

// The ROSTER — every armed channel's exit mode + TP / stop / risk in one scannable
// grid for cross-channel tuning (the strips are per-channel; this is the fleet view).
// Reuses the strip's FiresPill (click-to-edit %) + the LOCK/RIDE mode pair so edits
// behave identically. Read-only when signed out.

import { FiresPill } from "@/components/console/ChannelStrip";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, usd0 } from "@/lib/format";
import type { ChannelPnl, StrategistConfig, StrategistState } from "@/lib/desk/types";

export function RosterTable({
  channels,
  livePnl,
}: {
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
}) {
  const dispatch = useDeskDispatch();
  const { persistConfig, canWrite } = useDeskWrite();

  const setCfg = (slug: string, id: string, patch: Partial<StrategistConfig>) => {
    dispatch({ type: "SET_CONFIG", slug, patch });
    persistConfig(id, patch);
  };

  return (
    <div className="roster">
      <table className="roster-table">
        <thead>
          <tr>
            <th className="rt-chh">Channel</th>
            <th>Mode</th>
            <th className="rt-num">Stop</th>
            <th className="rt-num">Take</th>
            <th className="rt-num">Risk/tr</th>
            <th className="rt-num" title="daily realized-loss LATCH — halts NEW entries for the day once realized P&L ≤ −$X">HALT/day</th>
            <th className="rt-num">Day P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((s) => {
            const c = s.config;
            const tp = c.take_profit_pct ?? 0;
            const premStop = c.premium_stop_pct ?? 50;
            const ustop = c.underlying_stop_pct ?? 0;
            const ustopInert = ustop > 0 && ustop * 180 >= premStop;
            const mode = tp > 0 ? "lock" : "ride";
            const day = livePnl[s.slug]?.dayPnl ?? 0;
            const applyLock = () => {
              const nextTp = tp > 0 ? tp : 22;
              if (nextTp !== tp || premStop !== 30) setCfg(s.slug, s.id, { take_profit_pct: nextTp, premium_stop_pct: 30 });
            };
            const applyRide = () => {
              if (tp !== 0 || premStop !== 50) setCfg(s.slug, s.id, { take_profit_pct: 0, premium_stop_pct: 50 });
            };
            return (
              <tr key={s.slug} className={c.muted ? "rt-row rt-muted" : "rt-row"}>
                <td className="rt-ch">
                  <span className="rt-dot" style={{ background: pmVar(s.color) }} />
                  <span className="rt-name">{s.name}</span>
                  <span className="rt-tick">{s.underlying}</span>
                  {c.muted && <span className="rt-flag rt-mutedflag">muted</span>}
                  {ustopInert && <span className="rt-flag" title={`u-stop ${ustop}% never fires — the −${premStop}% stop hits first`}>uS·off</span>}
                </td>
                <td>
                  {canWrite ? (
                    <span className="rt-mode" role="group" aria-label={`${s.name} exit mode`}>
                      <button type="button" className={`chm chm-lock${mode === "lock" ? " on" : ""}`} onClick={applyLock} title="LOCK — take + a tight −30% stop">LOCK</button>
                      <button type="button" className={`chm chm-ride${mode === "ride" ? " on" : ""}`} onClick={applyRide} title="RIDE — no take, loose −50% stop">RIDE</button>
                    </span>
                  ) : (
                    <span className={`rt-modelbl rt-${mode}`}>{mode.toUpperCase()}</span>
                  )}
                </td>
                <td className="rt-num">
                  <FiresPill value={premStop} display={`−${premStop}%`} onCommit={(v) => setCfg(s.slug, s.id, { premium_stop_pct: v })} min={10} max={90} className="chf-stop" canWrite={canWrite} label={`${s.name} premium stop percent`} title="premium stop % — the binding downside" />
                </td>
                <td className="rt-num">
                  <FiresPill value={tp} display={tp > 0 ? `+${tp}%` : "ride"} onCommit={(v) => setCfg(s.slug, s.id, { take_profit_pct: v })} min={0} max={300} className={tp > 0 ? "chf-take" : "chf-ride"} canWrite={canWrite} label={`${s.name} take profit percent`} title="take-profit % (0 = ride)" />
                </td>
                <td className="rt-num">
                  <FiresPill value={c.capital_pct} display={usd0(c.capital_pct)} onCommit={(v) => setCfg(s.slug, s.id, { capital_pct: v })} min={0} max={5000} maxDigits={5} className="chf-amt" canWrite={canWrite} label={`${s.name} risk per trade`} title="risk $/trade" />
                </td>
                <td className="rt-num">
                  <FiresPill value={c.daily_stop_usd} display={usd0(c.daily_stop_usd)} onCommit={(v) => setCfg(s.slug, s.id, { daily_stop_usd: v })} min={0} max={5000} maxDigits={5} className="chf-amt" canWrite={canWrite} label={`${s.name} daily latch`} title="daily realized-loss LATCH — halts NEW entries for the day once realized P&L ≤ −$X; does NOT cap an open trade's loss" />
                </td>
                <td className={`rt-num ${day < 0 ? "neg" : "pos"}`}>{signedUsd(day)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
