"use client";

import "./console.css";
import { useMarketData } from "@/hooks/useMarketData";
import { Chassis } from "@/components/console/Chassis";
import { TopBar } from "@/components/TopBar";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import { TapeHealth } from "@/components/TapeHealth";
import { EventLog } from "@/components/EventLog";
import { ErrorBanner } from "@/components/ErrorBanner";

export default function Page() {
  const data = useMarketData();

  return (
    <div className="console-root">
      <Chassis
        brand={<>SEVE<span> · LIVE MONITOR</span></>}
        sub="SPY · 0DTE / 1DTE · ALPACA → SUPABASE"
        right={<TopBar status={data.status} spot={data.spot} updatedAt={data.updatedAt} />}
      >
        {data.error && (
          <ErrorBanner message={data.error} isAccessError={data.isAccessError} />
        )}

        <div className="grid">
          <div className="col">
            <IntradayChart bars={data.bars} />
            <OptionChain
              snapshot={data.snapshot}
              spot={data.spot}
              deltasModeled={data.deltasModeled}
            />
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
      </Chassis>
    </div>
  );
}
