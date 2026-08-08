"use client";

import { useState } from "react";
import { signedUsd } from "@/lib/format";
import { useFold } from "@/hooks/useFold";
import { type useForensicsReport, type GivebackTrendPoint, type ShadowCurvePoint } from "@/hooks/useForensicsReport";
import { type usePyramidShadow, pyramidName } from "@/hooks/usePyramidShadow";
import type { useVirtualBench } from "@/hooks/useVirtualBench";

// §04 SHADOW BOOK — every would-have instrument vs the live book, ONE GLANCE ROW each
// (label · picture · one stat), ▸ expands to the clean breakdown. Instruments: one-account
// shadow · give-back · override scorecard · benched-vs-live · ratchet shadow · pyramid ·
// the vb-* virtual bench (the old Lab panel, merged). Read-only, log-only.
const shortDate = (d: string) => d.slice(5); // "06-15"
const cls = (v: number) => (v < 0 ? "neg" : "pos");
const etTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const etDay = (iso: string) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", month: "2-digit", day: "2-digit" }).format(new Date(iso)); } catch { return ""; } };

// inline capture-rate sparkline (kept ÷ peak, %): higher = keeping more of the peak.
function CaptureSparkline({ pts }: { pts: GivebackTrendPoint[] }) {
  const vals = pts.map((p) => p.capturePct as number);
  if (vals.length < 2) return null;
  const W = 120, H = 22, pad = 3;
  const lo = Math.min(...vals, 0), hi = Math.max(...vals, 100), span = hi - lo || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (vals.length - 1);
  const y = (v: number) => pad + (H - 2 * pad) * (1 - (v - lo) / span);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[vals.length - 2];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ flex: "0 0 auto" }}>
      <path d={d} fill="none" stroke="var(--text)" strokeWidth={1.4} opacity={0.65} />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={2.4} style={{ fill: up ? "var(--green)" : "var(--red)" }} />
    </svg>
  );
}

// NAV sparkline for the one-account shadow — dashed baseline = starting equity.
function NavSparkline({ pts, base }: { pts: ShadowCurvePoint[]; base: number }) {
  const vals = pts.map((p) => p.nav);
  if (vals.length < 2) return null;
  const W = 120, H = 22, pad = 3;
  const lo = Math.min(...vals, base), hi = Math.max(...vals, base), span = hi - lo || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (vals.length - 1);
  const y = (v: number) => pad + (H - 2 * pad) * (1 - (v - lo) / span);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= base;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ flex: "0 0 auto" }}>
      <line x1={pad} y1={y(base)} x2={W - pad} y2={y(base)} stroke="var(--border)" strokeDasharray="2 2" strokeWidth={1} />
      <path d={d} fill="none" stroke="var(--text)" strokeWidth={1.4} opacity={0.65} />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={2.4} style={{ fill: up ? "var(--green)" : "var(--red)" }} />
    </svg>
  );
}

