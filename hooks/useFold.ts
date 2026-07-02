"use client";

// useFold — shared collapse/expand state for panels + rooms (909-redesign
// slice 2: the one-page desk declutters by folding, not by hiding rooms).
// Persisted per-key to localStorage so the operator's arrangement survives
// reloads. Default = expanded unless the caller says otherwise.

import { useCallback, useEffect, useState } from "react";

export function useFold(key: string, defaultFolded = false): [boolean, () => void] {
  const [folded, setFolded] = useState(defaultFolded);
  useEffect(() => {
    try {
      const s = window.localStorage.getItem(`seve-fold-${key}`);
      if (s != null) setFolded(s === "1");
    } catch {
      /* private mode — session-only */
    }
  }, [key]);
  const toggle = useCallback(() => {
    setFolded((f) => {
      try {
        window.localStorage.setItem(`seve-fold-${key}`, f ? "0" : "1");
      } catch {
        /* */
      }
      return !f;
    });
  }, [key]);
  return [folded, toggle];
}
