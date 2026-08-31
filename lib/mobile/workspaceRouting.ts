import type { WorkspaceDestination } from "../shell/workspaceDestination";
import type { MobileReviewMode } from "./reviewWorkspace";

export type MobileRoom = "play" | "studio" | "book" | "review" | "ops";

export function mobileRoomForDestination(destination: WorkspaceDestination): MobileRoom {
  switch (destination.section) {
    case "studio": return "studio";
    case "positions": return "book";
    case "research":
    case "tape":
    case "sentinel": return "review";
    case "ops": return "ops";
    default: return "play";
  }
}

export function mobileReviewModeForDestination(destination?: WorkspaceDestination): MobileReviewMode | null {
  if (destination?.section === "sentinel") return "sentinel";
  if (destination?.section === "research") return "shadow";
  if (destination?.section === "tape") return destination.reviewSection === "counterfactuals" ? "evidence" : "session";
  return null;
}

export function mobileReviewDestination(mode: MobileReviewMode): WorkspaceDestination | null {
  if (mode === "council") return null; // Local-only tab; keep the existing URL.
  if (mode === "sentinel") return { section: "sentinel" };
  if (mode === "shadow") return { section: "research", researchMode: "decisions" };
  return { section: "tape", ...(mode === "evidence" ? { reviewSection: "counterfactuals" as const } : {}) };
}
