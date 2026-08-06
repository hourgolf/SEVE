"use client";

import { useEffect, useState } from "react";
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

export function useChannelManagerEvidence(enabled: boolean): ChannelManagerEvidenceRead {
  const { session, operator } = useAuth();
  const [state, setState] = useState<ChannelManagerEvidenceRead>(EMPTY);

  useEffect(() => {
    if (!enabled || !session || !operator) {
      setState(EMPTY);
      return;
    }
    let alive = true;
    const poll = async () => {
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
      }
    };
    void poll();
    const stop = startVisibilityPoll(() => void poll(), 10 * 60_000);
    return () => { alive = false; stop(); };
  }, [enabled, operator, session]);

  return state;
}
