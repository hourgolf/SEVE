"use client";

import { createContext, useContext } from "react";
import type { ChannelStatus, DeskState, FundState, PmColor, StrategistConfig } from "@/lib/desk/types";

// ============================================================================
//  Desk state — the write seam. Today the reducer mutates LOCAL state only.
//  To go live later, change ONLY this file + DeskProvider: seed from a Supabase
//  read, and fire authenticated updates on SET_CONFIG / SET_FUND / KILL (the
//  knob's onCommit is the natural write-throttle boundary). Components don't change.
// ============================================================================

export type DeskAction =
  | { type: "HYDRATE"; state: DeskState }
  | { type: "SET_CONFIG"; slug: string; patch: Partial<StrategistConfig> }
  | { type: "RENAME"; slug: string; name: string }
  | { type: "RECOLOR"; slug: string; color: PmColor }
  | { type: "SET_STATUS"; slug: string; status: ChannelStatus } // bench (draft) ⇄ re-arm
  | { type: "REMOVE"; slug: string }
  | { type: "TOGGLE_MUTE"; slug: string }
  | { type: "TOGGLE_SOLO"; slug: string }
  | { type: "REORDER"; order: string[] } // new display order, by slug
  | { type: "SET_FUND"; patch: Partial<FundState> }
  | { type: "SET_MODE"; mode: "paper" | "live" }
  | { type: "START" }
  | { type: "STOP" }
  | { type: "KILL"; reason: string }
  | { type: "RESET_HALT" };

export function deskReducer(state: DeskState, action: DeskAction): DeskState {
  switch (action.type) {
    case "HYDRATE":
      // Replace local state with real DB config (one-time, on mount).
      return action.state;
    case "SET_CONFIG":
      return {
        ...state,
        strategists: state.strategists.map((s) =>
          s.slug === action.slug
            ? { ...s, config: { ...s.config, ...action.patch } }
            : s
        ),
      };
    case "RENAME":
      return {
        ...state,
        strategists: state.strategists.map((s) =>
          s.slug === action.slug ? { ...s, name: action.name } : s
        ),
      };
    case "RECOLOR":
      return {
        ...state,
        strategists: state.strategists.map((s) =>
          s.slug === action.slug ? { ...s, color: action.color } : s
        ),
      };
    case "SET_STATUS":
      return {
        ...state,
        strategists: state.strategists.map((s) =>
          s.slug === action.slug ? { ...s, status: action.status } : s
        ),
      };
    case "REMOVE":
      return {
        ...state,
        strategists: state.strategists.filter((s) => s.slug !== action.slug),
      };
    case "TOGGLE_MUTE":
      return {
        ...state,
        strategists: state.strategists.map((s) =>
          s.slug === action.slug
            ? { ...s, config: { ...s.config, muted: !s.config.muted } }
            : s
        ),
      };
    case "TOGGLE_SOLO":
      return {
        ...state,
        strategists: state.strategists.map((s) =>
          s.slug === action.slug
            ? { ...s, config: { ...s.config, soloed: !s.config.soloed } }
            : s
        ),
      };
    case "REORDER": {
      // Reorder the channel list to match `order` (slugs). Optimistic; the new
      // sort_order is persisted by useDeskWrite.reorderChannels in parallel.
      const rank = new Map(action.order.map((slug, i) => [slug, i]));
      return {
        ...state,
        strategists: [...state.strategists].sort(
          (a, b) => (rank.get(a.slug) ?? 999) - (rank.get(b.slug) ?? 999)
        ),
      };
    }
    case "SET_FUND":
      return { ...state, fund: { ...state.fund, ...action.patch } };
    case "SET_MODE":
      return { ...state, fund: { ...state.fund, mode: action.mode } };
    case "START":
      return { ...state, fund: { ...state.fund, running: true } };
    case "STOP":
      return { ...state, fund: { ...state.fund, running: false } };
    case "KILL":
      return {
        ...state,
        fund: {
          ...state.fund,
          is_halted: true,
          halted_reason: action.reason,
          running: false,
        },
      };
    case "RESET_HALT":
      return {
        ...state,
        fund: { ...state.fund, is_halted: false, halted_reason: null },
      };
    default:
      return state;
  }
}

// Derived view exposed to consumers — solo/halt are computed, never stored
// across channels (so un-soloing instantly restores prior mute states).
export interface DeskView {
  desk: DeskState;
  anySolo: boolean;
  /** Is this strategist effectively trading right now? */
  isActive: (slug: string) => boolean;
}

export const DeskStateContext = createContext<DeskView | null>(null);
export const DeskDispatchContext =
  createContext<React.Dispatch<DeskAction> | null>(null);

export function useDeskState(): DeskView {
  const ctx = useContext(DeskStateContext);
  if (!ctx) throw new Error("useDeskState must be used within <DeskProvider>");
  return ctx;
}

export function useDeskDispatch(): React.Dispatch<DeskAction> {
  const ctx = useContext(DeskDispatchContext);
  if (!ctx) throw new Error("useDeskDispatch must be used within <DeskProvider>");
  return ctx;
}
