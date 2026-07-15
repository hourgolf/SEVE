"use client";

import "@/app/command.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "@/hooks/useShellState";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { buildCommands, type CommandDef } from "@/components/shell/commandRegistry";
import type { StrategistState } from "@/lib/desk/types";

// =============================================================================
// ⌘K COMMAND palette (PERFORM/STUDIO rebuild · slice S4) — the cream hardware
// module that floats over EITHER room. Mounted ONCE at the shell level (page.tsx,
// inside .shell-root). Opens on the `seve:command-palette` event that S1's global
// keydown + the DeskShell ⌘K keycap both fire; owns its own open/close.
//
// It REUSES the existing write paths — nothing re-forks:
//   · mode/skin/density → useShell() setters (also the S/F/D keys).
//   · mute/boost        → the same dispatch(TOGGLE_MUTE) / dispatch(SET_CONFIG
//                         {boosted}) + persistConfig the PerformDock/StudioRack fire.
//   · KILL              → the identical dispatch({type:"KILL"}) + persistFund halt
//                         KillControl uses — behind an ARMED·HOLD-⏎ confirm so a
//                         stray Enter can never flatten the desk.
// Writes are canWrite-gated; anon sees them disabled with a "sign in" hint (never
// a fake-success no-op). VIEW commands always work. Desktop navigation belongs
// to the workstation sidebar so the palette never advertises dead destinations.
// =============================================================================

const HOLD_MS = 900; // Enter must be held this long to fire KILL

// CommandDef + the registry builder now live in commandRegistry.ts (shared with
// the mobile COMMAND sheet). This component owns the desktop CHROME only.

export interface CommandPaletteProps {
  /** The account-scoped roster — one mute/boost set per channel. */
  channels: StrategistState[];
}

