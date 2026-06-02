import type { PmColor } from "./types";

// The full ordered channel-accent palette — 12 LED/909-appropriate hues. The first
// four are the originals (existing channels keep their colors); new channels cycle
// through the rest. Each token has a matching `--pm-<token>` CSS var AND a
// `.pm-<token>` class in app/console.css — keep all three lists in sync.
export const PM_COLORS: PmColor[] = [
  "green", "blue", "amber", "cyan",
  "red", "orange", "yellow", "lime", "teal", "indigo", "violet", "magenta",
];

export const PM_SET = new Set<string>(PM_COLORS);

// PmColor token → its CSS accent var (e.g. "green" → "var(--pm-green)").
export const pmVar = (c: PmColor): string => `var(--pm-${c})`;
