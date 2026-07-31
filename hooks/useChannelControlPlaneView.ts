"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { ChannelControlPlaneOperatorView } from "@/lib/channels/channelControlPlaneOperatorView";
import { startVisibilityPoll } from "@/lib/pollControl";
import type {
  VersionedChannelDecisionPacket,
} from "@/lib/channels/channelDecisionPacket";

export interface ChannelControlPlaneViewRead {
  view: ChannelControlPlaneOperatorView | null;
  loading: boolean;
  error: string | null;
  decisionPacket: VersionedChannelDecisionPacket | null;
  decisionPacketError: string | null;
}

const EMPTY: ChannelControlPlaneViewRead = {
  view: null,
  loading: false,
  error: null,
  decisionPacket: null,
  decisionPacketError: null,
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
        const headers = {
          authorization: `Bearer ${session.access_token}`,
        };
        const [response, packetResponse] = await Promise.all([
          fetch("/api/channel-control-plane", {
            method: "GET", headers, cache: "no-store",
          }),
          fetch("/api/channel-decision-packet", {
            method: "GET", headers, cache: "no-store",
          }),
        ]);
        const body = await response.json().catch(() => ({})) as {
          ok?: boolean;
          error?: string;
          view?: ChannelControlPlaneOperatorView;
        };
        if (!response.ok || !body.ok || !body.view) {
          throw new Error(body.error ?? `control-plane read failed (${response.status})`);
        }
        const packetBody = await packetResponse.json().catch(() => ({})) as {
          ok?: boolean;
          error?: string;
          packet?: VersionedChannelDecisionPacket;
        };
        if (alive) setState({
          view: body.view,
          loading: false,
          error: null,
          decisionPacket:
            packetResponse.ok && packetBody.ok && packetBody.packet
              ? packetBody.packet
              : null,
          decisionPacketError:
            packetResponse.ok && packetBody.ok
              ? null
              : packetBody.error ?? "versioned packet unavailable",
        });
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