export function CommandPalette({ channels }: CommandPaletteProps) {
  const { mode, setMode, skin, toggleSkin, density, toggleDensity } = useShell();
  const dispatch = useDeskDispatch();
  const { canWrite, persistConfig, persistFund } = useDeskWrite();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [hold, setHold] = useState(0); // KILL hold-fill 0→1 (visual)

  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null); // focus to restore on close
  const holdRaf = useRef<number | null>(null);
  const holdFired = useRef(false);

  const cancelHold = useCallback(() => {
    if (holdRaf.current != null) cancelAnimationFrame(holdRaf.current);
    holdRaf.current = null;
    holdFired.current = false;
    setHold(0);
  }, []);

  const close = useCallback(() => {
    cancelHold();
    setOpen(false);
    // restore focus to whatever had it before we opened (a11y)
    const el = restoreRef.current;
    if (el && typeof el.focus === "function") setTimeout(() => el.focus(), 0);
  }, [cancelHold]);

  // Listen for the shared open event (⌘K keydown in S1 + the DeskShell keycap).
  useEffect(() => {
    const onEvt = () => {
      setOpen((o) => {
        if (o) return false; // ⌘K toggles
        restoreRef.current = document.activeElement as HTMLElement | null;
        setQuery("");
        setSel(0);
        return true;
      });
    };
    window.addEventListener("seve:command-palette", onEvt);
    return () => window.removeEventListener("seve:command-palette", onEvt);
  }, []);

  // Focus the input when we open.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else cancelHold();
  }, [open, cancelHold]);

  // ---- command registry (rebuilt when the roster/skin/mode change) ----------
  const commands = useMemo<CommandDef[]>(
    () => buildCommands({
      channels, mode, skin, density, setMode, toggleSkin, toggleDensity,
      dispatch, persistConfig, persistFund,
    }),
    [channels, mode, skin, density, setMode, toggleSkin, toggleDensity, dispatch, persistConfig, persistFund],
  );

  // ---- fuzzy/substring filter (every whitespace token must match) -----------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const toks = q.split(/\s+/);
    return commands.filter((c) => toks.every((t) => c.search.includes(t)));
  }, [query, commands]);

  // Keep the selected index in range; default OFF the danger KILL row so a fresh
  // open + Enter never lands on flatten (the KILL row is reached deliberately).
  useEffect(() => {
    setSel((s) => {
      if (filtered.length === 0) return 0;
      if (s >= filtered.length) return 0;
      return s;
    });
  }, [filtered]);
  useEffect(() => {
    if (!query) {
      const first = filtered.findIndex((c) => !c.danger);
      setSel(first < 0 ? 0 : first);
    } else {
      setSel(0);
    }
  }, [query, filtered]);

  // ---- run / hold-to-fire ---------------------------------------------------
  const canRun = useCallback((c: CommandDef) => !(c.needsWrite && !canWrite), [canWrite]);

  const runCmd = useCallback(
    (c: CommandDef) => {
      if (!canRun(c)) return; // anon: disabled, never a silent success
      c.run();
      close();
    },
    [canRun, close],
  );

  const startHold = useCallback(
    (c: CommandDef) => {
      if (!canRun(c) || holdRaf.current != null) return;
      const t0 = performance.now();
      holdFired.current = false;
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / HOLD_MS);
        setHold(p);
        if (p >= 1) {
          holdRaf.current = null;
          holdFired.current = true;
          c.run();
          close();
          return;
        }
        holdRaf.current = requestAnimationFrame(tick);
      };
      holdRaf.current = requestAnimationFrame(tick);
    },
    [canRun, close],
  );

  // Key handling lives on the input (focused while open) so ⌘K/Esc/arrows/Enter
  // all work with the caret in the field. The S1 global handler's isEditing guard
  // suppresses S/F/D while we're focused — correct: no accidental double-toggle.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); close(); return; }
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); cancelHold(); setSel((s) => (filtered.length ? (s + 1) % filtered.length : 0)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); cancelHold(); setSel((s) => (filtered.length ? (s - 1 + filtered.length) % filtered.length : 0)); return; }
    if (e.key === "Enter") {
      const c = filtered[sel];
      if (!c) return;
      e.preventDefault();
      if (c.hold) {
        // ARMED·HOLD-⏎: start the fill on the FIRST keydown; keydown repeats
        // (e.repeat) while held just keep it running; keyup cancels if early.
        if (!e.repeat) startHold(c);
      } else {
        runCmd(c);
      }
    }
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !holdFired.current) cancelHold();
  };

  if (!open) return null;

  // Group the filtered list, preserving first-seen group order.
  const order: string[] = [];
  const groups = new Map<string, CommandDef[]>();
  for (const c of filtered) {
    if (!groups.has(c.group)) { groups.set(c.group, []); order.push(c.group); }
    groups.get(c.group)!.push(c);
  }
  // Stable flat index so keyboard sel maps to the rendered rows.
  let flat = -1;

  return (
    <div
      className={`cmdk-ov${open ? " open" : ""}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      role="presentation"
    >
      <div className="cmdk-panel" role="dialog" aria-modal="true" aria-label="command palette">
        <div className="cmdk-top">
          <span className="cmdk-stripes"><i /><i /><i /></span>
          <span className="cmdk-title">COMMAND</span>
          <button type="button" className="cmdk-esc" onClick={close} title="close (Esc)">ESC</button>
        </div>
        <div className="cmdk-lcd">
          <div className="cmdk-in">
            <span className="pr">›</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              onKeyUp={onKeyUp}
              placeholder="mute · flatten · lock · boost · frame · goto …"
              autoComplete="off"
              spellCheck={false}
              aria-label="command query"
            />
            <span className="cmdk-count">{filtered.length} command{filtered.length === 1 ? "" : "s"}</span>
          </div>
          <div className="cmdk-rows">
            {filtered.length === 0 && <div className="cmdk-empty">no match</div>}
            {order.map((g) => (
              <div key={g}>
                <div className="cmdk-grp">{g}</div>
                {groups.get(g)!.map((c) => {
                  flat += 1;
                  const idx = flat;
                  const disabled = !canRun(c);
                  const isSel = idx === sel;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      className={`cmdk-row${c.danger ? " kill" : ""}${isSel ? " sel" : ""}${disabled ? " off" : ""}`}
                      style={c.pm ? ({ ["--pm" as string]: c.pm } as React.CSSProperties) : undefined}
                      onMouseEnter={() => setSel(idx)}
                      onClick={() => { if (!c.hold) runCmd(c); }}
                      onMouseDown={(e) => { if (c.hold && !disabled) { e.preventDefault(); startHold(c); } }}
                      onMouseUp={() => { if (c.hold && !holdFired.current) cancelHold(); }}
                      onMouseLeave={() => { if (c.hold && !holdFired.current) cancelHold(); }}
                      aria-disabled={disabled}
                      title={disabled ? "sign in (OPS) to run desk commands" : undefined}
                    >
                      <span className="selmark">▶</span>
                      <span className="pdot" />
                      <span className="lbl">
                        <span className="verb">{c.verb}</span>
                        {c.rest && <span className="rest">{c.rest}</span>}
                        {c.sub && <span className="sub">{c.sub}</span>}
                      </span>
                      {c.danger ? (
                        <span className="armtag">{disabled ? "SIGN IN" : "ARMED · HOLD ⏎"}</span>
                      ) : disabled ? (
                        <span className="signin">SIGN IN</span>
                      ) : c.kbd ? (
                        <kbd>{c.kbd}</kbd>
                      ) : null}
                      {c.danger && isSel && !disabled && <span className="cmdk-hold" style={{ width: `${hold * 100}%` }} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="cmdk-foot">
            <span><b>↑↓</b> navigate</span>
            <span><b>⏎</b> run</span>
            <span><b>esc</b> close</span>
            <span className="r">{canWrite ? "operator — writes persist" : "writes gate on auth · anon read-only"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
