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

  // SPY up/down on the day: spot vs the open of the session's first bar (UTC
  // date == ET trading date during RTH). null until we have both.
  const spotUp = useMemo<boolean | null>(() => {
    const bars = data.bars;
    if (!bars.length || data.spot == null) return null;
    const day = bars[bars.length - 1].ts.slice(0, 10);
    const open = bars.find((b) => b.ts.slice(0, 10) === day)?.open;
    return open != null ? data.spot >= open : null;
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
