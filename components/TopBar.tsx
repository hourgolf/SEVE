import { money, timeOfDay } from "@/lib/format";
import type { FeedStatus } from "@/lib/types";

const STATUS_LABEL: Record<FeedStatus, string> = {
  live: "LIVE",
  stale: "STALE",
  err: "ERROR",
};
const STATUS_COLOR: Record<FeedStatus, string> = {
  live: "var(--green)",
  stale: "var(--amber)",
  err: "var(--red)",
};

export function TopBar({
  status,
  spot,
  updatedAt,
}: {
  status: FeedStatus;
  spot: number | null;
  updatedAt: string | null;
}) {
  const dotClass = "dot" + (status === "live" ? "" : " " + status);
  return (
    <div className="topbar">
      <div className="brand">
        <div className="glyph">≣</div>
        <div>
          <h1>
            SEVE{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              / live market monitor
            </span>
          </h1>
          <div className="sub">SPY · 0DTE / 1DTE · ALPACA → SUPABASE</div>
        </div>
      </div>
      <div className="live">
        <span className={dotClass} />
        <span style={{ color: STATUS_COLOR[status] }}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="spot">
        <div className="lab">SPY</div>
        <div className="v num">{money(spot)}</div>
      </div>
      <div className="upd">
        <div className="lab">Updated</div>
        <div className="v">
          {updatedAt ? timeOfDay(updatedAt) : "—"}
        </div>
      </div>
    </div>
  );
}
