"use client";

import { Fragment } from "react";

// Minimal markdown renderer for the sentinel LEGACY-FALLBACK path only (an old pre-structured
// event). Handles #-headers, ─-rules, **bold**, |-tables (as aligned mono), and colorizes signed
// money tokens (+$1,234 green / −$56 red) so even the fallback reads glanceably. The primary path
// renders structured visuals in BriefPanel / SentinelPanel — this is the safety net.

const MONEY = /([+\-−]\$[\d,]+)/g;

function inline(text: string, keyBase: string) {
  // split on bold first, then colorize money inside each run
  return text.split(/\*\*(.+?)\*\*/g).flatMap((part, i) => {
    const bold = i % 2 === 1;
    const pieces = part.split(MONEY).map((seg, j) => {
      if (MONEY.test(seg)) {
        const neg = seg.includes("−") || seg.startsWith("-");
        return <span key={`${keyBase}-${i}-${j}`} className={neg ? "neg" : "pos"}>{seg}</span>;
      }
      return <Fragment key={`${keyBase}-${i}-${j}`}>{seg}</Fragment>;
    });
    return bold ? [<strong key={`${keyBase}-b${i}`}>{pieces}</strong>] : pieces;
  });
}

export function SentMd({ md }: { md: string }) {
  return (
    <div className="sent-md">
      {md.split("\n").map((ln, i) => {
        if (/^#{1,3}\s/.test(ln)) return <div className="sent-h" key={i}>{inline(ln.replace(/^#{1,3}\s/, ""), `h${i}`)}</div>;
        if (/^[─═]{3,}/.test(ln)) return <hr className="sent-hr" key={i} />;
        if (ln.trim() === "") return <div className="sent-sp" key={i} />;
        return <div className="sent-ln" key={i}>{inline(ln, `l${i}`)}</div>;
      })}
    </div>
  );
}
