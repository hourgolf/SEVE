"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { WorkstationPresentation } from "@/lib/shell/presentation";

const PresentationContext = createContext<WorkstationPresentation>("909");

export function PresentationProvider({
  children,
  presentation,
}: {
  children: ReactNode;
  presentation: WorkstationPresentation;
}) {
  return <PresentationContext.Provider value={presentation}>{children}</PresentationContext.Provider>;
}

export function usePresentation(): WorkstationPresentation {
  return useContext(PresentationContext);
}

