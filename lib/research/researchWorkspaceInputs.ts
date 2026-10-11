import type { SurfaceProps } from "@/components/surfaceTypes";

/** Atlas consumes evidence and channel posture, not market marks or desk health.
 * This narrow type keeps new live dependencies from silently bypassing isolation. */
export type ResearchWorkspaceInputs = Pick<SurfaceProps,
  "shadowResearch" | "managerEvidence" | "decisionAtlas" | "setResearchDetailDemand"
> & {
  sentinel: Pick<SurfaceProps["sentinel"], "operatorPacket">;
  allChannelWorkspace: { bySlug: Record<string, {
    lifecycle: SurfaceProps["allChannelWorkspace"]["bySlug"][string]["lifecycle"];
    rootPolicy: { managerLabel: string | undefined };
  }> };
  channelControlPlane: { view: { configurationEpochId: string | null | undefined } };
  view: { desk: { strategists: Array<{ slug: string }> } };
};

// The page rebuilds passports during live polls. Compare only the fields Atlas
// displays; a release timestamp or price change must not rebuild its tables.
export function researchPostureKey(surface: SurfaceProps): string {
  return JSON.stringify([
    Object.entries(surface.allChannelWorkspace.bySlug).sort(([a], [b]) => a.localeCompare(b))
      .map(([slug, passport]) => [slug, passport.lifecycle, passport.rootPolicy?.managerLabel]),
    surface.channelControlPlane.view?.configurationEpochId,
    surface.view.desk.strategists.map((channel) => channel.slug),
  ]);
}

export function projectResearchInputs(surface: SurfaceProps): ResearchWorkspaceInputs {
  return {
    shadowResearch: surface.shadowResearch,
    managerEvidence: surface.managerEvidence,
    decisionAtlas: surface.decisionAtlas,
    setResearchDetailDemand: surface.setResearchDetailDemand,
    sentinel: { operatorPacket: surface.sentinel.operatorPacket },
    allChannelWorkspace: { bySlug: Object.fromEntries(Object.entries(surface.allChannelWorkspace.bySlug)
      .map(([slug, passport]) => [slug, {
        lifecycle: passport.lifecycle, rootPolicy: { managerLabel: passport.rootPolicy?.managerLabel },
      }])) },
    channelControlPlane: { view: { configurationEpochId: surface.channelControlPlane.view?.configurationEpochId } },
    view: { desk: { strategists: surface.view.desk.strategists.map(({ slug }) => ({ slug })) } },
  };
}
