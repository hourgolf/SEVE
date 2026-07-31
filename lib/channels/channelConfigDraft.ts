import type { StrategistConfig } from "@/lib/desk/types";
import type { Day1ReleaseState } from "@/lib/channels/day1Release";

export const CHANNEL_CONFIG_DRAFT_VERSION = "channel-config-draft-v1";

export const CHANNEL_CONFIG_DRAFT_KEYS = [
  "capital_pct",
  "daily_stop_usd",
  "max_contracts",
  "entry_dte",
  "premium_stop_pct",
  "take_profit_pct",
  "underlying_stop_pct",
  "event_policy",
  "pyramid_adds",
] as const;

export type ChannelConfigDraftKey = (typeof CHANNEL_CONFIG_DRAFT_KEYS)[number];
export type ChannelConfigDraftPatch = Partial<Pick<StrategistConfig, ChannelConfigDraftKey>>;

export interface ChannelConfigDraftDiff {
  key: ChannelConfigDraftKey;
  label: string;
  before: string;
  after: string;
}

export interface ChannelConfigDraftIssue {
  key: ChannelConfigDraftKey | "release" | "identity" | "draft";
  tone: "warning" | "blocker";
  message: string;
}

export interface ChannelConfigDraftModel {
  version: typeof CHANNEL_CONFIG_DRAFT_VERSION;
  slug: string;
  state: "empty" | "reviewable" | "blocked";
  source: {
    releaseState: Day1ReleaseState;
    releaseId: string;
    releaseHash: string;
    configurationEpochId: string | null;
  };
  patch: ChannelConfigDraftPatch;
  diffs: ChannelConfigDraftDiff[];
  issues: ChannelConfigDraftIssue[];
  canonicalJson: string;
  activationAuthorized: false;
}

const LABELS: Record<ChannelConfigDraftKey, string> = {
  capital_pct: "risk / trade",
  daily_stop_usd: "entry latch / day",
  max_contracts: "hard contract cap",
  entry_dte: "entry DTE",
  premium_stop_pct: "premium catastrophe stop",
  take_profit_pct: "take profit",
  underlying_stop_pct: "underlying stop",
  event_policy: "event policy",
  pyramid_adds: "pyramid adds",
};

const effective = (config: StrategistConfig): Record<ChannelConfigDraftKey, number | string> => ({
  capital_pct: config.capital_pct,
  daily_stop_usd: config.daily_stop_usd,
  max_contracts: config.max_contracts,
  entry_dte: config.entry_dte ?? 0,
  premium_stop_pct: config.premium_stop_pct ?? 50,
  take_profit_pct: config.take_profit_pct ?? 0,
  underlying_stop_pct: config.underlying_stop_pct ?? 0,
  event_policy: config.event_policy ?? "standdown",
  pyramid_adds: config.pyramid_adds ?? 0,
});

const format = (key: ChannelConfigDraftKey, value: number | string): string => {
  if (key === "capital_pct" || key === "daily_stop_usd") return `$${Number(value).toLocaleString("en-US")}`;
  if (key === "max_contracts") return `${value} ct`;
  if (key === "entry_dte") return `${value}DTE`;
  if (key === "premium_stop_pct") return `−${value}%`;
  if (key === "take_profit_pct") return Number(value) === 0 ? "ride" : `+${value}%`;
  if (key === "underlying_stop_pct") return Number(value) === 0 ? "off" : `${value}%`;
  if (key === "pyramid_adds") return Number(value) === 0 ? "off" : `+${value}`;
  return String(value).toUpperCase();
};

const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
};

