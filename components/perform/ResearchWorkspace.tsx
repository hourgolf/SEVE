"use client";

import dynamic from "next/dynamic";
import { memo } from "react";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { WorkspaceDestination } from "@/lib/shell/workspaceDestination";
import { useResearchWorkspaceInputs } from "@/hooks/useResearchWorkspaceInputs";

const ResearchPanel = memo(dynamic(() => import("./ShadowResearchWorkspace").then((module) => module.ShadowResearchWorkspace), {
  loading: () => <div className="srw-empty" role="status">Opening research workspace…</div>,
  ssr: false,
}));

export function ShadowResearchWorkspace({ surface, ...navigation }: {
  surface: SurfaceProps;
  compact?: boolean;
  destination?: WorkspaceDestination;
  onNavigate?: (destination: WorkspaceDestination) => void;
}) {
  const inputs = useResearchWorkspaceInputs(surface);
  return <ResearchPanel surface={inputs} {...navigation} />;
}
