"use client";
import { HistoricalAttributionNote } from "./HistoricalAttributionNote";

import { useEffect, useState } from "react";
import { signedUsd } from "@/lib/format";
const shownUsd=(value:number|null|undefined)=>value==null?'unavailable':signedUsd(value);
import { useFold } from "@/hooks/useFold";
import type { useWeeklyReports } from "@/hooks/useWeeklyReports";
import type { StrategistState } from "@/lib/desk/types";
import type { ChannelWorkspaceModel } from "@/lib/channels/channelPassport";
import { pmVar } from "@/lib/desk/colors";

const SEV_CLASS: Record<string, string> = { high: "au-sev-high", med: "au-sev-med", low: "au-sev-low" };
const PRI_CLASS: Record<string, string> = { high: "au-sev-high", med: "au-sev-med", low: "au-sev-low" };
const VERDICT_CLASS: Record<string, string> = { keep: "au-sev-low", watch: "au-sev-med", retune: "au-sev-med", mute: "au-sev-high" };
const EXP_KEY = "seve-weekly-expanded";
const pct = (x: number | null) => x == null ? "unknown" : `${Math.round(x * 100)}%`;
const md = (d: string) => d.slice(5); // "06-01"

// The WEEK view of the merged Autopsy panel (frame + DAY⇄WEEK seg live in AutopsyPanel).
// Headline = exit efficiency (left on the table); glance = fund line + movers; expand = full.
export function WeeklyAutopsyBody({
  strategists,
  passports,
  evidence,
}: {
  strategists: StrategistState[];
  passports?: ChannelWorkspaceModel;
  evidence: ReturnType<typeof useWeeklyReports>;
}) {
  const { reports, loading, error } = evidence;
  const [idx, setIdx] = useState(0);
  // learnings/suggestions start FOLDED — expanded reports were monopolizing the column
  const [learnFolded, toggleLearn] = useFold("weekly-learnings", true);
  const [sugFolded, toggleSug] = useFold("weekly-suggestions", true);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { try { if (window.localStorage.getItem(EXP_KEY) === "1") setExpanded(true); } catch { /* */ } }, []);
  const toggleExp = () => setExpanded((v) => { try { window.localStorage.setItem(EXP_KEY, v ? "0" : "1"); } catch { /* */ } return !v; });
  const colorOf = (slug: string) => pmVar(strategists.find((s) => s.slug === slug)?.color ?? "green");
  // Benched (86'd) channels: grey + chip — a week-old KEEP/WATCH verdict must not
  // read as current roster policy after a cull (autopsies are history, not roster).
  const benched = new Set(Object.values(passports?.bySlug ?? {}).filter(p => p.lifecycle === "dark-evidence").map(p => p.slug));

  if (loading) return <div className="chart-empty">loading weekly…</div>;
  if (error) return <div className="chart-empty">couldn&apos;t load weekly — {error}</div>;
  if (!reports.length) return <div className="chart-empty">no weekly report yet — generated after Friday&apos;s close</div>;

  const r = reports[Math.min(idx, reports.length - 1)];
  const d = r.digest, n = r.narrative;
  const logicalEvidence = d.evidence?.unit === "logical_trade";
  const observationLabel = logicalEvidence ? "logical trades" : "legacy position rows";
  const ee = d.exitEfficiency;
  const traded = (d.channels ?? []).filter((c) => c.metrics.nTrades > 0).sort((a, b) => b.metrics.realizedPnl - a.metrics.realizedPnl);
  // collapsed view: top movers only (traded is already sorted desc by realized P&L)
  const wkBest = traded[0], wkWorst = traded.length > 1 ? traded[traded.length - 1] : undefined;
  const nLearn = n?.keyLearnings?.length ?? 0, nSug = n?.suggestions?.length ?? 0;

  return (
    <>
      {reports.length > 1 && (
        <div className="seg au-dates" aria-label="report week">
          {reports.map((rep, i) => (
            <button key={rep.week_end} className={i === idx ? "on" : ""} onClick={() => setIdx(i)} aria-pressed={i === idx}>
              {md(rep.week_start)}–{md(rep.week_end)}
            </button>
          ))}
        </div>
      )}

      <HistoricalAttributionNote evidence={d.evidence?.historicalAttribution} />
      <div className="au-fund">
        <span title={d.evidence?.historicalAttribution ? "Observed close dates and broker-reconstructed logical trades in the matched subset; this is not a complete calendar or signal inventory." : logicalEvidence ? "Logical trades with recorded position-ledger P&L attribution. Immutable account routing does not independently verify fill prices, fees or broker NAV. Tranche exit-efficiency is separately labeled." : "This stored weekly report predates logical-trade evidence; do not compare its count directly with current reports."}>{md(d.weekStart)}–{md(d.weekEnd)} · {d.days.length}d · {d.fund.trades} {observationLabel}{d.evidence?.historicalAttribution ? " matched" : ""}</span>
        <span className={d.fund.realized < 0 ? "neg" : "pos"}>{shownUsd(d.fund.realized)} {d.evidence?.historicalAttribution ? "audited matched subset" : "recorded attribution"}</span>
        {d.fund.navDelta != null && <span className={d.fund.navDelta < 0 ? "neg" : "pos"} title="Stored NAV change using this report's original snapshot endpoints; it is not independently broker reconciled and may not cover the full displayed week.">recorded NAV Δ {shownUsd(d.fund.navDelta)}</span>}
        {d.fund.maxDrawdown != null && <span className="neg" title="intraday peak-to-trough drawdown">maxDD −${Math.abs(d.fund.maxDrawdown).toFixed(0)}</span>}
        <span>positive {pct(d.fund.winRate)}</span>
      </div>
      <p className="mut">{d.evidence?.historicalAttribution ? `Scope: ${d.days.length} observed close dates in the audited extract. Zero-trade sessions and full-calendar coverage are unverified.` : `Scope: ${d.days.length} published daily reports. Unreported sessions are not zero-trade sessions; full-calendar coverage is unverified. NAV uses the stored snapshot endpoints.`}</p>
      {d.fund.bestDay && d.fund.worstDay && (
        <div className="wk-extremes">
          <span>best <b>{md(d.fund.bestDay.date)}</b> <span className="pos">{shownUsd(d.fund.bestDay.pnl)}</span></span>
          <span>worst <b>{md(d.fund.worstDay.date)}</b> <span className="neg">{shownUsd(d.fund.worstDay.pnl)}</span></span>
        </div>
      )}

      {n?.weekSummary && <>
        <div className="wk-ee-note">Stored narrative · current posture and broker reconciliation are unverified in this report.</div>
        <p className={`au-market${expanded ? "" : " au-market--clamp"}`}>{n.weekSummary}</p>
      </>}

      {/* regime ledger (detail — expanded only) */}
      {expanded && (
      <div className="wk-regime">
        {d.regimeLedger.map((rg) => (
          <span key={`${rg.date}-${rg.instrument}`} className="wk-reg" title={rg.note}>
            <b>{md(rg.date)}</b> <em className="wk-inst">{rg.instrument}</em> <span className={rg.returnPct < 0 ? "neg" : "pos"}>{rg.returnPct >= 0 ? "+" : ""}{rg.returnPct.toFixed(2)}%</span> <i>eff {rg.efficiency.toFixed(2)}</i>
          </span>
        ))}
      </div>
      )}

      {/* HEADLINE — exit efficiency / left on the table */}
      <div className="wk-ee"><div className="au-sub">Capture evidence</div><p>Executable capture and recoverable portfolio upside are unknown. Legacy whole-day intrinsic proxies are withheld. New reports show coherent sampled held marks with exclusions.</p></div>

      {/* per-channel roll-up (expanded); collapsed shows top movers only */}
      {expanded && (
      <div className="au-channels">
        {traded.map((c) => {
          const cn = n?.channels?.find((x) => x.slug === c.slug);
          const m = c.metrics, cap = c.exitEfficiency.peakDiagnostic?.schema === "seve-reporting-v3" ? c.exitEfficiency.captureRatio : null;
          return (
            <div className={`au-ch${benched.has(c.slug) ? " au-ch--benched" : ""}`} key={c.slug}>
              <div className="au-ch-head">
                <span className="au-dot" style={{ background: colorOf(c.slug), boxShadow: `0 0 5px ${colorOf(c.slug)}` }} />
                <span className="au-name">{c.name}</span>
                {benched.has(c.slug) && <span className="au-chip au-benched" title="Current receipt-bound posture; historical verdict is not current policy.">OBSERVE ONLY NOW</span>}
                {cn?.verdict && <span className={`au-chip ${VERDICT_CLASS[cn.verdict] ?? "au-sev-low"}`}>{cn.verdict}</span>}
                <span className="wk-cap" title="Coherent sampled-held-mark subset only; excludes missing or inconsistent peaks. This is not an executable capture estimate.">held-mark ratio {cap == null ? "unknown" : `${(cap * 100).toFixed(1)}%`}</span>
                <span className={`au-pnl ${m.realizedPnl < 0 ? "neg" : "pos"}`}>{shownUsd(m.realizedPnl)}</span>
              </div>
              <div className="au-metrics">
                {m.nTrades}t · {pct(m.winRate)} · hold {m.medianHoldMin == null ? "unavailable" : m.medianHoldMin.toFixed(1)}m · {m.avgR == null ? "risk proxy unavailable" : `${m.avgR >= 0 ? "+" : ""}${m.avgR.toFixed(2)}R (50% risk proxy)`} · best {shownUsd(m.bestTrade)}/worst {shownUsd(m.worstTrade)}
              </div>
              {c.exitEfficiency.peakDiagnostic && <p className="mut">Held marks: {c.exitEfficiency.peakDiagnostic.valid}/{c.exitEfficiency.peakDiagnostic.total} logical trades valid · {c.exitEfficiency.peakDiagnostic.excluded} excluded.</p>}
              <div className="wk-byday">
                {c.byDay.map((b) => <span key={b.date} className={b.pnl == null ? "" : b.pnl < 0 ? "neg" : b.pnl > 0 ? "pos" : ""}>{md(b.date)} {shownUsd(b.pnl)}</span>)}
              </div>
              {cn?.exitQuality && <div className="au-verdict">exit: {cn.exitQuality}</div>}
              {cn?.note && <div className="au-verdict">{cn.note}</div>}
              {c.recurringFlaws.length > 0 && (
                <div className="au-flaws">
                  {c.recurringFlaws.map((f) => <span key={f.type} className={`au-flaw ${SEV_CLASS[f.severity] ?? "au-sev-low"}`}>{f.type} ×{f.days}d</span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {!expanded && (wkBest || wkWorst) && (
        <div className="au-movers">
          {wkBest && (
            <span className="au-mover">
              <span className="au-dot" style={{ background: colorOf(wkBest.slug), boxShadow: `0 0 5px ${colorOf(wkBest.slug)}` }} />
              <span className={`au-mv-ar ${wkBest.metrics.realizedPnl < 0 ? "neg" : "pos"}`}>▲</span><span className="au-mv-name">{wkBest.name}</span>
              <span className={`au-pnl ${wkBest.metrics.realizedPnl < 0 ? "neg" : "pos"}`}>{shownUsd(wkBest.metrics.realizedPnl)}</span>
            </span>
          )}
          {wkWorst && (
            <span className="au-mover">
              <span className="au-dot" style={{ background: colorOf(wkWorst.slug), boxShadow: `0 0 5px ${colorOf(wkWorst.slug)}` }} />
              <span className={`au-mv-ar ${wkWorst.metrics.realizedPnl < 0 ? "neg" : "pos"}`}>▼</span><span className="au-mv-name">{wkWorst.name}</span>
              <span className={`au-pnl ${wkWorst.metrics.realizedPnl < 0 ? "neg" : "pos"}`}>{shownUsd(wkWorst.metrics.realizedPnl)}</span>
            </span>
          )}
          <span className="au-mv-count">{traded.length} ch</span>
        </div>
      )}

      {!expanded && (
        <button className="au-expand-foot" onClick={toggleExp}>
          ▾ {traded.length} channel{traded.length === 1 ? "" : "s"}{nLearn ? ` · ${nLearn} learning${nLearn === 1 ? "" : "s"}` : ""}{nSug ? ` · ${nSug} suggestion${nSug === 1 ? "" : "s"}` : ""} — full report
        </button>
      )}

      {expanded && !!n?.keyLearnings?.length && (
        <div className="au-section">
          <button type="button" className="au-sub au-subfold" onClick={toggleLearn} aria-expanded={!learnFolded}>
            Key learnings · {n.keyLearnings.length}
            <span className="fold-ch">{learnFolded ? "▸" : "▾"}</span>
          </button>
          {!learnFolded && <ul className="au-actions">{n.keyLearnings.map((k, i) => <li key={i}>{k}</li>)}</ul>}
        </div>
      )}

      {expanded && !!n?.suggestions?.length && (
        <div className="au-section">
          <button type="button" className="au-sub au-subfold" onClick={toggleSug} aria-expanded={!sugFolded}>
            Ranked suggestions · {n.suggestions.length}
            <span className="fold-ch">{sugFolded ? "▸" : "▾"}</span>
          </button>
          {!sugFolded && n.suggestions.map((s, i) => (
            <div className="au-finding" key={i}>
              <div className="au-finding-head">
                <span className={`au-chip ${PRI_CLASS[s.priority] ?? "au-sev-low"}`}>{s.priority}</span>
                <b className="au-ftype">{s.action}</b>
              </div>
              <div className="au-ev">{s.rationale}</div>
            </div>
          ))}
        </div>
      )}

      {expanded && <button className="au-expand-foot" onClick={toggleExp}>▴ collapse to glance</button>}
    </>
  );
}
