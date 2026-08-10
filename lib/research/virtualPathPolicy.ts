// Pure, deterministic source policy for future virtual-path publication.
// It records the exact stop/target semantics available at signal time. The
// publisher must consume this receipt rather than reading mutable strategist
// configuration after the session.

import { createHash } from "node:crypto";

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

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function virtualPathPolicyStamp(input: {
  channel: { premium_stop_pct: number | null; take_profit_pct: number };
  defaultPremiumStopPct: number;
  managerVersion: string | null;
}): VirtualPathPolicyStamp {
  if ((input.channel.premium_stop_pct != null
      && (!finite(input.channel.premium_stop_pct) || input.channel.premium_stop_pct < 0))
    || !finite(input.channel.take_profit_pct) || input.channel.take_profit_pct < 0
    || !finite(input.defaultPremiumStopPct) || input.defaultPremiumStopPct <= 0
    || (input.managerVersion != null && !/^sha256:[0-9a-f]{64}$/.test(input.managerVersion))) {
    throw new Error("invalid virtual-path source policy");
  }
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

export function parseVirtualPathPolicyStamp(value: unknown): VirtualPathPolicyStamp | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schema !== VIRTUAL_PATH_POLICY_SCHEMA
    || (row.configuredPremiumStopPct != null && !finite(row.configuredPremiumStopPct))
    || !finite(row.scoredStopPct) || row.scoredStopPct <= 0
    || !finite(row.takeProfitPct) || row.takeProfitPct < 0
    || (row.managerVersion != null && typeof row.managerVersion !== "string")
    || typeof row.policyVersion !== "string") return null;
  try {
    const expected = virtualPathPolicyStamp({
      channel: {
        premium_stop_pct: row.configuredPremiumStopPct as number | null,
        take_profit_pct: row.takeProfitPct,
      },
      defaultPremiumStopPct: row.scoredStopPct,
      managerVersion: row.managerVersion as string | null,
    });
    // JSONB does not preserve insertion order. Compare the canonical payload,
    // not the property order returned by the storage adapter.
    return stable(expected) === stable(row) ? expected : null;
  } catch {
    return null;
  }
}
