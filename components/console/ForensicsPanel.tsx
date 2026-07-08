"use client";

import { useEffect, useState } from "react";
import { signedUsd } from "@/lib/format";
import { useFold } from "@/hooks/useFold";
import { useForensicsReport, type GivebackTrendPoint, type ShadowCurvePoint } from "@/hooks/useForensicsReport";
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

// inline capture-rate sparkline (kept ÷ peak, %): higher = keeping more of the peak. Cream-scope
// CSS vars resolve inside the panel; last point colored by trend direction. No chart-lib (house rule).
function CaptureSparkline({ pts }: { pts: GivebackTrendPoint[] }) {
  const vals = pts.map((p) => p.capturePct as number);
  if (vals.length < 2) return null;
  const W = 168, H = 30, pad = 4;
  const lo = Math.min(...vals, 0), hi = Math.max(...vals, 100), span = hi - lo || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (vals.length - 1);
  const y = (v: number) => pad + (H - 2 * pad) * (1 - (v - lo) / span);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[vals.length - 2];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ flex: "0 0 auto" }}>
      <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke="var(--border)" strokeDasharray="2 2" strokeWidth={1} />
      <path d={d} fill="none" stroke="var(--text)" strokeWidth={1.5} opacity={0.7} />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={2.6} style={{ fill: up ? "var(--green)" : "var(--red)" }} />
    </svg>
  );
}

// NAV sparkline for the one-account shadow — same house style as CaptureSparkline
// (no chart lib); dashed baseline = starting equity, end-dot colored by above/below it.
function NavSparkline({ pts, base }: { pts: ShadowCurvePoint[]; base: number }) {
  const vals = pts.map((p) => p.nav);
  if (vals.length < 2) return null;
  const W = 168, H = 30, pad = 4;
  const lo = Math.min(...vals, base), hi = Math.max(...vals, base), span = hi - lo || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (vals.length - 1);
  const y = (v: number) => pad + (H - 2 * pad) * (1 - (v - lo) / span);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= base;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ flex: "0 0 auto" }}>
      <line x1={pad} y1={y(base)} x2={W - pad} y2={y(base)} stroke="var(--border)" strokeDasharray="2 2" strokeWidth={1} />
      <path d={d} fill="none" stroke="var(--text)" strokeWidth={1.5} opacity={0.7} />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={2.6} style={{ fill: up ? "var(--green)" : "var(--red)" }} />
    </svg>
  );
}

