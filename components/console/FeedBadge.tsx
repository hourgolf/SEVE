"use client";

import type { FeedStatus } from "@/hooks/useDeskFeed";

// Communicates the real-feed state in the chassis head. "error" almost always
// means the read-access SQL hasn't been applied yet.
export function FeedBadge({ status }: { status: FeedStatus }) {
  if (status === "error") {
    return (
      <span className="feed-badge err" title="Run 04_dashboard_read_policies.sql in Supabase">
        ● desk tables not readable — run the read-access SQL
      </span>
    );
  }
  if (status === "empty") {
    return <span className="feed-badge empty">● LIVE · awaiting desk activity</span>;
  }
  return <span className="feed-badge live">● LIVE</span>;
}
