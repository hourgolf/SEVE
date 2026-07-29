"use client";

import { useState } from "react";
import { useFold } from "@/hooks/useFold";
import { DailyAutopsyBody } from "./DailyAutopsyPanel";
import { WeeklyAutopsyBody } from "./WeeklyAutopsyPanel";
import type { useDailyReports } from "@/hooks/useDailyReports";
import type { useWeeklyReports } from "@/hooks/useWeeklyReports";
import type { StrategistState } from "@/lib/desk/types";

// The merged AUTOPSY panel — Daily + Weekly under one frame with a DAY⇄WEEK seg
// (§04 tidy: the weekly earned a toggle, not four stale days of rack space).
// The bodies keep their own expand/section state; WEEK's hook lazy-loads on first toggle.
export function AutopsyPanel({
  strategists,
  daily,
  weekly,
}: {
  strategists: StrategistState[];
  daily: ReturnType<typeof useDailyReports>;
  weekly: ReturnType<typeof useWeeklyReports>;
}) {
  const [view, setView] = useState<"day" | "week">("day");
  const [folded, toggleFold] = useFold("autopsy");

  return (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">Autopsy</span>
        <span className="x">sealed EOD report</span>
        <div className="seg" aria-label="autopsy window" style={{ marginLeft: "auto" }}>
          <button className={view === "day" ? "on" : ""} onClick={() => setView("day")} aria-pressed={view === "day"}>DAY</button>
          <button className={view === "week" ? "on" : ""} onClick={() => setView("week")} aria-pressed={view === "week"}>WEEK</button>
        </div>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody">
        {view === "day"
          ? <DailyAutopsyBody strategists={strategists} evidence={daily} />
          : <WeeklyAutopsyBody strategists={strategists} evidence={weekly} />}
      </div>
    </div>
  );
}
