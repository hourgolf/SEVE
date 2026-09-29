"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { startVisibilityPoll } from "@/lib/pollControl";
import type { ChannelManagerEvidenceBook } from "@/lib/research/channelManagerEvidence";

export interface ChannelManagerEvidenceRead {
  state: "idle" | "loading" | "ok" | "empty" | "error";
  book: ChannelManagerEvidenceBook | null;
  error: string;
  asOf: string | null;
}

const EMPTY: ChannelManagerEvidenceRead = { state: "idle", book: null, error: "", asOf: null };
const MANAGER_EVIDENCE_REOPEN_CACHE_MS = 10 * 60_000;

export function useChannelManagerEvidence(enabled: boolean): ChannelManagerEvidenceRead {
  const { session, operator } = useAuth();
  const [state, setState] = useState<ChannelManagerEvidenceRead>(EMPTY);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (!session || !operator) {
      setState(EMPTY);
      return;
    }
    if (!enabled) return;
    let alive = true;
    let reading = false;
    const poll = async () => {
      if (reading) return;
      const cached = stateRef.current;
      if ((cached.state === "ok" || cached.state === "empty") && cached.asOf
        && Date.now() - Date.parse(cached.asOf) < MANAGER_EVIDENCE_REOPEN_CACHE_MS) return;
      reading = true;
      setState((current) => ({ ...current, state: current.book ? current.state : "loading", error: "" }));
      try {
        const response = await fetch("/api/channel-manager-evidence", {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json().catch(() => ({})) as {
          ok?: boolean; error?: string; book?: ChannelManagerEvidenceBook;
        };
        if (!response.ok || !body.ok || !body.book) throw new Error(body.error ?? `manager evidence read failed (${response.status})`);
        if (alive) setState({
          state: Object.keys(body.book.channels).length ? "ok" : "empty",
          book: body.book,
          error: "",
          asOf: body.book.generatedAt,
        });
      } catch (error) {
        if (alive) setState((current) => ({
          ...current,
          state: "error",
          error: error instanceof Error ? error.message : "manager evidence read failed",
        }));
      } finally { reading = false; }
    };
    void poll();
    const stop = startVisibilityPoll(() => void poll(), 10 * 60_000);
    return () => { alive = false; stop(); };
  }, [enabled, operator, session]);

  return state;
}
