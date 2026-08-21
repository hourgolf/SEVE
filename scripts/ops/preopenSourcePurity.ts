import { execFileSync } from "node:child_process";

export const PREOPEN_AUTHORITY_PATHS = [
  "engine/managerPolicy.ts",
  "lib/channels/channelControlPlanePersistence.ts",
  "lib/ops/preopenReadinessEngine.ts",
  "scripts/ops/activeOperationalContract.ts",
  "scripts/ops/rc54ReadinessAdapter.ts",
  "worker/src/channelConfigurationRuntimeAdapter.ts",
  "worker/src/day1ReleasePolicy.ts",
  "worker/src/rc54ManagerPolicy.ts",
  "worker/src/rc54ReleasePolicy.ts",
  "worker/src/temporaryRc54RuntimeAdapter.ts",
] as const;

export function parseDirtyAuthorityPaths(
  porcelain: string,
  authorityPaths: readonly string[] = PREOPEN_AUTHORITY_PATHS,
): string[] {
  const allowed = new Set(authorityPaths);
  return porcelain.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    const rawPath = line.slice(3).trim();
    const path = rawPath.includes(" -> ")
      ? rawPath.slice(rawPath.lastIndexOf(" -> ") + 4)
      : rawPath;
    return allowed.has(path) ? [path] : [];
  }).sort();
}

export function assertPreopenAuthoritySourcePure(cwd = process.cwd()): void {
  let porcelain: string;
  try {
    porcelain = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all", "--", ...PREOPEN_AUTHORITY_PATHS],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (cause) {
    throw new Error(
      `preopen source-purity check unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const dirty = parseDirtyAuthorityPaths(porcelain);
  if (!dirty.length) return;
  throw new Error(
    `authority-critical source is locally modified: ${dirty.join(", ")}. `
      + "Run production readiness from a clean worktree at the deployed commit; local experiments cannot certify production.",
  );
}
