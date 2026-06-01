"use client";

import { useMemo, useState } from "react";
import "./console.css";
import "./mobile.css";
import { useMarketData } from "@/hooks/useMarketData";
import { useDeskState } from "@/hooks/useDeskState";
import { useDeskFeed } from "@/hooks/useDeskFeed";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DeskProvider } from "@/components/console/DeskProvider";
import { DesktopSurface } from "@/components/DesktopSurface";
import { MobileApp } from "@/components/mobile/MobileApp";

// One set of data hooks, two layouts: the wide desktop chassis or the phone
// tab-shell. The data-seam pattern means neither layout re-subscribes.
function Surface() {
  const data = useMarketData();
  const view = useDeskState();
  const feed = useDeskFeed();
  const write = useDeskWrite();
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<string | null>(null);

  // SPY up/down on the day: spot vs the PRIOR session's close (the conventional
  // day-change reference). Using today's first bar mis-colored it — that bar can
  // be a noisy pre-market print well above the prior close. null until ready.
  const spotUp = useMemo<boolean | null>(() => {
    const bars = data.bars;
    if (!bars.length || data.spot == null) return null;
    const today = bars[bars.length - 1].ts.slice(0, 10);
    let priorClose: number | null = null;
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i].ts.slice(0, 10) < today) { priorClose = bars[i].close; break; }
    }
    return priorClose != null ? data.spot >= priorClose : null;
  }, [data.bars, data.spot]);

  const props = { data, view, feed, write, spotUp, selected, setSelected };
  return isMobile ? <MobileApp {...props} /> : <DesktopSurface {...props} />;
}

export default function Page() {
  return (
    <div className="console-root">
      <DeskProvider>
        <Surface />
      </DeskProvider>
    </div>
  );
}
