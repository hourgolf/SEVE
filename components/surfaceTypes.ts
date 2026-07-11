import type { Dispatch, SetStateAction } from "react";
import type { useMarketData } from "@/hooks/useMarketData";
import type { useDeskState } from "@/hooks/useDeskState";
import type { useDeskFeed } from "@/hooks/useDeskFeed";
import type { useDeskWrite } from "@/hooks/useDeskWrite";
import type { useAccounts } from "@/hooks/useAccounts";
import type { OpsStatus } from "@/hooks/useOpsStatus";
import type { usePositionMarks } from "@/hooks/usePositionMarks";
import type { useSentinelDigest } from "@/hooks/useSentinelDigest";
import type { useWorkerRuns } from "@/hooks/useWorkerRuns";
import type { Incident } from "@/lib/incident/deriveIncident";
import type { channelPnl, liveFundPnl } from "@/lib/desk/derive";

/** The five rooms of the 909 desk (909-redesign slice 4) — one page, stacked:
 *  PLAY (perform) · MIX (tune) · WRITE (compose) · TAPE (review) · OPS (tend). */
export type Room = "play" | "mix" | "write" | "tape" | "ops";

// Shared props for the desktop / mobile surfaces. All data hooks are called once
// in the page and the results passed down, so neither layout re-subscribes.
export interface SurfaceProps {
  data: ReturnType<typeof useMarketData>;
  view: ReturnType<typeof useDeskState>;
  feed: ReturnType<typeof useDeskFeed>;
  write: ReturnType<typeof useDeskWrite>;
  spotUp: boolean | null;
  selected: string | null;
  setSelected: Dispatch<SetStateAction<string | null>>;
  /** §01 market instrument (SPY default, QQQ); the chart/chain/spot follow it. */
  symbol: string;
  setSymbol: Dispatch<SetStateAction<string>>;
  /** Active chassis theme + setter (cream default | blackout). OPS hosts the toggle. */
  theme: "cream" | "blackout";
  setTheme: Dispatch<SetStateAction<"cream" | "blackout">>;
  /** Multi-account (lifted to the seam): the roster scopes to the selected account. */
  accounts: ReturnType<typeof useAccounts>["accounts"];
  acctId: string | null;
  setAcctId: Dispatch<SetStateAction<string | null>>;
  /** Ops health (stream/cron/exec) — lifted so the shell + OPS share one 15s poll. */
  ops: OpsStatus;
  /** Live option marks + the P&L derived off them — shared by the shell LEDs + rooms. */
  liveMarks: ReturnType<typeof usePositionMarks>;
  livePnl: ReturnType<typeof channelPnl>;
  liveFund: ReturnType<typeof liveFundPnl>;
  /** Active room (shell tabs) + the market-band collapse state (DESK). */
  activeRoom: Room;
  setActiveRoom: Dispatch<SetStateAction<Room>>;
  collapsedMarket: boolean;
  setCollapsedMarket: Dispatch<SetStateAction<boolean>>;
  /** Sentinel digest (brief/scan/judge/lens) — LIFTED to the seam (P5 slice 1): PERFORM +
   *  mobile leaves consume this via props and never call useSentinelDigest themselves. */
  sentinel: ReturnType<typeof useSentinelDigest>;
  /** Worker crash-attribution ledger — lifted to the seam for the incident banner / system-health.
   *  Instability keys on abrupt16h (NOT boots16h — most boots are graceful redeploys). */
  workerRuns: ReturnType<typeof useWorkerRuns>;
  /** Ratcheted position peaks (usePositionPeaks over feed.positions × liveMarks) — lifted to the
   *  seam; the position rows in PERFORM/mobile consume this instead of re-calling the hook. */
  positionPeaks: Record<string, number>;
  /** Deterministic incident (P5 slice 3) — deriveIncident computed ONCE at the page seam from
   *  ops/workerRuns/positions/fund/session. Consumed by the desktop-PERFORM banner + health strip. */
  incident: Incident;
}
