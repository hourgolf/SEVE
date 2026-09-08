"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Position } from "@/lib/desk/types";
import type { DeskWriteResult } from "@/hooks/useDeskWrite";
import {
  INITIAL_POSITION_CLOSE_FLOW,
  positionCloseFlowReducer,
  positionCloseLabel,
} from "@/lib/positions/positionCloseFlow";

interface PositionCloseWriter {
  closePosition: (id: string) => Promise<DeskWriteResult>;
  closePositionStatus?: (id: string) => Promise<DeskWriteResult>;
  tagClose: (id: string, tag: string) => Promise<DeskWriteResult>;
}

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * Shared guarded operator-close workflow. A durable request remains pending
 * until the authenticated status reader verifies global settlement; position
 * disappearance alone never triggers success or a post-close reason prompt.
 */
export function usePositionCloseFlow(write: PositionCloseWriter) {
  const [state, dispatch] = useReducer(positionCloseFlowReducer, INITIAL_POSITION_CLOSE_FLOW);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);

  const clearDisarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (!state.pendingPrompts.length || !write.closePositionStatus) return;
    const check = write.closePositionStatus;
    let stopped = false;
    const polls = new Set<ReturnType<typeof setTimeout>>();
    const read = async (prompt: typeof state.pendingPrompts[number]) => {
      let result: DeskWriteResult;
      try { result = await check(prompt.id); }
      catch { result = { ok: false, error: "Close status is unavailable; the exit remains pending." }; }
      if (stopped) return;
      if (result.ok && result.pending === false) {
        dispatch({ type: "CLOSE_SETTLED", prompt, canTag: result.canTag === true }); return;
      }
      if (!result.ok) dispatch({ type: "CLOSE_CHECK_FAILED", error: result.error ?? "Close remains unconfirmed." });
      const poll = setTimeout(() => { polls.delete(poll); void read(prompt); }, 2_000);
      polls.add(poll);
    };
    for (const prompt of state.pendingPrompts) void read(prompt);
    return () => { stopped = true; for (const poll of polls) clearTimeout(poll); };
  }, [state.pendingPrompts, write.closePositionStatus]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearDisarm();
    };
  }, [clearDisarm]);

  const armClose = useCallback((id: string) => {
    dispatch({ type: "ARM", id });
    clearDisarm();
    timer.current = setTimeout(() => dispatch({ type: "DISARM", id }), 4_000);
  }, [clearDisarm]);

  const cancelClose = useCallback(() => {
    clearDisarm();
    dispatch({ type: "DISARM" });
  }, [clearDisarm]);

  const confirmClose = useCallback(async (position: Position) => {
    clearDisarm();
    dispatch({ type: "CLOSE_START", id: position.id });
    try {
      const result = await write.closePosition(position.id);
      if (!active.current) return;
      if (!result.ok) {
        dispatch({ type: "CLOSE_FAILED", error: result.error ?? "close failed" });
        return;
      }
      if (result.pending) {
        dispatch({ type: "CLOSE_PENDING", prompt: { id: position.id, label: positionCloseLabel(position) } }); return;
      }
      if (result.canTag === false) {
        dispatch({ type: "CLOSE_SETTLED", prompt: { id: position.id, label: positionCloseLabel(position) }, canTag: false }); return;
      }
      dispatch({
        type: "CLOSE_SUCCEEDED",
        prompt: { id: position.id, label: positionCloseLabel(position) },
      });
    } catch (error) {
      if (active.current) dispatch({ type: "CLOSE_FAILED", error: messageOf(error, "close failed") });
    }
  }, [clearDisarm, write]);

  const tagClose = useCallback(async (value: string) => {
    const prompt = state.tagPrompt;
    if (!prompt) return;
    dispatch({ type: "TAG_START", id: prompt.id });
    try {
      const result = await write.tagClose(prompt.id, value);
      if (!active.current) return;
      if (!result.ok) {
        dispatch({ type: "TAG_FAILED", id: prompt.id, error: result.error ?? "reason tag failed" });
        return;
      }
      dispatch({ type: "TAG_SUCCEEDED", id: prompt.id });
    } catch (error) {
      if (active.current) dispatch({ type: "TAG_FAILED", id: prompt.id, error: messageOf(error, "reason tag failed") });
    }
  }, [state.tagPrompt, write]);

  const dismissTag = useCallback(() => dispatch({ type: "DISMISS_TAG" }), []);

  return { ...state, armClose, cancelClose, confirmClose, tagClose, dismissTag };
}
