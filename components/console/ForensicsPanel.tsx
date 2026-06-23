"use client";

import { useEffect, useState } from "react";
import { signedUsd } from "@/lib/format";
import { useForensicsReport } from "@/hooks/useForensicsReport";
import { usePyramidShadow, pyramidName } from "@/hooks/usePyramidShadow";

// §03 "Shadow & Override" panel — renders the deterministic forensics the CLI day-report
// publishes (forensics_reports): the OVERRIDE SCORECARD (did the human's manual close beat
// ride-to-close, accumulated) + BENCHED would-be-vs-live (did the cut channels earn their
// bench today). Read-only; collapsed to the headlines, expand for the by-tag/by-channel cuts.
const EXP_KEY = "seve-forensics-expanded";
const shortDate = (d: string) => d.slice(5); // "06-15"
const cls = (v: number) => (v < 0 ? "neg" : "pos");
const etTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const etDay = (iso: string) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", month: "2-digit", day: "2-digit" }).format(new Date(iso)); } catch { return ""; } };

export function ForensicsPanel() {
  const { report, loading, error } = useForensicsReport();
  const ps = usePyramidShadow();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { try { if (window.localStorage.getItem(EXP_KEY) === "1") setExpanded(true); } catch { /* */ } }, []);
  const toggle = () => setExpanded((v) => { try { window.localStorage.setItem(EXP_KEY, v ? "0" : "1"); } catch { /* */ } return !v; });

  const Frame = ({ children, head }: { children: React.ReactNode; head?: React.ReactNode }) => (
    <div className="panel">
      <div className="phead"><span className="t">Shadow &amp; Override</span>{head ?? <span className="x">did the human beat the ride</span>}</div>
      <div className="pbody">{children}</div>
    </div>
  );

  if (loading) return <Frame><div className="chart-empty">loading forensics…</div></Frame>;
  if (error) return <Frame><div className="chart-empty">couldn&apos;t load — {error}</div></Frame>;
  if (!report) return <Frame><div className="chart-empty">no report yet — run <code>npm run day-report</code> same-week (with APP_URL + PUSH_SECRET set) to publish</div></Frame>;

  const sc = report.payload.overrideScorecard;
  const bvl = report.payload.benchedVsLive;
  const ranAny = bvl?.benched.some((b) => b.ran) ?? false;
  const asOf = (() => { try { return new Date(report.payload.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return report.report_date; } })();

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">Shadow &amp; Override</span>
        <button className="au-expand" onClick={toggle} aria-expanded={expanded} title={expanded ? "collapse" : "expand the by-tag / by-channel cuts"}>
          {shortDate(report.report_date)} · {expanded ? "▾ collapse" : "▸ expand"}
        </button>
      </div>
      <div className="pbody">
        {/* ── OVERRIDE SCORECARD (CUMULATIVE — accumulating ledger since inception) ── */}
        <div className="au-sub">Override scorecard <span style={{ fontWeight: 700, opacity: 0.6, fontSize: "0.82em" }}>cumulative{sc.span ? ` · ${sc.span}` : ""}</span> — manual close vs ride-to-close (man&nbsp;vs&nbsp;machine)</div>
        {sc.n === 0 ? (
          <p className="au-market">no overrides recorded yet — accrues as you manually close ride-channel positions.</p>
        ) : (
          <>
            <div className="au-fund">
              <span>N={sc.n} · {sc.span}</span>
              <span>actual <b className={cls(sc.actual)}>{signedUsd(sc.actual)}</b> vs ride <b className={cls(sc.ride)}>{signedUsd(sc.ride)}</b></span>
              <span className={cls(sc.delta)}>Δ {signedUsd(sc.delta)}</span>
              <span>beat {sc.wins}/{sc.n}</span>
            </div>
            <div className="fx-rows">
              {(expanded ? sc.byChannel : sc.byChannel.slice(0, 3)).map((c) => (
                <div className="fx-row" key={c.key}>
                  <span className="fx-name">{c.key}</span>
                  <span className="fx-mid">beat {c.wins}/{c.n}</span>
                  <span className={`au-pnl ${cls(c.delta)}`}>{signedUsd(c.delta)}</span>
                </div>
              ))}
            </div>
            {expanded && sc.byTag.length > 0 && (
              <>
                <div className="au-sub">by close-reason tag</div>
                <div className="fx-rows">
                  {sc.byTag.map((t) => (
                    <div className="fx-row" key={t.key}>
                      <span className="fx-name">{t.key}</span>
                      <span className="fx-mid">beat {t.wins}/{t.n}</span>
                      <span className={`au-pnl ${cls(t.delta)}`}>{signedUsd(t.delta)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── BENCHED would-be vs LIVE (TODAY only — replays every draft/culled channel on the day's tape) ── */}
        <div className="au-sub" style={{ marginTop: 12 }}>Benched would-be vs live <span style={{ fontWeight: 700, opacity: 0.6, fontSize: "0.82em" }}>today · {shortDate(report.report_date)}</span> — did the cut channels earn their bench?</div>
        {!bvl || !bvl.sameWeek ? (
          <p className="au-market">same-week only (option_quotes 7d) — re-run day-report same-week to refresh.</p>
        ) : bvl.benched.length === 0 ? (
          <p className="au-market">no benched channel signaled {shortDate(report.report_date)}{bvl.skipped.length ? ` (${bvl.skipped.length} silent)` : ""}.</p>
        ) : (
          <>
            <div className="fx-rows">
              {bvl.benched.map((b) => (
                <div className="fx-row" key={b.slug}>
                  <span className="fx-name">{b.name}</span>
                  {b.ran ? (
                    <>
                      <span className="fx-mid">{b.trades}t · {b.useSpec ? "spec" : "builtin"}/{b.underlying}</span>
                      <span className={`au-pnl ${cls(b.pnl)}`}>{signedUsd(b.pnl)}</span>
                    </>
                  ) : (
                    <span className="fx-note">{b.note}</span>
                  )}
                </div>
              ))}
            </div>
            {ranAny && (
              <div className="au-fund" style={{ marginTop: 6 }}>
                <span>Σ bench <b className={cls(bvl.benchedTotal)}>{signedUsd(bvl.benchedTotal)}</b> vs live <b className={cls(bvl.liveTotal)}>{signedUsd(bvl.liveTotal)}</b></span>
                <span className={bvl.benchedTotal < 0 ? "neg" : "pos"}>{bvl.benchedTotal < 0 ? "cull validated" : "bench would've added"}</span>
              </div>
            )}
            {expanded && bvl.skipped.length > 0 && <div className="au-dormant">silent: {bvl.skipped.map((s) => s.name).join(" · ")}</div>}
          </>
        )}

        {/* ── PYRAMID — live adds (executor armed) + would-be adds (shadow) on V3/ALT winners ── */}
        {ps.execs.length > 0 && (
          <>
            <div className="au-sub" style={{ marginTop: 12 }}>Pyramid — LIVE adds (executor armed) · 14d</div>
            <div className="au-fund">
              <span>{ps.execs.length} live add{ps.execs.length === 1 ? "" : "s"}</span>
              <span>Σ <b className="pos">+{ps.execs.reduce((s, e) => s + e.addQty, 0)}</b> contracts added</span>
            </div>
            <div className="fx-rows">
              {ps.execs.slice(0, 10).map((e, i) => (
                <div className="fx-row" key={`x${i}`}>
                  <span className="fx-name">{pyramidName(e.slug)} {e.occ}</span>
                  <span className="fx-mid">→ ×{e.newQty} @ {e.newAvg.toFixed(2)} · {etDay(e.createdAt)} {etTime(e.createdAt)}</span>
                  <span className="au-pnl pos">+{e.addQty}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="au-sub" style={{ marginTop: 12 }}>Pyramid shadow — would-be adds on V3/ALT winners (zero-order; tracking Phase-A graduation)</div>
        {ps.loading ? (
          <p className="au-market">loading…</p>
        ) : ps.error ? (
          <p className="au-market">couldn&apos;t load — {ps.error}</p>
        ) : ps.events.length === 0 ? (
          <p className="au-market">no would-be adds in 14d — fires only when V3/ALT run +30% on a fresh continuation (RTH).</p>
        ) : (
          <>
            <div className="au-fund">
              <span>{ps.events.length} would-be add{ps.events.length === 1 ? "" : "s"} · 14d</span>
              <span>Σ <b className="pos">×{ps.byChannel.reduce((s, c) => s + c.contracts, 0)}</b> contracts</span>
            </div>
            <div className="fx-rows">
              {ps.byChannel.map((c) => (
                <div className="fx-row" key={c.slug}>
                  <span className="fx-name">{c.name}</span>
                  <span className="fx-mid">{c.adds} add{c.adds === 1 ? "" : "s"}</span>
                  <span className="au-pnl pos">×{c.contracts}</span>
                </div>
              ))}
            </div>
            {expanded && (
              <div className="fx-rows">
                {ps.events.slice(0, 10).map((e, i) => (
                  <div className="fx-row" key={i}>
                    <span className="fx-name">{pyramidName(e.slug)} {e.occ}</span>
                    <span className="fx-mid">+{Math.round(e.appreciatedPct)}% · {etDay(e.createdAt)} {etTime(e.createdAt)}</span>
                    <span className="au-pnl pos">×{e.wouldQty} @ {e.ask.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="fx-foot">as of {asOf} ET · one day = noise; cull rests on the 5-window evidence</div>
      </div>
    </div>
  );
}
