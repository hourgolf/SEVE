"use client";

// =============================================================================
// SHELL STATE (PERFORM/STUDIO rebuild — slice S1)
// The three global switches that skin the new DeskShell top bar + branch the
// desktop Surface: MODE (studio⇄perform · `S`), SKIN (blackout⇄cream · `F`,
// the GLOBAL frame toggle), DENSITY (comfortable⇄compact · `D`). Persisted to
// localStorage so a return visit lands on the same look; DEFAULTS = studio /
// cream / comfortable = today's look, so existing users see no jarring change
// until they flip. S2–S5 consume this via the `useShell()` context hook.
//
// SKIN doubles as the legacy chassis theme: its union is IDENTICAL to the old
// `data-theme` (cream|blackout), so the page stamps data-theme={skin} on
// .console-root and the OPS settings toggle simply flips skin — one source of
// truth for "is the desk warm or graphite?". We migrate the old `seve-theme`
// key on first read so nobody's saved preference is lost.
// =============================================================================

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Mode = "studio" | "perform";
export type Skin = "blackout" | "cream"; // === the legacy `data-theme` union
export type Density = "comfortable" | "compact";

export interface ShellState {
  mode: Mode;
  skin: Skin;
  density: Density;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
  setSkin: (s: Skin) => void;
  toggleSkin: () => void;
  setDensity: (d: Density) => void;
  toggleDensity: () => void;
}

const K_MODE = "seve.mode";
const K_SKIN = "seve.skin";
const K_DENSITY = "seve.density";
const K_SKIN_LEGACY = "seve-theme"; // pre-S1 OPS chassis toggle

const ShellCtx = createContext<ShellState | null>(null);

// Are we typing? S/F/D must never fire while an input/textarea/contenteditable
// (a FIRES pill, the ⌘K field, a knob text entry) has focus.
function isEditing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  // SSR-safe: hydrate from localStorage in an effect (never during render) so
  // server and first client paint agree on the defaults.
  const [mode, setModeState] = useState<Mode>("studio");
  const [skin, setSkinState] = useState<Skin>("cream");
  const [density, setDensityState] = useState<Density>("comfortable");

  useEffect(() => {
    try {
      const m = localStorage.getItem(K_MODE);
      if (m === "studio" || m === "perform") setModeState(m);
      const s = localStorage.getItem(K_SKIN) ?? localStorage.getItem(K_SKIN_LEGACY);
      if (s === "blackout" || s === "cream") setSkinState(s);
      const d = localStorage.getItem(K_DENSITY);
      if (d === "comfortable" || d === "compact") setDensityState(d);
    } catch { /* localStorage blocked — keep defaults */ }
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(K_MODE, m); } catch { /* */ }
  }, []);
  const setSkin = useCallback((s: Skin) => {
    setSkinState(s);
    // Mirror to the legacy key too so a mixed-version tab never disagrees.
    try { localStorage.setItem(K_SKIN, s); localStorage.setItem(K_SKIN_LEGACY, s); } catch { /* */ }
  }, []);
  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try { localStorage.setItem(K_DENSITY, d); } catch { /* */ }
  }, []);

  const toggleMode = useCallback(() => setMode(mode === "studio" ? "perform" : "studio"), [mode, setMode]);
  const toggleSkin = useCallback(() => setSkin(skin === "cream" ? "blackout" : "cream"), [skin, setSkin]);
  const toggleDensity = useCallback(() => setDensity(density === "compact" ? "comfortable" : "compact"), [density, setDensity]);

  // Global keyboard map — S/F/D active only when not typing and no modifier is
  // held (⌘K / browser shortcuts pass through). ⌘K itself is S4's palette; here
  // we only broadcast a stub event so the affordance is live but honest.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("seve:command-palette")); // S4 stub
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditing()) return;
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); toggleMode(); }
      else if (k === "f") { e.preventDefault(); toggleSkin(); }
      else if (k === "d") { e.preventDefault(); toggleDensity(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMode, toggleSkin, toggleDensity]);

  const value = useMemo<ShellState>(
    () => ({ mode, skin, density, setMode, toggleMode, setSkin, toggleSkin, setDensity, toggleDensity }),
    [mode, skin, density, setMode, toggleMode, setSkin, toggleSkin, setDensity, toggleDensity],
  );
  return createElement(ShellCtx.Provider, { value }, children);
}

export function useShell(): ShellState {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error("useShell must be used within <ShellProvider>");
  return ctx;
}
