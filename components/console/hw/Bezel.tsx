"use client";

import type { ReactNode } from "react";

export interface BezelProps {
  label?: string;
  accent?: string; // optional colored section label (909 instrument band)
  children: ReactNode;
  screws?: boolean;
  className?: string;
}

// A recessed dark sub-panel with optional corner screws and a section label —
// the chassis grouping primitive.
export function Bezel({ label, accent, children, screws = true, className }: BezelProps) {
  return (
    <div className={`bezel${className ? " " + className : ""}`}>
      {label && (
        <div className="bezel-label" style={accent ? { color: accent } : undefined}>
          {label}
        </div>
      )}
      {screws && (
        <>
          <span className="screw bezel-screw tl" />
          <span className="screw bezel-screw tr" />
          <span className="screw bezel-screw bl" />
          <span className="screw bezel-screw br" />
        </>
      )}
      <div className="bezel-body">{children}</div>
    </div>
  );
}
