"use client";

import { useMemo } from "react";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { projectResearchInputs, researchPostureKey, type ResearchWorkspaceInputs } from "@/lib/research/researchWorkspaceInputs";

export function useResearchWorkspaceInputs(surface: SurfaceProps): ResearchWorkspaceInputs {
  const postureKey = researchPostureKey(surface);
  const { shadowResearch, managerEvidence, decisionAtlas, setResearchDetailDemand } = surface;
  const operatorPacket = surface.sentinel.operatorPacket;
  // Complete evidence reads include errors, coverage, freshness and publication.
  // Only unrelated live desk inputs are omitted from the dependency set.
  return useMemo(() => projectResearchInputs(surface),
    [postureKey, shadowResearch, managerEvidence, decisionAtlas, setResearchDetailDemand, operatorPacket]);
}
