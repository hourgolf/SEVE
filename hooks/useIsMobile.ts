"use client";

import { useEffect, useState } from "react";

// True below the phone breakpoint. SSR/first paint returns false (desktop) and
// corrects on mount — a brief desktop frame on phones, no hydration mismatch.
export function useIsMobile(breakpoint = 820): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [breakpoint]);
  return isMobile;
}
