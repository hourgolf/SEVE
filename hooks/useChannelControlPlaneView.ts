"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { ChannelControlPlaneOperatorView } from "@/lib/channels/channelControlPlaneOperatorView";
import { startVisibilityPoll } from "@/lib/pollControl";

export interface ChannelControlPlaneViewRead {
  view: ChannelControlPlaneOperatorView | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: ChannelControlPlaneViewRead = {
  view: null,
  loading: false,
  error: null,
};

export function useChannelControlPlaneView(enabled: boolean): ChannelControlPlaneViewRead {
  const { session, operator } = useAuth();
  const [state, setState] = useState<ChannelControlPlaneViewRead>(EMPTY);

  useEffect(() => {
    if (!enabled || !session || !operator) {
      setState(EMPTY);
      return;
    }
    let alive = true;
    const poll = async () => {
      setState((current) => ({ ...current, loading: current.view == null, error: null }));
      try {
        const response = await fetch("/api/channel-control-plane", {
          method: "GET",
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({})) as {
          ok?: boolean;
          error?: string;
          view?: ChannelControlPlaneOperatorView;
        };
        if (!response.ok || !body.ok || !body.view) {
          throw new Error(body.error ?? `control-plane read failed (${response.status})`);
        }
        if (alive) setState({ view: body.view, loading: false, error: null });
      } catch (error) {
        if (alive) setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "control-plane read failed",
        }));
      }
    };
    void poll();
    const stop = startVisibilityPoll(poll, 30_000);
    return () => {
      alive = false;
      stop();
    };
  }, [enabled, operator, session]);

  return state;
}