// MODULE-LEVEL frame — an inline `const Frame = …` gets a new component identity every
// render, so each live-feed tick (~3s spot poll re-renders the surface) would unmount +
// remount the whole panel subtree: the "glitch on every chart tick" bug. Hoisted = stable.
function Shell({ folded, onFold, dateTag, children, foldable = true }: { folded: boolean; onFold: () => void; dateTag: string; children: React.ReactNode; foldable?: boolean }) {
  return (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">Research Questions</span>
        <span className="x">hypothetical paths compared with actual outcomes{dateTag}</span>
        {foldable && <button type="button" className="pfold" onClick={onFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>}
      </div>
      <div className="pbody">{children}</div>
    </div>
  );
}

// One instrument = one glance row (chevron · label · mid · stat) + a folded breakdown.
function Inst({ k, label, question, mid, stat, children }: { k: string; label: string; question: string; mid: React.ReactNode; stat: React.ReactNode; children?: React.ReactNode }) {
  const [folded, toggle] = useFold(`sb-${k}`, true);
  return (
    <>
      <button type="button" className="sb-row" onClick={toggle} aria-expanded={!folded}>
        <span className="sb-ch">{folded ? "▸" : "▾"}</span>
        <span className="sb-lbl"><b>{label}</b><small>{question}</small></span>
        <span className="sb-mid"><small>FINDING</small><span>{mid}</span></span>
        <span className="sb-stat"><small>WHY IT MATTERS</small><span>{stat}</span></span>
      </button>
      {!folded && children != null && <div className="sb-brk">{children}</div>}
    </>
  );
}

export function ForensicsPanel({
  forensics,
  pyramid,
  virtualBench,
  alwaysOpen = false,
}: {
  forensics: ReturnType<typeof useForensicsReport>;
  pyramid: ReturnType<typeof usePyramidShadow>;
  virtualBench: ReturnType<typeof useVirtualBench>;
  alwaysOpen?: boolean;
}) {
  const { report, trend, benchedCum, loading, error } = forensics;
  const ps = pyramid;
  const vb = virtualBench;
  const [storedFolded, toggleFold] = useFold("forensics", true); // deep-dive — folded by default (§04 tidy)
  const folded = alwaysOpen ? false : storedFolded;
  // scorecard / benched-vs-live windows: today's slice vs the cumulative book
  const [scWin, setScWin] = useState<"today" | "cum">("today");
  const [bvWin, setBvWin] = useState<"today" | "cum">("today");
  const [vbWin, setVbWin] = useState<"today" | "cum">("today");

  const dateTag = report ? ` · ${shortDate(report.report_date)}` : "";

  if (loading) return <Shell folded={folded} onFold={toggleFold} dateTag={dateTag} foldable={!alwaysOpen}><div className="chart-empty">loading forensics…</div></Shell>;
  if (error) return <Shell folded={folded} onFold={toggleFold} dateTag={dateTag} foldable={!alwaysOpen}><div className="chart-empty">couldn&apos;t load — {error}</div></Shell>;
  if (!report) return <Shell folded={folded} onFold={toggleFold} dateTag={dateTag} foldable={!alwaysOpen}><div className="chart-empty">no report yet — run <code>npm run day-report</code> same-week (with APP_URL + PUSH_SECRET set) to publish</div></Shell>;

  const scToday = report.payload.overrideToday ?? null;
  const showToday = scWin === "today" && !!scToday;
  const sc = showToday ? scToday! : report.payload.overrideScorecard;
  const bvl = report.payload.benchedVsLive;
  const gb = report.payload.giveback ?? null;
  const oas = report.payload.oneAccountShadow ?? null;
  const rs = report.payload.ratchetShadow ?? null;
  const trendUp = trend.length >= 2 && (trend[trend.length - 1].capturePct ?? 0) >= (trend[0].capturePct ?? 0);
  const ranAny = bvl?.benched.some((b) => b.ran) ?? false;
  const showBvToday = bvWin === "today" || !benchedCum;
  const asOf = (() => { try { return new Date(report.payload.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return report.report_date; } })();

  // ratchet paired day-bars: actual│ratchet per session (last 8), height ∝ |value|
  const rsDays = rs?.byDay.slice(-8) ?? [];
  const rsMax = Math.max(1, ...rsDays.flatMap((d) => [Math.abs(d.actual), Math.abs(d.ratchet)]));
  const rsSlots = rs?.slotAware ?? [];
  // vb bench: today ⇄ cumulative (the old Lab panel's read)
  const vbHasToday = vb.benchToday.length > 0;
  const vbShowToday = vbWin === "today" && vbHasToday;
  const vbRows = vbShowToday ? vb.benchToday : vb.bench;
  // rank + display by AVG $/ct (Σ ÷ scored) — the Σ alone reads as a per-trade number and misleads
  const vbAvg = (b: { pnl: number; scored: number }) => b.pnl / Math.max(1, b.scored);
  const vbTop = [...vbRows].filter((b) => b.scored > 0).sort((a, b) => vbAvg(b) - vbAvg(a));
  const vbRed = vbTop.filter((b) => vbAvg(b) < 0).length;

  return (
    <Shell folded={folded} onFold={toggleFold} dateTag={dateTag} foldable={!alwaysOpen}>
      {/* ── ONE-ACCOUNT — the dream team in a single live-sized cash pool ── */}
      <Inst
        k="oneacct" label="Account capacity" question="Would one paper account block otherwise useful trades?"
        mid={oas && oas.curve.length > 0 ? (
          <>
            <NavSparkline pts={oas.curve} base={oas.params.equity} />
            {oas.curve.filter((p) => p.rej + p.dwn > 0).length === 0
              ? <span className="pos">cash never bound</span>
              : <span className="neg">room ran out in {oas.curve.filter((p) => p.rej + p.dwn > 0).length} of {oas.curve.length} sessions</span>}
          </>
        ) : <span className="mut">accruing — first curve at the next post-close publish</span>}
        stat={oas && oas.curve.length > 0 ? (
          <span className={oas.curve.some((p) => p.rej + p.dwn > 0) ? "neg" : "pos"}>{oas.curve.filter((p) => p.rej + p.dwn > 0).length} of {oas.curve.length} sessions needed more room</span>
        ) : <span className="mut">—</span>}
      >
        {oas && oas.curve.length > 0 && (
          <>
            <div className="au-fund">
              <span>{oas.params.bucket} · since {shortDate(oas.params.from)} · {oas.curve.length} sessions</span>
              <span className={cls(oas.totalPnl)}>{signedUsd(oas.totalPnl)}</span>
              {oas.maxDDpct != null && <span className="neg">maxDD {oas.maxDDpct}%</span>}
              <span>peak stack {oas.maxStackChannels}ch</span>
            </div>
            {oas.today && (
              <div className="au-fund">
                <span>today {oas.today.admitted}/{oas.today.entries} admitted{oas.today.downsized ? ` · ${oas.today.downsized} downsized` : ""}{oas.today.rejected ? <b className="neg"> · {oas.today.rejected} rejected</b> : ""}</span>
                <span>peak deployed ${Math.round(oas.today.peakDeployedUsd / 100) / 10}k</span>
                {oas.today.peakOcc && <span>deepest {oas.today.peakOcc.channels}ch/{oas.today.peakOcc.contracts}ct</span>}
              </div>
            )}
            {oas.scenarios && oas.scenarios.length > 0 && (
              <div className="fx-rows">
                {oas.scenarios.map((s) => (
                  <div className="fx-row" key={s.equity}>
                    <span className="fx-name">${s.equity / 1000}k{s.equity === oas.params.equity ? " (as-lived)" : ""}</span>
                    <span className="fx-mid">DD {s.maxDDpct}%{s.rejected ? ` · ${s.rejected} dropped` : ""}{s.downsized ? ` · ${s.downsized} dwn` : ""}</span>
                    <span className={`au-pnl ${cls(s.retPct)}`}>{s.retPct >= 0 ? "+" : ""}{s.retPct}%</span>
                  </div>
                ))}
              </div>
            )}
            {/* concentration-cap grid (spec 2b, shadow-first) — per-OCC ceiling: shaved/zeroed + Δ vs uncapped */}
            {oas.capScenarios && oas.capScenarios.length > 0 && (
              <>
                <div className="brief-mini">conc caps · per-OCC ceiling (grading pre-build)</div>
                <div className="fx-rows">
                  {oas.capScenarios.map((s) => (
                    <div className="fx-row" key={s.occMaxCt}>
                      <span className="fx-name">≤{s.occMaxCt}ct/OCC</span>
                      <span className="fx-mid">{s.capBound + s.capRejected ? `${s.capBound} shaved · ${s.capRejected} zeroed · −${s.shavedCt}ct` : "never bound"} · DD {s.maxDDpct}%</span>
                      <span className={`au-pnl ${cls(s.deltaPnl)}`}>{signedUsd(s.deltaPnl)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="fx-rows">
              {oas.curve.slice(-8).map((p) => (
                <div className="fx-row" key={p.d}>
                  <span className="fx-name">{shortDate(p.d)}</span>
                  <span className="fx-mid">{p.adm} adm{p.dwn ? ` · ${p.dwn} dwn` : ""}{p.rej ? ` · ${p.rej} REJ` : ""} · peak ${Math.round(p.peak / 100) / 10}k</span>
                  <span className="au-pnl">${p.nav.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Inst>

      {/* ── GIVE-BACK — is the desk keeping its peaks? ── */}
      <Inst
        k="giveback" label="Profit protection" question="How much of each trade's best move did the exit retain?"
        mid={gb && gb.capturePct != null ? (
          <>
            {trend.length >= 2 && <CaptureSparkline pts={trend} />}
            {trend.length >= 2 && <span className="mut">{trend[0].capturePct}%→<b className={trendUp ? "pos" : "neg"}>{trend[trend.length - 1].capturePct}%</b></span>}
          </>
        ) : <span className="mut">accruing — first point at the next post-close publish</span>}
        stat={gb && gb.capturePct != null
          ? <span className={gb.capturePct >= 50 ? "pos" : "neg"}>kept {gb.capturePct}% <span className="mut neg">{signedUsd(-gb.givenBackUsd)}</span></span>
          : <span className="mut">—</span>}
      >
        {gb && gb.capturePct != null && (
          <>
            <div className="au-fund">
              <span>kept <b className={gb.capturePct >= 50 ? "pos" : "neg"}>{gb.capturePct}%</b> of peak</span>
              <span>gave back <b className="neg">{signedUsd(-gb.givenBackUsd)}</b></span>
              <span title={gb.unit === "position_tranche" ? "Exit-path analysis is tranche-specific; this is not a logical-trade count." : "Legacy report: count unit was not persisted."}>{gb.nPeakers}/{gb.nClosed} {gb.unit === "position_tranche" ? "tranches peaked" : "legacy rows peaked"}</span>
            </div>
            {gb.byChannel.length > 0 && (
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
      </Inst>

      {/* ── OVERRIDE — manual close vs ride-to-close ── */}
      <Inst
        k="override" label="Manual exits" question="Did manual closes beat leaving the original exit in control?"
        mid={sc.n > 0
          ? <span>beat <b>{sc.wins}/{sc.n}</b> <span className="mut">manual vs ride{sc.span ? ` · ${sc.span}` : ""}</span></span>
          : <span className="mut">no overrides recorded yet</span>}
        stat={sc.n > 0 ? <span className={cls(sc.delta)}>Δ {signedUsd(sc.delta)}</span> : <span className="mut">—</span>}
      >
        <div className="sb-toggle-row">
          <span className="roster-toggle sc-toggle" title="today's ledger entries vs the cumulative book">
            <button type="button" className={showToday ? "on" : ""} disabled={!scToday} onClick={() => setScWin("today")}>today</button>
            <button type="button" className={!showToday ? "on" : ""} onClick={() => setScWin("cum")}>cumulative</button>
          </span>
        </div>
        {sc.n > 0 && (
          <>
            <div className="au-fund">
              <span>N={sc.n} · {sc.span}</span>
              <span>actual <b className={cls(sc.actual)}>{signedUsd(sc.actual)}</b> vs ride <b className={cls(sc.ride)}>{signedUsd(sc.ride)}</b></span>
            </div>
            <div className="fx-rows">
              {sc.byChannel.map((c) => (
                <div className="fx-row" key={c.key}>
                  <span className="fx-name">{c.key}</span>
                  <span className="fx-mid">beat {c.wins}/{c.n}</span>
                  <span className={`au-pnl ${cls(c.delta)}`}>{signedUsd(c.delta)}</span>
                </div>
              ))}
            </div>
            {sc.byTag.length > 0 && (
              <div className="fx-rows">
                {sc.byTag.map((t) => (
                  <div className="fx-row" key={t.key}>
                    <span className="fx-name">{t.key}</span>
                    <span className="fx-mid">beat {t.wins}/{t.n}</span>
                    <span className={`au-pnl ${cls(t.delta)}`}>{signedUsd(t.delta)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Inst>

      {/* ── BENCHED — did the cut channels earn their bench? ── */}
      <Inst
        k="benched" label="Benched channels" question="Would removed channels have added value if they were still collecting?"
        mid={(() => {
          if (showBvToday) {
            if (!bvl?.sameWeek) return <span className="mut">same-week only (7d quotes)</span>;
            if (!bvl.benched.length) return <span className="mut">no benched channel signaled</span>;
            return <span>Σ bench <b className={cls(bvl.benchedTotal)}>{signedUsd(bvl.benchedTotal)}</b> vs live <b className={cls(bvl.liveTotal)}>{signedUsd(bvl.liveTotal)}</b></span>;
          }
          return <span>Σ bench <b className={cls(benchedCum!.benchedTotal)}>{signedUsd(benchedCum!.benchedTotal)}</b> vs live <b className={cls(benchedCum!.liveTotal)}>{signedUsd(benchedCum!.liveTotal)}</b> <span className="mut">{benchedCum!.sessions}s</span></span>;
        })()}
        stat={(() => {
          const tot = showBvToday ? (ranAny ? bvl!.benchedTotal : null) : benchedCum!.benchedTotal;
          if (tot == null) return <span className="mut">—</span>;
          return tot < 0 ? <span className="pos">Removing them avoided additional losses</span> : <span className="neg">Their missed opportunity deserves review</span>;
        })()}
      >
        <div className="sb-toggle-row">
          <span className="roster-toggle sc-toggle" title="the day's replay vs the accrued book">
            <button type="button" className={showBvToday ? "on" : ""} onClick={() => setBvWin("today")}>today</button>
            <button type="button" className={!showBvToday ? "on" : ""} disabled={!benchedCum} onClick={() => setBvWin("cum")}>cumulative</button>
          </span>
        </div>
        <div className="fx-rows">
          {showBvToday
            ? (bvl?.benched ?? []).map((b) => (
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
              ))
            : benchedCum!.rows.map((b) => (
                <div className="fx-row" key={b.slug}>
                  <span className="fx-name">{b.name}</span>
                  <span className="fx-mid">{b.trades}t · {b.days}d · {b.useSpec ? "spec" : "builtin"}/{b.underlying}</span>
                  <span className={`au-pnl ${cls(b.pnl)}`}>{signedUsd(b.pnl)}</span>
                </div>
              ))}
        </div>
        {showBvToday && !!bvl?.skipped.length && <div className="au-dormant">silent: {bvl.skipped.map((s) => s.name).join(" · ")}</div>}
      </Inst>

      {/* ── RATCHET — the virtual arm-high third arm (actual│ratchet per day) ── */}
      <Inst
        k="ratchet" label="Trailing-stop replay" question="Would protecting gains after a run-up improve the same trades?"
        mid={rs && rs.scored > 0 ? (
          <>
            <span className="sb-pairs" title="per session: actual (left, faded) vs ratchet (right) — height ∝ |P&L|">
              {rsDays.map((d) => (
                <span className="d" key={d.d}>
                  <span className="bars">
                    <i className={d.actual < 0 ? "n" : "g"} style={{ height: `${Math.max(2, Math.round((Math.abs(d.actual) / rsMax) * 30))}px` }} />
                    <i className={`r ${d.ratchet < 0 ? "n" : "g"}`} style={{ height: `${Math.max(2, Math.round((Math.abs(d.ratchet) / rsMax) * 30))}px` }} />
                  </span>
                  <span className="dt">{d.d.slice(8)}</span>
                </span>
              ))}
            </span>
            <span className="mut">actual│ratchet</span>
          </>
        ) : <span className="mut">accruing — replays each twin/momo trade nightly</span>}
        stat={rs && rs.scored > 0 ? (
          rsSlots.length > 0
            ? <span>{rsSlots.map((b) => { const r = b.arms.find((a) => a.name === "ratchet")?.usd ?? 0; const c = Math.max(...b.arms.filter((a) => a.name !== "ratchet").map((a) => a.usd)); const delta = r - c; return <span key={b.slug} className={cls(delta)}>{b.slug} {delta >= 0 ? "improved" : "worsened"} by ${Math.abs(Math.round(delta)).toLocaleString("en-US")} </span>; })}</span>
            : <span className={cls(rs.deltaUsd)}>Replay {rs.deltaUsd >= 0 ? "improved" : "worsened"} results by ${Math.abs(Math.round(rs.deltaUsd)).toLocaleString("en-US")}</span>
        ) : <span className="mut">—</span>}
      >
        {rs && rs.scored > 0 && (
          <>
            <div className="au-flaws" style={{ marginBottom: 5 }}>
              <span className="au-flaw au-sev-low">{rs.params ?? "arm50/keep67/pre50"}</span>
              <span className="au-flaw au-sev-low">armed {rs.armed}/{rs.scored}</span>
              <span className={`au-flaw ${(rs.tails ?? 0) > 0 ? "au-sev-low" : "au-sev-med"}`}>{rs.tails ?? 0} convex tail{(rs.tails ?? 0) === 1 ? "" : "s"}{(rs.tails ?? 0) === 0 ? " — Δ flattered" : ""}</span>
            </div>
            {/* GROUND TRUTH first: slot-aware, churn modeled */}
            {rsSlots.length > 0 ? rsSlots.map((b) => (
              <div className="au-fund" key={b.slug}>
                <span style={{ fontWeight: 700 }}>{b.slug} slot-aware:</span>
                {b.arms.map((a) => (<span key={a.name}>{a.name} <b className={cls(a.usd)}>{signedUsd(a.usd)}</b></span>))}
                <span className={b.ratchetWins ? "pos" : "neg"}>ratchet {b.ratchetWins ? "wins" : "LOSES"}</span>
              </div>
            )) : (
              <p className="au-market" style={{ margin: "2px 0" }}>slot-aware read pending tonight&apos;s close pass — the ground-truth number (per-trade below is an upper bound).</p>
            )}
            {rs.epochs.length > 1 && (
              <div className="au-fund" style={{ opacity: 0.82 }}>
                {rs.epochs.map((e) => (
                  <span key={e.key}>{e.key === "a4" ? "A4" : e.key === "momo" ? "momo" : "pre"} {e.n}t <b className={cls(e.ratchetUsd - e.actualUsd)}>{signedUsd(e.ratchetUsd - e.actualUsd)}</b></span>
                ))}
                <span style={{ opacity: 0.55, fontWeight: 400 }}>per-trade Δ (upper bound)</span>
              </div>
            )}
            {rsDays.length > 0 && (
              <>
                <div className="brkhd"><span className="l">day</span><span>t</span><span>actual</span><span>ratchet</span><span>Δ</span></div>
                {rsDays.map((d) => (
                  <div className="brkrow" key={d.d}>
                    <span className="l">{shortDate(d.d)}</span>
                    <span>{d.n}</span>
                    <span className={cls(d.actual)}>{signedUsd(d.actual)}</span>
                    <span className={cls(d.ratchet)}>{signedUsd(d.ratchet)}</span>
                    <span className={cls(d.ratchet - d.actual)}>{signedUsd(d.ratchet - d.actual)}</span>
                  </div>
                ))}
                <div className="brkfoot">per-trade Δ = upper bound (no churn/tail) · slot-aware = ground truth, lands with the close pass</div>
              </>
            )}
          </>
        )}
      </Inst>

      {/* ── PYRAMID — live adds + would-be adds on V3/ALT winners ── */}
      <Inst
        k="pyramid" label="Add-on sizing" question="Did strong continuations offer a useful second entry?"
        mid={ps.loading ? <span className="mut">loading…</span>
          : ps.error ? <span className="mut">couldn&apos;t load</span>
          : <span>{ps.execs.length + ps.events.length === 0 ? "No qualifying second entries in 14 days" : `${ps.execs.length} live second entries · ${ps.events.length} hypothetical`}</span>}
        stat={(ps.execs.length + ps.events.length) > 0
          ? <span className="pos">+{ps.execs.reduce((s, e) => s + e.addQty, 0)} live · ×{ps.byChannel.reduce((s, c) => s + c.contracts, 0)} shadow</span>
          : <span className="mut">Keep collecting before judging add-on size</span>}
      >
        {ps.execs.length > 0 && (
          <div className="fx-rows">
            {ps.execs.slice(0, 10).map((e, i) => (
              <div className="fx-row" key={`x${i}`}>
                <span className="fx-name">{pyramidName(e.slug)} {e.occ}</span>
                <span className="fx-mid">→ ×{e.newQty} @ {e.newAvg.toFixed(2)} · {etDay(e.createdAt)} {etTime(e.createdAt)}</span>
                <span className="au-pnl pos">+{e.addQty}</span>
              </div>
            ))}
          </div>
        )}
        {ps.events.length === 0 ? (
          <p className="au-market">no would-be adds in 14d — fires only when V3/ALT run +30% on a fresh continuation (RTH).</p>
        ) : (
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
      </Inst>

      {/* ── VB BENCH — the vb-* virtual fleet (the old Lab panel, merged) ── */}
      <Inst
        k="vbbench" label="Observe roster" question="Which research-only channels are producing repeatable opportunity?"
        mid={vb.loading ? <span className="mut">loading…</span>
          : vbTop.length === 0 ? <span className="mut">no reconstructions yet</span>
          : (
            <>
              {vbTop.slice(0, 2).map((b) => (
                <span key={b.slug} className={`sb-chip ${cls(vbAvg(b))}`}>{b.slug.replace(/^vb-/, "")} {signedUsd(Math.round(vbAvg(b) * 10) / 10)} per contract{b.scored ? ` · ${Math.round((100 * b.wins) / b.scored)}% profitable` : ""}</span>
              ))}
              {vbRed > 0 && <span className="mut">{vbRed} losing</span>}
            </>
          )}
        stat={<span className={vbRed > 0 ? "neg" : "mut"}>{vbTop.length === 0 ? "No decision yet" : vbRed > 0 ? `${vbRed} losing channels still need review` : "No losing channel in this view"}</span>}
      >
        <div className="sb-toggle-row">
          <span className="roster-toggle sc-toggle" title="today's signals (ET) vs the accrued book">
            <button type="button" className={vbShowToday ? "on" : ""} disabled={!vbHasToday} onClick={() => setVbWin("today")}>today</button>
            <button type="button" className={!vbShowToday ? "on" : ""} onClick={() => setVbWin("cum")}>cumulative</button>
          </span>
        </div>
        <div className="brief-mini">ranked by <b>avg $/ct</b> (right) · Σ = the cumulative mid-basis book</div>
        <div className="fx-rows">
          {[...vbRows].sort((a, b) => vbAvg(b) - vbAvg(a)).map((b) => (
            <div className="fx-row vb-row" key={b.slug} title={b.slug}>
              <span className="fx-name">{b.slug.replace(/^vb-/, "")}</span>
              <span className="fx-mid">{b.scored}/{b.n} · {b.scored > 0 ? `${Math.round((100 * b.wins) / b.scored)}%w` : "—"} · Σ {signedUsd(Math.round(b.pnl))}{vbShowToday ? "" : ` · ${b.lastAt.slice(5, 10)}`}</span>
              <span className={`au-pnl ${cls(vbAvg(b))}`}>{b.scored ? `${signedUsd(Math.round(vbAvg(b) * 10) / 10)}/ct` : "—"}</span>
            </div>
          ))}
        </div>
        <div className="brkfoot">gate-shadow blocks: {vb.gateBlocks.scored}/{vb.gateBlocks.n} scored · Σ {signedUsd(Math.round(vb.gateBlocks.pnl))}/ct — K eval at ≥30</div>
      </Inst>

      <div className="fx-foot">Updated {asOf} ET · hypothetical research only. These comparisons cannot change orders or configuration, and one session is not enough evidence.</div>
    </Shell>
  );
}
