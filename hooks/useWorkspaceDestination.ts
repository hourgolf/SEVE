"use client";

import { useCallback, useEffect, useState } from "react";
import {
  parseWorkspaceDestination,
  workspaceDestinationUrl,
  type WorkspaceDestination,
  type WorkspaceSection,
} from "@/lib/shell/workspaceDestination";

export function useWorkspaceDestination(fallback: WorkspaceSection = "overview") {
  const [destination, setDestination] = useState<WorkspaceDestination>({ section: fallback });

  useEffect(() => {
    const read = () => setDestination(parseWorkspaceDestination(window.location.search, fallback));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [fallback]);

  const navigate = useCallback((next: WorkspaceDestination, options?: { replace?: boolean }) => {
    const url = workspaceDestinationUrl(next, window.location.href);
    window.history[options?.replace ? "replaceState" : "pushState"]({ seveDestination: next }, "", url);
    setDestination(next);
  }, []);

  return { destination, navigate };
}

