import { timeOfDay } from "@/lib/format";

// Ingestion vitals: total rows, last ingest time, contracts in the latest
// snapshot, and number of expirations tracked.
export function TapeHealth({
  rowCount,
  lastIngestTs,
  snapCount,
  expirations,
}: {
  rowCount: number;
  lastIngestTs: string | null;
  snapCount: number;
  expirations: number;
}) {
  return (
    <div className="panel">
      <div className="phead">
        <span className="t">Tape Health</span>
        <span className="x">ingestion</span>
      </div>
      <div className="pbody">
        <div className="stat">
          <span className="k">Rows in option_quotes</span>
          <span className="v num">{rowCount.toLocaleString()}</span>
        </div>
        <div className="stat">
          <span className="k">Last ingest</span>
          <span className="v num">{lastIngestTs ? timeOfDay(lastIngestTs) : "—"}</span>
        </div>
        <div className="stat">
          <span className="k">Contracts (latest snap)</span>
          <span className="v num">{snapCount || "—"}</span>
        </div>
        <div className="stat">
          <span className="k">Expirations tracked</span>
          <span className="v num">{expirations || "—"}</span>
        </div>
      </div>
    </div>
  );
}
