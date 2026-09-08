import type { Position } from "@/lib/desk/types";

export interface PositionClosePrompt {
  id: string;
  label: string;
}

export interface PositionCloseFlowState {
  confirmId: string | null;
  closingId: string | null;
  pendingPrompts: PositionClosePrompt[];
  error: string | null;
  tagPrompt: PositionClosePrompt | null;
  tagQueue: PositionClosePrompt[];
  tagging: boolean;
}

export const INITIAL_POSITION_CLOSE_FLOW: PositionCloseFlowState = {
  confirmId: null,
  closingId: null,
  pendingPrompts: [],
  error: null,
  tagPrompt: null,
  tagQueue: [],
  tagging: false,
};

export type PositionCloseFlowAction =
  | { type: "ARM"; id: string }
  | { type: "DISARM"; id?: string }
  | { type: "CLOSE_START"; id: string }
  | { type: "CLOSE_FAILED"; error: string }
  | { type: "CLOSE_PENDING"; prompt: PositionClosePrompt }
  | { type: "CLOSE_CHECK_FAILED"; error: string }
  | { type: "CLOSE_SETTLED"; prompt: PositionClosePrompt; canTag: boolean }
  | { type: "CLOSE_SUCCEEDED"; prompt: PositionClosePrompt }
  | { type: "TAG_START"; id: string }
  | { type: "TAG_FAILED"; id: string; error: string }
  | { type: "TAG_SUCCEEDED"; id: string }
  | { type: "DISMISS_TAG" };

function offerTag(state: PositionCloseFlowState, prompt: PositionClosePrompt) {
  if (!state.tagPrompt) return { tagPrompt: prompt, tagQueue: state.tagQueue, tagging: false };
  return { tagPrompt: state.tagPrompt, tagging: state.tagging,
    tagQueue: state.tagPrompt.id === prompt.id || state.tagQueue.some(p => p.id === prompt.id)
      ? state.tagQueue : [...state.tagQueue, prompt] };
}
function nextTag(state: PositionCloseFlowState) {
  return { tagPrompt: state.tagQueue[0] ?? null, tagQueue: state.tagQueue.slice(1), tagging: false };
}

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
      if (state.closingId || state.pendingPrompts.some(prompt => prompt.id === action.id)) return state;
      return { ...state, confirmId: action.id, error: null };
    case "DISARM":
      if (action.id && state.confirmId !== action.id) return state;
      return { ...state, confirmId: null };
    case "CLOSE_START":
      return { ...state, confirmId: null, closingId: action.id, error: null };
    case "CLOSE_FAILED":
      return { ...state, closingId: null, error: action.error };
    case "CLOSE_PENDING":
      return { ...state, confirmId: null, closingId: null,
        pendingPrompts: [...state.pendingPrompts.filter(prompt => prompt.id !== action.prompt.id), action.prompt], error: null };
    case "CLOSE_CHECK_FAILED":
      return { ...state, error: action.error };
    case "CLOSE_SETTLED":
      return { ...state, closingId: state.closingId === action.prompt.id ? null : state.closingId,
        pendingPrompts: state.pendingPrompts.filter(prompt => prompt.id !== action.prompt.id), error: null,
        ...(action.canTag ? offerTag(state, action.prompt) : {}) };
    case "CLOSE_SUCCEEDED":
      return { ...state, closingId: null, pendingPrompts: state.pendingPrompts.filter(prompt => prompt.id !== action.prompt.id),
        error: null, ...offerTag(state, action.prompt) };
    case "TAG_START":
      if (state.tagPrompt?.id !== action.id) return state;
      return { ...state, tagging: true, error: null };
    case "TAG_FAILED":
      if (state.tagPrompt?.id !== action.id) return state;
      return { ...state, tagging: false, error: action.error };
    case "TAG_SUCCEEDED":
      if (state.tagPrompt?.id !== action.id) return state;
      return { ...state, error: null, ...nextTag(state) };
    case "DISMISS_TAG":
      return { ...state, ...nextTag(state) };
  }
}

export function positionCloseLabel(position: Pick<Position, "strike" | "opt_type">): string {
  return `${position.strike.toFixed(0)}${position.opt_type === "call" ? "C" : "P"}`;
}
