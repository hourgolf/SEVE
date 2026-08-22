import type { ChannelPassport } from "@/lib/channels/channelPassport";
import type { ChannelControlPlaneOperatorView, ChannelControlPlaneSpecView } from "@/lib/channels/channelControlPlaneOperatorView";

export type ChannelRuntimePosture = "trading" | "trading-elsewhere" | "observing" | "not-trading" | "unverified";

export interface ChannelRuntimeAuthority {
  posture: ChannelRuntimePosture;
  label: "TRADING" | "TRADING ELSEWHERE" | "OBSERVING" | "NOT TRADING" | "UNVERIFIED";
  scope: "roots" | "dark";
  source: "current-manifest" | "passport-fallback";
  spec: ChannelControlPlaneSpecView | null;
  fact: string;
}

/** The current receipt-bound manifest owns execution labels whenever it is available. */
export function resolveChannelRuntimeAuthority(
  slug: string,
  passport: ChannelPassport | undefined,
  view: ChannelControlPlaneOperatorView | null | undefined,
  accountId?: string | null,
): ChannelRuntimeAuthority {
  if (view?.state === "receipt-bound") {
    const spec = view.bySlug[slug] ?? null;
    if (spec?.executionPosture === "paper" && accountId && spec.accountId !== accountId) return {
      posture: "trading-elsewhere", label: "TRADING ELSEWHERE", scope: "dark", source: "current-manifest", spec,
      fact: `This channel may trade in ${spec.accountLabel}, not the selected account.`,
    };
    if (spec?.executionPosture === "paper") return {
      posture: "trading", label: "TRADING", scope: "roots", source: "current-manifest", spec,
      fact: `${spec.accountLabel} · ${spec.quantity} contracts · current live roster`,
    };
    if (spec?.executionPosture === "observe-only") return {
      posture: "observing", label: "OBSERVING", scope: "dark", source: "current-manifest", spec,
      fact: "Current roster permits research collection but no paper entries.",
    };
    return {
      posture: "not-trading", label: "NOT TRADING", scope: "dark", source: "current-manifest", spec: null,
      fact: "This channel is not in the current live roster.",
    };
  }
  if (passport?.lifecycle === "paper-root") return {
    posture: "trading", label: "TRADING", scope: "roots", source: "passport-fallback", spec: null,
    fact: passport.lifecycleFact,
  };
  if (passport?.lifecycle === "dark-evidence") return {
    posture: "observing", label: "OBSERVING", scope: "dark", source: "passport-fallback", spec: null,
    fact: passport.lifecycleFact,
  };
  return {
    posture: "unverified", label: "UNVERIFIED", scope: "dark", source: "passport-fallback", spec: null,
    fact: passport?.lifecycleFact ?? "Current runtime authority is unavailable.",
  };
}
