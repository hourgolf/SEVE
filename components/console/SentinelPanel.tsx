"use client";

import { useEffect, useState, Fragment } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { useFold } from "@/hooks/useFold";

// The nightly sentinel digest (avg-peak opportunity + drift scan → LLM judgment),
// published to the `events` table by scripts/sentinel.ts. Latest-only, self-fetched,
// read-only — the durable copy lives in data/sentinel/<date>.md. 909 panel idiom;
// §04 is a log-section so the cream token-flip inks the text.
function inlineBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((p, i) =>
    i % 2 === 1 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>,
  );
}

export function SentinelPanel() {
  const [digest, setDigest] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [state, setState] = useState<"loading" | "ok" | "empty" | "error">("loading");
  const [err, setErr] = useState("");
  const [folded, toggleFold] = useFold("sentinel");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await getSupabase()
          .from("events").select("message,created_at,meta")
          .like("message", "sentinel:%").order("created_at", { ascending: false }).limit(1);
        if (!alive) return;
        if (error) { setState("error"); setErr(error.message); return; }
        const row = (data ?? [])[0] as any;
        const dg = row?.meta?.digest as string | undefined;
        if (!dg) { setState("empty"); return; }
        setDigest(dg);
        setDate((row.meta?.date as string) ?? row.created_at?.slice(0, 10) ?? "");
        setState("ok");
      } catch (e) { if (alive) { setState("error"); setErr((e as Error).message); } }
    })();
    return () => { alive = false; };
  }, []);

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">Sentinel</span>
        <span className="x">brief + opportunity + drift{date ? ` · ${date.slice(5)}` : ""} · log-only</span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody">{children}</div>
    </div>
  );

  if (state === "loading") return <Frame><div className="chart-empty">loading sentinel…</div></Frame>;
  if (state === "error") return <Frame><div className="chart-empty">couldn&apos;t load sentinel — {err}</div></Frame>;
  if (state === "empty") return <Frame><div className="chart-empty">no digest yet — runs after each close (or <code>npm run sentinel</code>)</div></Frame>;

  return (
    <Frame>
      <div className="sent-md">
        {(digest ?? "").split("\n").map((ln, i) => {
          if (/^#{1,3}\s/.test(ln)) return <div className="sent-h" key={i}>{inlineBold(ln.replace(/^#{1,3}\s/, ""))}</div>;
          if (/^[─═]{3,}/.test(ln)) return <hr className="sent-hr" key={i} />;
          if (ln.trim() === "") return <div className="sent-sp" key={i} />;
          return <div className="sent-ln" key={i}>{inlineBold(ln)}</div>;
        })}
      </div>
    </Frame>
  );
}