export function ForensicsPanel() {
  const { report, trend, benchedCum, loading, error } = useForensicsReport();
  const ps = usePyramidShadow();
  const [folded, toggleFold] = useFold("forensics");
  const [expanded, setExpanded] = useState(false);
  // scorecard window: TODAY's ledger slice vs the cumulative-since-inception book
  const [scWin, setScWin] = useState<"today" | "cum">("today");
  // benched-vs-live window: the day's replay vs the book folded across banked reports
  const [bvWin, setBvWin] = useState<"today" | "cum">("today");
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

  // today's slice publishes since 07-03; older payloads only carry the cumulative book
  const scToday = report.payload.overrideToday ?? null;
  const showToday = scWin === "today" && !!scToday;
  const sc = showToday ? scToday! : report.payload.overrideScorecard;
  const bvl = report.payload.benchedVsLive;
  const gb = report.payload.giveback ?? null;
  const trendUp = trend.length >= 2 && (trend[trend.length - 1].capturePct ?? 0) >= (trend[0].capturePct ?? 0);
  const ranAny = bvl?.benched.some((b) => b.ran) ?? false;
  const showBvToday = bvWin === "today" || !benchedCum; // no banked history yet → today only
  const asOf = (() => { try { return new Date(report.payload.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return report.report_date; } })();

  return (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">Shadow &amp; Override</span>
        <button className="au-expand" onClick={toggle} aria-expanded={expanded} title={expanded ? "collapse" : "expand the by-tag / by-channel cuts"}>
          {shortDate(report.report_date)} · {expanded ? "▾ collapse" : "▸ expand"}
        </button>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody">
        {/* ── ONE-ACCOUNT SHADOW — the dream team rehearsing in a single live-sized account ── */}
        {(() => {
          const oas = report.payload.oneAccountShadow ?? null;
          const head = (
            <div className="au-sub">One-account shadow <span style={{ fontWeight: 700, opacity: 0.6, fontSize: "0.82em" }}>the dream team in one live-sized account · actual trades, one cash pool</span></div>
          );
          if (!oas || oas.curve.length === 0) return (<>{head}<p className="au-market">accruing — banks with the nightly capture (era-4 replay, $50k FIRST-TEAM). First curve lands at the next post-close publish.</p></>);
          const pctRet = (100 * oas.totalPnl) / oas.params.equity;
          const contested = oas.curve.filter((p) => p.rej + p.dwn > 0).length;
          const t = oas.today;
          return (
            <>
              {head}
              <div className="au-fund">
                <span>NAV <b className={cls(oas.totalPnl)}>${oas.navEnd.toLocaleString()}</b> on ${(oas.params.equity / 1000).toFixed(0)}k</span>
                <span className={cls(oas.totalPnl)}>{signedUsd(oas.totalPnl)} ({pctRet >= 0 ? "+" : ""}{pctRet.toFixed(1)}%)</span>
                <span>{oas.params.bucket} · since {shortDate(oas.params.from)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 2px" }}>
                <NavSparkline pts={oas.curve} base={oas.params.equity} />
                <span style={{ fontSize: "0.82em", fontWeight: 700 }}>
                  {contested === 0
                    ? <span className="pos">cash never bound</span>
                    : <span className="neg">contention on {contested}/{oas.curve.length}d</span>}
                  <span style={{ opacity: 0.55, fontWeight: 400 }}> · peak stack {oas.maxStackChannels}ch · {oas.curve.length} sessions</span>
                </span>
              </div>
              {t && (
                <div className="au-fund">
                  <span>today {t.admitted}/{t.entries} admitted{t.downsized ? ` · ${t.downsized} downsized` : ""}{t.rejected ? <b className="neg"> · {t.rejected} rejected</b> : ""}</span>
                  <span>peak deployed ${Math.round(t.peakDeployedUsd / 100) / 10}k</span>
                  {t.peakOcc && <span>deepest {t.peakOcc.channels}ch/{t.peakOcc.contracts}ct</span>}
                </div>
              )}
              {expanded && (
                <div className="fx-rows">
                  {oas.curve.slice(-8).map((p) => (
                    <div className="fx-row" key={p.d}>
                      <span className="fx-name">{shortDate(p.d)}</span>
                      <span className="fx-mid">{p.adm} adm{p.dwn ? ` · ${p.dwn} dwn` : ""}{p.rej ? ` · ${p.rej} REJ` : ""} · peak ${Math.round(p.peak / 100) / 10}k</span>
                      <span className="au-pnl">${p.nav.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}

        {/* ── DAILY GIVE-BACK / CAPTURE — the take-profit policy's success metric (peak → close) ── */}
        <div className="au-sub">Give-back <span style={{ fontWeight: 700, opacity: 0.6, fontSize: "0.82em" }}>peak → close · is the desk keeping its peaks?</span></div>
        {!gb || gb.capturePct == null ? (
          <p className="au-market">accruing — the first point lands at the next post-close publish (needs trades that peaked + 7d quote coverage).</p>
        ) : (
          <>
            <div className="au-fund">
              <span>kept <b className={gb.capturePct >= 50 ? "pos" : "neg"}>{gb.capturePct}%</b> of peak</span>
              <span>gave back <b className="neg">{signedUsd(-gb.givenBackUsd)}</b></span>
              <span>{gb.nPeakers}/{gb.nClosed} peaked</span>
            </div>
            {trend.length >= 2 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 2px" }}>
                <CaptureSparkline pts={trend} />
                <span style={{ fontSize: "0.82em", fontWeight: 700 }}>
                  capture {trend[0].capturePct}% → <b className={trendUp ? "pos" : "neg"}>{trend[trend.length - 1].capturePct}%</b>
                  <span style={{ opacity: 0.55, fontWeight: 400 }}> · {trend.length}d {trendUp ? "↑ keeping more" : "↓ giving back more"}</span>
                </span>
              </div>
            )}
            {expanded && gb.byChannel.length > 0 && (
              <div className="fx-rows">
                {gb.byChannel.map((c) => (
                  <div className="fx-row" key={c.key}>
                    <span className="fx-name">{c.key}</span>
                    <span className="fx-mid">kept {c.capturePct}% · {c.n}t</span>
                    <span className="au-pnl neg">{signedUsd(-c.givenBackUsd)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── OVERRIDE SCORECARD — today's slice ⇄ the cumulative ledger ── */}
        <div className="au-sub">
          Override scorecard
          <span className="roster-toggle sc-toggle" title="today's ledger entries vs the cumulative book">
            <button type="button" className={showToday ? "on" : ""} disabled={!scToday} onClick={() => setScWin("today")}
              title={scToday ? undefined : "publishes with the next day-report run"}>today</button>
            <button type="button" className={!showToday ? "on" : ""} onClick={() => setScWin("cum")}>cumulative</button>
          </span>
          <span style={{ fontWeight: 700, opacity: 0.6, fontSize: "0.82em" }}> {showToday ? sc.span || "today" : `cumulative${sc.span ? ` · ${sc.span}` : ""}`}</span> — manual close vs ride-to-close
        </div>
        {sc.n === 0 ? (
          <p className="au-market">{showToday ? "no overrides today — the cumulative book is on the toggle." : "no overrides recorded yet — accrues as you manually close ride-channel positions."}</p>
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

        {/* ── BENCHED would-be vs LIVE — the day's replay ⇄ the book folded across banked reports ── */}
        <div className="au-sub" style={{ marginTop: 12 }}>
          Benched would-be vs live
          <span className="roster-toggle sc-toggle" title="the day's replay vs the accrued book">
            <button type="button" className={showBvToday ? "on" : ""} onClick={() => setBvWin("today")}>today</button>
            <button type="button" className={!showBvToday ? "on" : ""} disabled={!benchedCum} onClick={() => setBvWin("cum")}
              title={benchedCum ? undefined : "no banked replays yet"}>cumulative</button>
          </span>
          <span style={{ fontWeight: 700, opacity: 0.6, fontSize: "0.82em" }}> {showBvToday ? `today · ${shortDate(report.report_date)}` : `cumulative · since ${shortDate(benchedCum!.since)}`}</span> — did the cut channels earn their bench?
        </div>
        {showBvToday ? (
          !bvl || !bvl.sameWeek ? (
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
          )
        ) : (
          <>
            <div className="fx-rows">
              {benchedCum!.rows.map((b) => (
                <div className="fx-row" key={b.slug}>
                  <span className="fx-name">{b.name}</span>
                  <span className="fx-mid">{b.trades}t · {b.days}d · {b.useSpec ? "spec" : "builtin"}/{b.underlying}</span>
                  <span className={`au-pnl ${cls(b.pnl)}`}>{signedUsd(b.pnl)}</span>
                </div>
              ))}
            </div>
            <div className="au-fund" style={{ marginTop: 6 }}>
              <span>{benchedCum!.sessions} session{benchedCum!.sessions === 1 ? "" : "s"}</span>
              <span>Σ bench <b className={cls(benchedCum!.benchedTotal)}>{signedUsd(benchedCum!.benchedTotal)}</b> vs live <b className={cls(benchedCum!.liveTotal)}>{signedUsd(benchedCum!.liveTotal)}</b></span>
              <span className={benchedCum!.benchedTotal < 0 ? "neg" : "pos"}>{benchedCum!.benchedTotal < 0 ? "cull validated" : "bench would've added"}</span>
            </div>
          </>
        )}

        {/* ── RATCHET SHADOW — the A4 twins' virtual third arm (registry instrumentation vi) ── */}
        {(() => {
          const rs = report.payload.ratchetShadow ?? null;
          const head = (
            <div className="au-sub" style={{ marginTop: 12 }}>Ratchet shadow — A4 third arm <span style={{ fontWeight: 700, opacity: 0.6, fontSize: "0.82em" }}>same trades, virtual arm-high exit ({rs?.params ?? "arm50/keep67/pre50"}) · log-only</span></div>
          );
          if (!rs || rs.scored === 0) return (<>{head}<p className="au-market">accruing — replays each A4 twin trade&apos;s real quote path nightly; banks before the 7d prune.</p></>);
          return (
            <>
              {head}
              <div className="au-fund">
                <span>actual <b className={cls(rs.actualUsd)}>{signedUsd(rs.actualUsd)}</b> vs ratchet <b className={cls(rs.ratchetUsd)}>{signedUsd(rs.ratchetUsd)}</b></span>
                <span className={cls(rs.deltaUsd)}>Δ {signedUsd(rs.deltaUsd)}</span>
                <span>armed {rs.armed}/{rs.scored}</span>
                {rs.source === "live" && <span style={{ opacity: 0.55 }}>live 7d window</span>}
              </div>
              {rs.epochs.length > 1 && (
                <div className="au-fund">
                  {rs.epochs.map((e) => (
                    <span key={e.key}>{e.key === "a4" ? "A4 twins" : "predecessor"} {e.n}t <b className={cls(e.ratchetUsd - e.actualUsd)}>{signedUsd(e.ratchetUsd - e.actualUsd)}</b></span>
                  ))}
                </div>
              )}
              {expanded && rs.byDay.length > 0 && (
                <div className="fx-rows">
                  {rs.byDay.slice(-8).map((d) => (
                    <div className="fx-row" key={d.d}>
                      <span className="fx-name">{shortDate(d.d)}</span>
                      <span className="fx-mid">{d.n}t · actual {signedUsd(d.actual)}</span>
                      <span className={`au-pnl ${cls(d.ratchet - d.actual)}`}>{signedUsd(d.ratchet - d.actual)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}

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
