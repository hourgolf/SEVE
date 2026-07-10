"use client";

import { useFold } from "@/hooks/useFold";
import { signedUsd } from "@/lib/format";
import { useSentinelDigest, splitDigest, type ScanRow } from "@/hooks/useSentinelDigest";
import { SentMd } from "./SentMd";

// §04 SENTINEL — the BACKWARD half of the nightly sentinel. The LLM VERDICT first (glanceable:
// verdict chip + terse bullets), the deterministic opportunity/drift scan behind an expand as the
// evidence. Renders structured meta.judge + meta.scan (not markdown); SentMd is the legacy fallback.
// Log-only. Pairs with the Brief panel (forward terrain) — same useSentinelDigest fetch.

const cls = (v: number) => (v < 0 ? "neg" : "pos");
const md = (d: string) => (d ? d.slice(5) : "");

function BenchRow({ r }: { r: ScanRow }) {
  return (
    <div className="fx-row">
      <span className="fx-name">{r.slug}</span>
      <span className="fx-mid">
        peak <b>{r.peak}%</b> · win <b className={r.win >= 40 ? "pos" : "neg"}>{r.win}%</b>
        {r.net != null && <> · net <b className={cls(r.net)}>{signedUsd(r.net)}</b>/ct</>}
        {r.give != null && <> · give {r.give}%</>}
      </span>
      <span className="fx-n mut">{r.n}t</span>
    </div>
  );
}
function LeakRow({ r }: { r: ScanRow }) {
  return (
    <div className="fx-row">
      <span className="fx-name">{r.slug}</span>
      <span className="fx-mid">peak <b>{r.peak}%</b> · win <b className={r.win >= 40 ? "pos" : "neg"}>{r.win}%</b> · give {r.give}%</span>
      <span className={`fx-n ${cls(r.pnl ?? 0)}`}>{signedUsd(r.pnl ?? 0)}</span>
    </div>
  );
}

// MODULE-LEVEL frame — an inline `const Frame = …` would get a new component identity on
// every live-feed tick and remount the subtree (the chart-tick glitch). Hoisted = stable.
function Shell({ folded, onFold, date, children }: { folded: boolean; onFold: () => void; date: string; children: React.ReactNode }) {
  return (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">Sentinel</span>
        <span className="x">opportunity + drift{date ? ` · ${md(date)}` : ""} · log-only</span>
        <button type="button" className="pfold" onClick={onFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody">{children}</div>
    </div>
  );
}

export function SentinelPanel() {
  const { judge, scan, digest, date, state, err } = useSentinelDigest();
  const [folded, toggleFold] = useFold("sentinel");
  const [scanFolded, toggleScan] = useFold("sentinel-scan", true);

  if (state === "loading") return <Shell folded={folded} onFold={toggleFold} date={date}><div className="chart-empty">loading sentinel…</div></Shell>;
  if (state === "error") return <Shell folded={folded} onFold={toggleFold} date={date}><div className="chart-empty">couldn&apos;t load — {err}</div></Shell>;
  if (state === "empty") return <Shell folded={folded} onFold={toggleFold} date={date}><div className="chart-empty">no scan yet — runs after each close (or <code>npm run sentinel</code>)</div></Shell>;

  // legacy event (pre-structured meta): render the backward half of the markdown digest
  if (!judge && !scan) {
    const backward = digest ? splitDigest(digest).scan : "";
    return <Shell folded={folded} onFold={toggleFold} date={date}>{backward ? <SentMd md={backward} /> : <div className="chart-empty">scan pending next sentinel run</div>}</Shell>;
  }

  const v = (judge?.verdict ?? "HOLD").toString();
  const vcls = v === "QUEUE" ? "queue" : v === "WATCH" ? "watch" : "hold";

  return (
    <Shell folded={folded} onFold={toggleFold} date={date}>
      {/* VERDICT — the read, first */}
      {judge && (
        <>
          <div className="snt-verdict-row">
            <span className={`snt-verdict ${vcls}`}>{v}</span>
            <span className="snt-sowhat">{judge.soWhat}</span>
          </div>
          {judge.opportunities.length > 0 && (
            <>
              <div className="au-sub" style={{ borderTop: "none", paddingTop: 2 }}>Opportunities</div>
              <ul className="snt-bullets">{judge.opportunities.map((o, i) => <li key={i}>{o}</li>)}</ul>
            </>
          )}
          <div className="au-sub">Drift</div>
          {judge.drift.length > 0
            ? <ul className="snt-bullets">{judge.drift.map((d, i) => <li key={i}>{d}</li>)}</ul>
            : <div className="snt-clean">clean — nothing off-doctrine</div>}
        </>
      )}

      {/* SCAN — the deterministic evidence, behind expand */}
      {scan && (
        <>
          <button type="button" className="au-sub au-subfold" onClick={toggleScan} aria-expanded={!scanFolded} style={{ width: "100%" }}>
            Scan <span className="au-subx">bench promote · leaks · drift — last {scan.benchDays}d</span>
            <span className="fold-ch">{scanFolded ? "▸" : "▾"}</span>
          </button>
          {!scanFolded && (
            <>
              {scan.drift.length > 0 && (
                <><div className="brief-mini">drift vs last session</div>
                <ul className="snt-bullets sm">{scan.drift.map((d, i) => <li key={i}>{d}</li>)}</ul></>
              )}
              {scan.promote.length > 0 && (
                <><div className="brief-mini">clean promote (net&gt;0 · peak≥12% · win≥40%)</div>{scan.promote.map((r) => <BenchRow key={r.slug} r={r} />)}</>
              )}
              {scan.fixable.length > 0 && (
                <><div className="brief-mini">high peak / low win — harvest-fix, not a promote</div>{scan.fixable.map((r) => <BenchRow key={r.slug} r={r} />)}</>
              )}
              {scan.leaks.length > 0 && (
                <><div className="brief-mini">live harvest leaks (peak surrendered → TP/ratchet)</div>{scan.leaks.map((r) => <LeakRow key={r.slug} r={r} />)}</>
              )}
              {!!scan.patterns?.length && (
                <><div className="brief-mini">trigger patterns (median-split · descriptive — probe candidates, never gates)</div>
                <ul className="snt-bullets sm">{scan.patterns.map((p, i) => <li key={i}>{p}</li>)}</ul></>
              )}
              {(scan.scalps.length > 0 || scan.craters.length > 0) && (
                <div className="fx-foot">
                  {scan.scalps.length > 0 && <div>scalps (&lt;5% peak): {scan.scalps.join(", ")}</div>}
                  {scan.craters.length > 0 && <div>bench craters (giveback &gt;500%): {scan.craters.join(", ")}</div>}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}
