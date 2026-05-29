import { timeOfDay } from "@/lib/format";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import type { FeedStatus } from "@/lib/types";

const STATUS_LABEL: Record<FeedStatus, string> = {
  live: "LIVE",
  stale: "STALE",
  err: "ERROR",
};
const STATUS_COLOR: Record<FeedStatus, string> = {
  live: "var(--pm-green)",
  stale: "var(--amber)",
  err: "var(--led-red)",
};

// The Monitor's status cluster, rendered into the chassis head: LIVE/STALE/ERROR
// indicator + SPY spot as a red 7-seg LED + last-updated time.
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
    <div className="monitor-status">
      <div className="ms-live">
        <span className={dotClass} />
        <span style={{ color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</span>
      </div>
      <LedDisplay
        value={spot != null ? spot.toFixed(2) : "----"}
        digits={6}
        caption="SPY $"
      />
      <div className="ms-upd">
        <div className="ms-lab">Updated</div>
        <div className="ms-val">{updatedAt ? timeOfDay(updatedAt) : "—"}</div>
      </div>
    </div>
  );
}
