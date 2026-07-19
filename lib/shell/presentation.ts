export type WorkstationPresentation = "909" | "atlas";
export type DeploymentTarget = "production" | "preview" | "development";

/**
 * Alternate presentations are review surfaces until they pass the same
 * authenticated desktop/mobile drills as the primary workstation. Production
 * therefore fails closed to 909 even if a caller requests a lab shell.
 */
export function resolvePresentation(
  requested: WorkstationPresentation,
  target: DeploymentTarget,
): WorkstationPresentation {
  return target === "production" ? "909" : requested;
}

export function deploymentTarget(vercelEnv?: string): DeploymentTarget {
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";
  return "development";
}

