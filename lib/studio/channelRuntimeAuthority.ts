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

export interface ChannelRuntimeRosterSummary {
  state: "receipt-bound" | "fallback";
  paper: number;
  observing: number;
  accounts: number | null;
  shortHash: string | null;
  paperSlugs: string[];
}

export function summarizeChannelRuntimeRoster(
  view: ChannelControlPlaneOperatorView | null | undefined,
  fallbackRootSlugs: readonly string[] = [],
): ChannelRuntimeRosterSummary {
  if (view?.state === "receipt-bound") {
    const paperSpecs = view.specs.filter((spec) => spec.executionPosture === "paper");
    return {
      state: "receipt-bound",
      paper: paperSpecs.length,
      observing: view.specs.length - paperSpecs.length,
      accounts: new Set(paperSpecs.map((spec) => spec.accountId)).size,
      shortHash: view.manifestContentHash?.replace(/^sha256:/, "").slice(0, 8) ?? null,
      paperSlugs: paperSpecs.map((spec) => spec.slug),
    };
  }
  return {
    state: "fallback",
    paper: fallbackRootSlugs.length,
    observing: 0,
    accounts: null,
    shortHash: null,
    paperSlugs: [...fallbackRootSlugs],
  };
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
