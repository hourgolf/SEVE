"use client";

import { useMarketData } from "@/hooks/useMarketData";
import { TopBar } from "@/components/TopBar";
import { Sparkline } from "@/components/Sparkline";
import { OptionChain } from "@/components/OptionChain";
import { TapeHealth } from "@/components/TapeHealth";
import { EventLog } from "@/components/EventLog";
import { ErrorBanner } from "@/components/ErrorBanner";

export default function Page() {
  const data = useMarketData();

  return (
    <div className="wrap">
      {data.error && (
        <ErrorBanner message={data.error} isAccessError={data.isAccessError} />
      )}

      <TopBar status={data.status} spot={data.spot} updatedAt={data.updatedAt} />

      <div className="grid">
        <div className="col">
          <Sparkline bars={data.bars} />
          <OptionChain snapshot={data.snapshot} spot={data.spot} />
        </div>
        <div className="col">
          <TapeHealth
            rowCount={data.rowCount}
            lastIngestTs={data.lastIngestTs}
            snapCount={data.snapshot.length}
            expirations={data.expirations}
          />
          <EventLog events={data.events} />
        </div>
      </div>
    </div>
  );
}
