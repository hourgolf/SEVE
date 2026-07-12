// =============================================================================
// COMMAND registry (PERFORM/STUDIO rebuild) — the single source of truth for the
// ⌘K command list, shared by the DESKTOP CommandPalette (S4) and the MOBILE
// COMMAND sheet (S5). Both surfaces render the SAME commands off this builder so
// the two never drift; only the chrome (floating panel vs. bottom sheet) differs.
//
// It is a pure builder — no React, no hooks. Every side-effect is a REUSED write
// path injected via the context: mode/skin/density setters (useShell), the desk
// dispatch + persistConfig/persistFund (useDeskWrite), and platform navigation
// callbacks (gotoRoom on desktop = flip to studio + scroll; gotoChannel = open
// the channel in the rack). Nothing here re-forks a write.
// =============================================================================

import type { Dispatch } from "react";
import { playKit } from "@/lib/desk/kit";
import { pmVar } from "@/lib/desk/colors";
import type { DeskAction } from "@/hooks/useDeskState";
import type { StrategistState, StrategistConfig, FundState } from "@/lib/desk/types";
import type { Mode, Skin, Density } from "@/hooks/useShellState";
import type { DeskWriteResult } from "@/hooks/useDeskWrite";

// One command. `run` closes over the reused write/setter paths; `needsWrite`
// gates on auth; `hold` = the KILL arm-hold (ARMED·HOLD ⏎ / hold-2s on phone).
// `search` is the fuzzy haystack.
export interface CommandDef {
  id: string;
  group: string;
  verb: string;
  rest?: string;
  sub?: string;
  kbd?: string;
  pm?: string; // channel accent (var(--pm-…)) for the row dot
  danger?: boolean;
  needsWrite?: boolean;
  hold?: boolean;
  run: () => void | Promise<void>;
  search: string;
}

// A legacy-room jump (desktop only — the §01–§04 rooms live in DesktopSurface).
export interface RoomNav { id: string; room: string; label: string; sub: string; search: string }

export interface CommandCtx {
  /** The account-scoped roster — one mute/boost/goto set per channel. */
  channels: StrategistState[];
  mode: Mode;
  skin: Skin;
  density: Density;
  setMode: (m: Mode) => void;
  toggleSkin: () => void;
  toggleDensity: () => void;
  dispatch: Dispatch<DeskAction>;
  persistConfig: (id: string, patch: Partial<StrategistConfig>) => Promise<DeskWriteResult>;
  persistFund: (patch: Partial<FundState>) => Promise<DeskWriteResult>;
  /** Open a channel in the rack (desktop = goto MIX + select; mobile = studio accordion). */
  gotoChannel: (slug: string) => void;
  /** Legacy §01–§04 room jumps (desktop). Omit on platforms without those rooms. */
  rooms?: RoomNav[];
  gotoRoom?: (room: string) => void;
}

export function buildCommands(ctx: CommandCtx): CommandDef[] {
  const {
    channels, mode, skin, density, setMode, toggleSkin, toggleDensity,
    dispatch, persistConfig, persistFund, gotoChannel, rooms, gotoRoom,
  } = ctx;
  const list: CommandDef[] = [];

  // ---- DESK ----
  list.push({
    id: "kill",
    group: "DESK",
    verb: "KILL",
    rest: "— flatten all",
    sub: "freeze entries",
    danger: true,
    needsWrite: true,
    hold: true,
    search: "kill flatten all positions desk halt",
    run: async () => {
      const result = await persistFund({ is_halted: true, halted_reason: "command palette" });
      if (!result.ok) return;
      dispatch({ type: "KILL", reason: "command palette" });
      playKit("crash"); // the 909 crash on FLATTEN — inert unless the KIT is on
    },
  });

  // ---- VIEW ----
  list.push({
    id: "mode",
    group: "VIEW",
    verb: "GOTO",
    rest: mode === "studio" ? "PERFORM · watch" : "STUDIO · tune",
    kbd: "S",
    search: "goto mode studio perform watch tune room",
    run: () => setMode(mode === "studio" ? "perform" : "studio"),
  });
  list.push({
    id: "frame",
    group: "VIEW",
    verb: "FRAME",
    rest: "— BLACKOUT ⇄ CREAM",
    sub: skin === "cream" ? "now cream" : "now blackout",
    kbd: "F",
    search: "frame blackout cream chrome skin global theme",
    run: () => toggleSkin(),
  });
  list.push({
    id: "density",
    group: "VIEW",
    verb: "DENSITY",
    rest: "— compact ⇄ comfortable",
    sub: density === "compact" ? "now compact" : "now comfortable",
    kbd: "D",
    search: "density compact comfortable readable type size",
    run: () => toggleDensity(),
  });

  // ---- NAV (desktop legacy rooms — flips to studio + scrolls) ----
  if (rooms && gotoRoom) {
    for (const rm of rooms) {
      list.push({
        id: rm.id,
        group: "NAV",
        verb: "GOTO",
        rest: rm.label,
        sub: rm.sub,
        search: rm.search,
        run: () => gotoRoom(rm.room),
      });
    }
  }

  // ---- CHANNELS (mute/boost/goto per roster channel) ----
  for (const ch of channels) {
    const muted = ch.config.muted;
    const boosted = ch.config.boosted ?? false;
    const pm = pmVar(ch.color);
    list.push({
      id: `mute-${ch.slug}`,
      group: "CHANNELS",
      verb: muted ? "UN-MUTE" : "MUTE",
      rest: ch.slug,
      sub: muted ? "bring back on the tape" : "soft off · arms stay armed",
      kbd: "M",
      pm,
      needsWrite: true,
      search: `${muted ? "unmute un-mute" : "mute"} ${ch.slug} channel ${ch.underlying} soft off`,
      run: () => {
        dispatch({ type: "TOGGLE_MUTE", slug: ch.slug });
        persistConfig(ch.id, { muted: !muted });
      },
    });
    list.push({
      id: `boost-${ch.slug}`,
      group: "CHANNELS",
      verb: boosted ? "UN-BOOST" : "BOOST",
      rest: `${ch.slug}${boosted ? "" : " 2×"}`,
      sub: boosted ? "back to 1× size" : "risk ×2 · clears tonight",
      pm,
      needsWrite: true,
      search: `${boosted ? "unboost un-boost" : "boost"} ${ch.slug} channel ${ch.underlying} 2x risk size`,
      run: () => {
        dispatch({ type: "SET_CONFIG", slug: ch.slug, patch: { boosted: !boosted } });
        persistConfig(ch.id, { boosted: !boosted });
      },
    });
    list.push({
      id: `goto-${ch.slug}`,
      group: "CHANNELS",
      verb: "GOTO",
      rest: ch.slug,
      sub: "open in the rack",
      pm,
      search: `goto ${ch.slug} channel ${ch.underlying} rack inspector select`,
      run: () => gotoChannel(ch.slug),
    });
  }

  return list;
}
