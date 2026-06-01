"use client";

import { useState } from "react";
import {
  parseFrontmatter,
  capabilityCheck,
  structureSupported,
  type StrategySpec,
} from "@/lib/desk/strategySpec";

// Add-Channel sheet: paste/upload a thesis .md → instant frontmatter preview →
// "Compile" (server-side LLM) → StrategySpec + a capability check that flags
// inputs/structures the desk can't execute yet (multi-leg, GEX, TICK, events).
// Persist + backtest-gate + arm are the next phase.
export function AddChannel({ onClose }: { onClose: () => void }) {
  const [md, setMd] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [spec, setSpec] = useState<StrategySpec | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);

  const fm = parseFrontmatter(md);
  const hasFm = Object.keys(fm).length > 0;
  const cap = spec ? capabilityCheck(spec) : null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setMd(await f.text());
  }

  async function compile() {
    setCompiling(true); setErr(null); setSpec(null); setNeedsKey(false);
    try {
      const r = await fetch("/api/compile-strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ md }),
      });
      const j = await r.json();
      if (j.needsKey) setNeedsKey(true);
      else if (j.error) setErr(j.error);
      else setSpec(j.spec as StrategySpec);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "compile failed");
    } finally {
      setCompiling(false);
    }
  }

  return (
    <div className="ac-scrim" onClick={onClose}>
      <div className="add-channel" onClick={(e) => e.stopPropagation()}>
        <div className="ac-head">
          <span className="ac-title">Add Channel</span>
          <button className="ac-x" onClick={onClose} aria-label="close">✕</button>
        </div>
        <p className="ac-sub">
          Paste or upload a strategy-thesis <code>.md</code>. It compiles to executable rules;
          inputs the desk can&apos;t run yet (multi-leg, GEX, TICK, event calendar) are flagged.
        </p>

        <input className="ac-file" type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={onFile} />
        <textarea
          className="ac-md"
          value={md}
          onChange={(e) => setMd(e.target.value)}
          placeholder={"---\nname: \"My Strategy\"\nstructure: single-leg\n...\n---\n\n## Thesis ..."}
          spellCheck={false}
        />

        {hasFm && (
          <div className="ac-preview">
            <div className="ac-name">{fm.name || fm.strategy_id || "untitled"}</div>
            <div className="ac-tags">
              {fm.structure && <span className="ac-tag">{fm.structure}</span>}
              {fm.direction && <span className="ac-tag">{fm.direction}</span>}
              {fm.dte_range && <span className="ac-tag">DTE {fm.dte_range}</span>}
              {fm.regime && <span className="ac-tag">{fm.regime}</span>}
            </div>
            {fm.structure && !structureSupported(fm.structure) && (
              <div className="ac-gap">⚠ {fm.structure} is multi-leg — not executable yet (backtest-only)</div>
            )}
          </div>
        )}

        <div className="ac-actions">
          <button className="ac-compile" disabled={!md.trim() || compiling} onClick={compile}>
            {compiling ? "Compiling…" : "Compile thesis"}
          </button>
        </div>

        {needsKey && (
          <div className="ac-note">
            Set <code>ANTHROPIC_API_KEY</code> in Vercel to compile the full rule-set. The
            frontmatter preview above works without it.
          </div>
        )}
        {err && <div className="ac-err">{err}</div>}

        {spec && cap && (
          <div className="ac-spec">
            <div className="ac-spec-head">
              Compiled · {spec.entries?.length ?? 0} entry rule(s), {spec.exits?.length ?? 0} exit(s)
            </div>
            <div className={cap.runnable ? "ac-ok" : "ac-warn"}>
              {cap.runnable
                ? "✓ fully runnable on current data"
                : `needs: ${cap.unsupported.join(" · ")}`}
            </div>
            <ul className="ac-rules">
              {(spec.entries ?? []).map((e, i) => (
                <li key={i}>
                  <span className={`ac-dir ac-${e.direction}`}>{e.direction}</span>
                  {e.all.map((c) => c.kind).join(", ")}
                </li>
              ))}
            </ul>
            <div className="ac-foot">Backtest + arm coming next — review the rules above for now.</div>
          </div>
        )}
      </div>
    </div>
  );
}
