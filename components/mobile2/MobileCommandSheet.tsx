"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "@/hooks/useShellState";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { buildCommands, type CommandDef } from "@/components/shell/commandRegistry";
import type { StrategistState } from "@/lib/desk/types";

// =============================================================================
// MOBILE · COMMAND sheet (S5) — the phone's ⌘K: the same cream hardware module
// as the desktop palette, re-hung as a bottom sheet in the thumb arc. It renders
// the SAME shared registry (buildCommands) so the two never drift. Tap-to-run for
// safe verbs; KILL arms on a HOLD-2s fill (never a single tap). Writes gate on
// auth — anon rows disable with a SIGN IN hint (never a fake-success no-op).
// =============================================================================

const HOLD_MS = 2000; // phone KILL: hold two seconds to flatten (ruling)

export function MobileCommandSheet({
  open, onClose, channels, gotoChannel,
}: {
  open: boolean;
  onClose: () => void;
  channels: StrategistState[];
  gotoChannel: (slug: string) => void;
}) {
  const { mode, skin, density, setMode, toggleSkin, toggleDensity } = useShell();
  const dispatch = useDeskDispatch();
  const { canDirectConfigure: canWrite, persistConfig, persistFund } = useDeskWrite();

  const [query, setQuery] = useState("");
  const [hold, setHold] = useState(0); // KILL fill 0→1
  const holdRaf = useRef<number | null>(null);
  const holdFired = useRef(false);

  const cancelHold = useCallback(() => {
    if (holdRaf.current != null) cancelAnimationFrame(holdRaf.current);
    holdRaf.current = null;
    holdFired.current = false;
    setHold(0);
  }, []);

  useEffect(() => { if (!open) { setQuery(""); cancelHold(); } }, [open, cancelHold]);

  const commands = useMemo<CommandDef[]>(
    () => buildCommands({
      channels, mode, skin, density, setMode, toggleSkin, toggleDensity,
      dispatch, persistConfig, persistFund,
      gotoChannel: (slug) => { gotoChannel(slug); onClose(); },
    }),
    [channels, mode, skin, density, setMode, toggleSkin, toggleDensity, dispatch, persistConfig, persistFund, gotoChannel, onClose],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const toks = q.split(/\s+/);
    return commands.filter((c) => toks.every((t) => c.search.includes(t)));
  }, [query, commands]);

  const canRun = (c: CommandDef) => !(c.needsWrite && !canWrite);

  const runCmd = (c: CommandDef) => {
    if (!canRun(c)) return;
    c.run();
    onClose();
  };

  const startHold = (c: CommandDef) => {
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
        onClose();
        return;
      }
      holdRaf.current = requestAnimationFrame(tick);
    };
    holdRaf.current = requestAnimationFrame(tick);
  };

  if (!open) return null;

  // Group preserving first-seen order.
  const order: string[] = [];
  const groups = new Map<string, CommandDef[]>();
  for (const c of filtered) {
    if (!groups.has(c.group)) { groups.set(c.group, []); order.push(c.group); }
    groups.get(c.group)!.push(c);
  }

  return (
    <div className="m2-cmd-ov" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className="m2-cmd-sheet" role="dialog" aria-modal="true" aria-label="command module">
        <div className="m2-cmd-grab" />
        <div className="m2-cmd-top">
          <span className="m2-cmd-stripes"><i /><i /><i /></span>
          <span className="m2-cmd-title">COMMAND</span>
          <button type="button" className="m2-cmd-x" onClick={onClose}>✕</button>
        </div>
        <div className="m2-cmd-lcd">
          <div className="m2-cmd-in">
            <span className="pr">›</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="mute · flatten · lock · frame · goto …"
              autoComplete="off"
              spellCheck={false}
              aria-label="command query"
            />
            <span className="cnt">{filtered.length}</span>
          </div>
          <div className="m2-cmd-rows">
            {filtered.length === 0 && <div className="m2-cmd-empty">no match</div>}
            {order.map((g) => (
              <div key={g}>
                <div className="m2-cmd-grp">{g}</div>
                {groups.get(g)!.map((c) => {
                  const disabled = !canRun(c);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      className={`m2-cmd-row${c.danger ? " kill" : ""}${disabled ? " off" : ""}`}
                      style={c.pm ? ({ ["--pm" as string]: c.pm } as React.CSSProperties) : undefined}
                      aria-disabled={disabled}
                      onClick={() => { if (!c.hold) runCmd(c); }}
                      onPointerDown={(e) => { if (c.hold && !disabled) { e.preventDefault(); startHold(c); } }}
                      onPointerUp={() => { if (c.hold && !holdFired.current) cancelHold(); }}
                      onPointerLeave={() => { if (c.hold && !holdFired.current) cancelHold(); }}
                    >
                      <span className="pdot" />
                      <span className="lbl">
                        <span className="verb">{c.verb}</span>
                        {c.rest && <span className="rest"> {c.rest}</span>}
                        {c.sub && <span className="sub">{c.sub}</span>}
                      </span>
                      {c.danger ? (
                        <span className="armtag">{disabled ? "SIGN IN" : "HOLD 2s"}</span>
                      ) : disabled ? (
                        <span className="signin">SIGN IN</span>
                      ) : c.kbd ? (
                        <span className="gotag">{c.kbd}</span>
                      ) : null}
                      {c.danger && !disabled && <span className="m2-cmd-hold" style={{ width: `${hold * 100}%` }} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="m2-cmd-foot">
            <span><b>tap</b> run</span>
            <span><b>hold</b> destructive</span>
            <span className="r">{canWrite ? "operator — writes persist" : "writes gate on auth"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
