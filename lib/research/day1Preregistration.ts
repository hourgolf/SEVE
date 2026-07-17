// Pure canonical seal helper. The caller owns roster construction, review,
// persistence, and application; this module cannot authorize a configuration.

import { createHash } from "node:crypto";

export const DAY1_PREREGISTRATION_SCHEMA_VERSION = 1 as const;

export interface Day1PreregistrationContent {
  schemaVersion: 1;
  contractId: string;
  cohortStartEt: "2026-07-20";
  paperOnly: true;
  roots: readonly Record<string, unknown>[];
  shadows: readonly Record<string, unknown>[];
  families: readonly Record<string, unknown>[];
  evidence: Record<string, unknown>;
  censors: readonly string[];
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

const FORBIDDEN_KEYS = new Set([
  "generatedAt", "generated_at", "localPath", "local_path", "cwd", "home",
  "username", "hostname", "queryAt", "query_at", "elapsedMs", "elapsed_ms",
]);

function stable(value: unknown, path = "content"): string {
  if (value == null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => stable(item, `${path}[${index}]`)).join(",")}]`;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  for (const key of keys) if (FORBIDDEN_KEYS.has(key)) throw new Error(`${path}.${key} is volatile and cannot enter the canonical seal`);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(row[key], `${path}.${key}`)}`).join(",")}}`;
}

export function sealDay1Preregistration(content: Day1PreregistrationContent): {
  canonicalJson: string;
  sha256: string;
} {
  if (content.schemaVersion !== DAY1_PREREGISTRATION_SCHEMA_VERSION
      || content.cohortStartEt !== "2026-07-20" || content.paperOnly !== true
      || content.policyChangeAuthorized !== false || content.productionChangeAuthorized !== false
      || !content.contractId || content.roots.length === 0) throw new Error("invalid Day 1 preregistration invariants");
  const canonicalJson = stable(content);
  return { canonicalJson, sha256: createHash("sha256").update(canonicalJson).digest("hex") };
}
