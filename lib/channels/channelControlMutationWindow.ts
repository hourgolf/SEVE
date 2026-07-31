import {
  marketSession,
  type MarketSession,
} from "../incident/marketSession";

export const CHANNEL_CONTROL_MUTATION_WINDOW_VERSION =
  "channel-control-mutation-window-v1" as const;

export interface ChannelControlMutationWindow {
  version: typeof CHANNEL_CONTROL_MUTATION_WINDOW_VERSION;
  allowed: boolean;
  session: MarketSession;
  calendarCoverageKnown: boolean;
  code:
    | "mutation_window:verified_closed"
    | "mutation_window:premarket"
    | "mutation_window:market_open"
    | "mutation_window:calendar_unknown";
  message: string;
}

/**
 * Operator control-plane writes are deliberately an after-close/weekend
 * activity. Preview/read APIs stay available during the session, but no draft,
 * lifecycle, activation, rollback, registry, or collection-state write may be
 * inferred from flatness while the next/active session is in play.
 */
export function channelControlMutationWindow(
  nowMs: number,
): Readonly<ChannelControlMutationWindow> {
  const observed = marketSession(nowMs);
  if (!observed.coverageKnown) {
    return Object.freeze({
      version: CHANNEL_CONTROL_MUTATION_WINDOW_VERSION,
      allowed: false,
      session: observed.session,
      calendarCoverageKnown: false,
      code: "mutation_window:calendar_unknown",
      message: "Configuration writes are blocked because the market calendar coverage is unknown.",
    });
  }
  if (observed.session === "premarket") {
    return Object.freeze({
      version: CHANNEL_CONTROL_MUTATION_WINDOW_VERSION,
      allowed: false,
      session: observed.session,
      calendarCoverageKnown: true,
      code: "mutation_window:premarket",
      message: "Configuration writes are read-only before the regular session.",
    });
  }
  if (observed.session === "open") {
    return Object.freeze({
      version: CHANNEL_CONTROL_MUTATION_WINDOW_VERSION,
      allowed: false,
      session: observed.session,
      calendarCoverageKnown: true,
      code: "mutation_window:market_open",
      message: "Configuration writes are read-only during the regular session.",
    });
  }
  return Object.freeze({
    version: CHANNEL_CONTROL_MUTATION_WINDOW_VERSION,
    allowed: true,
    session: observed.session,
    calendarCoverageKnown: true,
    code: "mutation_window:verified_closed",
    message: "The verified after-close configuration-write window is open.",
  });
}
