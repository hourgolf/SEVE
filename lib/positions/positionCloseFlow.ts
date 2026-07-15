import type { Position } from "@/lib/desk/types";

export interface PositionClosePrompt {
  id: string;
  label: string;
}

export interface PositionCloseFlowState {
  confirmId: string | null;
  closingId: string | null;
  error: string | null;
  tagPrompt: PositionClosePrompt | null;
  tagging: boolean;
}

export const INITIAL_POSITION_CLOSE_FLOW: PositionCloseFlowState = {
  confirmId: null,
  closingId: null,
  error: null,
  tagPrompt: null,
  tagging: false,
};

export type PositionCloseFlowAction =
  | { type: "ARM"; id: string }
  | { type: "DISARM"; id?: string }
  | { type: "CLOSE_START"; id: string }
  | { type: "CLOSE_FAILED"; error: string }
  | { type: "CLOSE_SUCCEEDED"; prompt: PositionClosePrompt }
  | { type: "TAG_START" }
  | { type: "TAG_FAILED"; error: string }
  | { type: "TAG_SUCCEEDED" }
  | { type: "DISMISS_TAG" };

/**
 * Pure state machine for the operator close flow. The close is deliberately
 * complete before the optional reason prompt appears, so classification never
 * delays a protective exit. Desktop and mobile share this exact transition
 * model; neither surface owns a second broker/write path.
 */
export function positionCloseFlowReducer(
  state: PositionCloseFlowState,
  action: PositionCloseFlowAction,
): PositionCloseFlowState {
  switch (action.type) {
    case "ARM":
      if (state.closingId) return state;
      return { ...state, confirmId: action.id, error: null };
    case "DISARM":
      if (action.id && state.confirmId !== action.id) return state;
      return { ...state, confirmId: null };
    case "CLOSE_START":
      return { ...state, confirmId: null, closingId: action.id, error: null };
    case "CLOSE_FAILED":
      return { ...state, closingId: null, error: action.error };
    case "CLOSE_SUCCEEDED":
      return { ...state, closingId: null, error: null, tagPrompt: action.prompt, tagging: false };
    case "TAG_START":
      if (!state.tagPrompt) return state;
      return { ...state, tagging: true, error: null };
    case "TAG_FAILED":
      return { ...state, tagging: false, error: action.error };
    case "TAG_SUCCEEDED":
      return { ...state, tagging: false, error: null, tagPrompt: null };
    case "DISMISS_TAG":
      return { ...state, tagging: false, tagPrompt: null };
  }
}

export function positionCloseLabel(position: Pick<Position, "strike" | "opt_type">): string {
  return `${position.strike.toFixed(0)}${position.opt_type === "call" ? "C" : "P"}`;
}
