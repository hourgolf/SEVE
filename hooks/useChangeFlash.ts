"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { prefersReducedMotion } from "@/lib/motion";

// Change-flash: when a watched dollar value moves MATERIALLY, wash the element's
// background green/red and let it decay (~0.55s). The number itself never tweens
// — at live tick rates rolling digits read as noise; the wash says "look here"
// while the value stays instantly readable (the Bloomberg-cell idiom). First
// render is the baseline, not a change. clearProps on complete returns the
// element to stylesheet truth — zero look-drift at rest. Wash colors are the
// dark-screen P&L family (--pm-green / the #f0563f red) since every flash
// target lives on a recessed LCD panel (theme-invariant in cream AND blackout).
export function useChangeFlash<T extends HTMLElement>(value: number, threshold = 10) {
  const ref = useRef<T | null>(null);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const last = prev.current;
    prev.current = value;
    if (last == null || ref.current == null) return; // baseline, or not mounted yet
    const delta = value - last;
    if (Math.abs(delta) < threshold || prefersReducedMotion()) return;
    gsap.fromTo(
      ref.current,
      { backgroundColor: delta > 0 ? "rgba(47, 213, 115, 0.28)" : "rgba(240, 86, 63, 0.24)" },
      { backgroundColor: "rgba(0, 0, 0, 0)", duration: 0.55, ease: "power1.out", overwrite: true, clearProps: "backgroundColor" },
    );
  }, [value, threshold]);
  return ref;
}
