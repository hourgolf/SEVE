import type { Dispatch, SetStateAction } from "react";
import type { useMarketData } from "@/hooks/useMarketData";
import type { useDeskState } from "@/hooks/useDeskState";
import type { useDeskFeed } from "@/hooks/useDeskFeed";
import type { useDeskWrite } from "@/hooks/useDeskWrite";

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
}
