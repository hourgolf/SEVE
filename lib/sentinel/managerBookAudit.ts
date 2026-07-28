import { BASE_MANAGER_IDS } from "../../engine/managerPolicy.js";

export interface SentinelManagerPosition {
  id: string;
  runnerOf: string | null;
}

export interface SentinelManagerPath {
  positionId: string;
  managerId: string;
  status: string;
  censorCode: string | null;
}

export interface SentinelManagerBookAudit {
  complete: boolean;
  rootPositions: number;
  runnerPositions: number;
  requiredArms: number;
  observed: number;
  terminal: number;
  censored: number;
  active: number;
  missingRequiredArms: number;
  duplicateRequiredArms: number;
  unexpectedPositionArms: number;
}

/**
 * The live position cohort includes runner child rows, but the durable manager
 * observer enrolls the root fill only. Audit the eight preregistered base arms
 * per root position and treat any extra observed candidate arm as additive
 * evidence that must also reach a clean terminal state.
 */
export function auditSentinelManagerBook(
  positions: readonly SentinelManagerPosition[],
  paths: readonly SentinelManagerPath[],
): SentinelManagerBookAudit {
  const roots = positions.filter((position) => position.runnerOf == null);
  const rootIds = new Set(roots.map((position) => position.id));
  const requiredIds = new Set<string>(BASE_MANAGER_IDS);
  const requiredCounts = new Map<string, number>();
  let unexpectedPositionArms = 0;

  for (const path of paths) {
    if (!rootIds.has(path.positionId)) {
      unexpectedPositionArms += 1;
      continue;
    }
    if (!requiredIds.has(path.managerId)) continue;
    const key = `${path.positionId}\u0000${path.managerId}`;
    requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
  }

  let missingRequiredArms = 0;
  let duplicateRequiredArms = 0;
  for (const root of roots) {
    for (const managerId of BASE_MANAGER_IDS) {
      const count = requiredCounts.get(`${root.id}\u0000${managerId}`) ?? 0;
      if (count === 0) missingRequiredArms += 1;
      if (count > 1) duplicateRequiredArms += count - 1;
    }
  }

  const terminal = paths.filter((path) => path.status === "terminal").length;
  const censored = paths.filter((path) => path.status === "censored" || path.censorCode != null).length;
  const active = paths.filter((path) => path.status === "active").length;
  const complete = missingRequiredArms === 0
    && duplicateRequiredArms === 0
    && unexpectedPositionArms === 0
    && terminal === paths.length
    && censored === 0;

  return {
    complete,
    rootPositions: roots.length,
    runnerPositions: positions.length - roots.length,
    requiredArms: roots.length * BASE_MANAGER_IDS.length,
    observed: paths.length,
    terminal,
    censored,
    active,
    missingRequiredArms,
    duplicateRequiredArms,
    unexpectedPositionArms,
  };
}
