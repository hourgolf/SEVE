// Pure, deterministic source policy for future virtual-path publication.
// It records the exact stop/target semantics available at signal time. The
// publisher must consume this receipt rather than reading mutable strategist
// configuration after the session.

import { createHash } from "node:crypto";
import type { ChannelConfig } from "./store.js";

export const VIRTUAL_PATH_POLICY_SCHEMA = "gate-shadow-native-policy-v1";

export interface VirtualPathPolicyStamp {
  schema: typeof VIRTUAL_PATH_POLICY_SCHEMA;
  configuredPremiumStopPct: number | null;
  scoredStopPct: number;
  takeProfitPct: number;
  managerVersion: string | null;
  policyVersion: string;
}

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}

export function virtualPathPolicyStamp(input: {
  channel: Pick<ChannelConfig, "premium_stop_pct" | "take_profit_pct">;
  defaultPremiumStopPct: number;
  managerVersion: string | null;
}): VirtualPathPolicyStamp {
  const configuredPremiumStopPct = input.channel.premium_stop_pct;
  // The existing capital-blind shadow deliberately uses the catastrophic
  // reference when a live premium stop is disabled (configured value 0).
  const scoredStopPct = configuredPremiumStopPct != null && configuredPremiumStopPct > 0
    ? configuredPremiumStopPct : input.defaultPremiumStopPct;
  const body = {
    schema: VIRTUAL_PATH_POLICY_SCHEMA,
    configuredPremiumStopPct,
    scoredStopPct,
    takeProfitPct: input.channel.take_profit_pct,
    managerVersion: input.managerVersion,
  } as const;
  return {
    ...body,
    policyVersion: `sha256:${createHash("sha256").update(stable(body)).digest("hex")}`,
  };
}
