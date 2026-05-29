import { timeOfDay } from "@/lib/format";
import type { MarketEvent } from "@/lib/types";

// Latest ~14 rows from the append-only events journal. Mirrors renderLog().
export function EventLog({ events }: { events: MarketEvent[] }) {
  return (
    <div className="panel">
      <div className="phead">
        <span className="t">System Event Log</span>
        <span className="x">live</span>
      </div>
      <div className="pbody">
        <div className="log">
          {events.length === 0 ? (
            <div className="line">
              <span className="msg muted">no events yet</span>
            </div>
          ) : (
            events.map((e) => (
              <div className="line" key={e.id}>
                <span className="ts">{timeOfDay(e.created_at)}</span>
                <span className={`lv ${e.level}`}>{e.level}</span>
                <span className="msg">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