const validateValue = (key: ChannelConfigDraftKey, value: number | string): string | null => {
  if (key === "event_policy") return value === "standdown" || value === "ignore" ? null : "must be STAND-DOWN or TRADE-THRU";
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite number";
  if (key === "capital_pct" && (value < 25 || value > 5_000)) return "must be between $25 and $5,000";
  if (key === "daily_stop_usd" && (value < 0 || value > 5_000)) return "must be between $0 and $5,000";
  if (key === "max_contracts" && (!Number.isInteger(value) || value < 1 || value > 12)) return "must be a whole number from 1 to 12";
  if (key === "entry_dte" && value !== 0 && value !== 1) return "must be 0DTE or 1DTE";
  if (key === "premium_stop_pct" && (value < 10 || value > 90)) return "must be between 10% and 90%";
  if (key === "take_profit_pct" && (value < 0 || value > 300)) return "must be ride or 5%–300%";
  if (key === "take_profit_pct" && value !== 0 && value < 5) return "must be ride or 5%–300%";
  if (key === "underlying_stop_pct" && (value < 0 || value > 2)) return "must be off or 0.05%–2%";
  if (key === "underlying_stop_pct" && value !== 0 && value < 0.05) return "must be off or 0.05%–2%";
  if (key === "pyramid_adds" && (!Number.isInteger(value) || value < 0 || value > 3)) return "must be a whole number from 0 to 3";
  return null;
};

/** Build an inert, reviewable proposal. This deliberately does not hash, seal,
 * persist, or activate anything. A later authorized release process owns those
 * transitions; the UI may only export this canonical draft as input to review. */
export function deriveChannelConfigDraft(input: {
  slug: string;
  baseConfig: StrategistConfig;
  patch: ChannelConfigDraftPatch;
  releaseState: Day1ReleaseState;
  releaseId: string;
  releaseHash: string;
  configurationEpochId?: string | null;
}): ChannelConfigDraftModel {
  const base = effective(input.baseConfig);
  const patch: ChannelConfigDraftPatch = {};
  const issues: ChannelConfigDraftIssue[] = [];

  for (const key of CHANNEL_CONFIG_DRAFT_KEYS) {
    const value = input.patch[key];
    if (value === undefined || value === null) continue;
    const issue = validateValue(key, value);
    if (issue) issues.push({ key, tone: "blocker", message: `${LABELS[key]} ${issue}` });
    else if (value !== base[key]) Object.assign(patch, { [key]: value });
  }

  if (input.releaseState !== "verified") issues.push({
    key: "release", tone: "blocker",
    message: "The active release identity is not verified; a future epoch cannot fork from an uncertain runtime.",
  });
  if (!input.releaseId.trim() || !/^[a-f0-9]{64}$/i.test(input.releaseHash)) issues.push({
    key: "release", tone: "blocker",
    message: "The verified release is missing a valid contract ID or SHA-256 configuration identity.",
  });
  if (!input.configurationEpochId) issues.push({
    key: "identity", tone: "warning",
    message: "This channel has no active RC5 configuration epoch; review must assign a new identity before sealing.",
  }); else if (!/^(?:sha256:)?[a-f0-9]{64}$/i.test(input.configurationEpochId)) issues.push({
    key: "identity", tone: "blocker",
    message: "The source configuration epoch is not a valid SHA-256 identity.",
  });
  issues.push({
    key: "draft", tone: "warning",
    message: "Local draft only. It cannot modify RC5, Supabase, Railway, orders, or Monday admission.",
  });

  const diffs = CHANNEL_CONFIG_DRAFT_KEYS.flatMap((key): ChannelConfigDraftDiff[] => {
    const value = patch[key];
    return value === undefined || value === null ? [] : [{ key, label: LABELS[key], before: format(key, base[key]), after: format(key, value) }];
  });
  const blocked = issues.some((issue) => issue.tone === "blocker");
  const state = blocked ? "blocked" : diffs.length ? "reviewable" : "empty";
  const source = {
    releaseState: input.releaseState,
    releaseId: input.releaseId,
    releaseHash: input.releaseHash,
    configurationEpochId: input.configurationEpochId ?? null,
  };
  const canonicalJson = stable({
    version: CHANNEL_CONFIG_DRAFT_VERSION,
    slug: input.slug,
    source,
    patch,
    activationAuthorized: false,
  });

  return {
    version: CHANNEL_CONFIG_DRAFT_VERSION,
    slug: input.slug,
    state,
    source,
    patch,
    diffs,
    issues,
    canonicalJson,
    activationAuthorized: false,
  };
}
