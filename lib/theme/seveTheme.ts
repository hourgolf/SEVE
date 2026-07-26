import bundledTheme from "@/design-tokens/seve-909.json";

export const SEVE_THEME_SCHEMA = "seve-909-theme/v1" as const;
export const SEVE_THEME_STORAGE_KEY = "seve.theme.draft.v1";
export const SEVE_THEME_HASH_KEY = "seve-theme";

export const COLOR_TOKEN_NAMES = [
  "surface/chassis", "surface/panel", "surface/inset", "surface/well",
  "line/subtle", "line/strong",
  "text/primary", "text/muted", "text/disabled",
  "status/success", "status/attention", "status/danger", "status/info", "status/neutral",
  "focus/ring", "hardware/accent",
] as const;

export type ColorTokenName = (typeof COLOR_TOKEN_NAMES)[number];
export type ThemeMode = "cream" | "blackout";
export type ThemeModeTokens = Record<ColorTokenName, string>;

export interface SeveThemePayload {
  schema: typeof SEVE_THEME_SCHEMA;
  name: string;
  source?: {
    fileKey?: string;
    collection?: string;
    creamMode?: string;
    blackoutMode?: string;
    exportedAt?: string;
  };
  modes: Record<ThemeMode, ThemeModeTokens>;
  type: Record<string, string | number>;
  space: Record<string, number>;
  radius: Record<string, number>;
}

export interface ThemeValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%+-]+\)|hsla?\([\d\s.,%+/-]+\))$/i;
const SAFE_FONT = /^[a-z0-9 _,'"-]+$/i;
const LOADED_FONTS = new Set(["IBM Plex Sans", "JetBrains Mono", "Inter", "system-ui", "sans-serif", "monospace"]);

export const DEFAULT_SEVE_THEME = bundledTheme as SeveThemePayload;

export function validateSeveTheme(value: unknown): ThemeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!value || typeof value !== "object") return { valid: false, errors: ["Theme payload must be an object."], warnings };
  const theme = value as Partial<SeveThemePayload>;
  if (theme.schema !== SEVE_THEME_SCHEMA) errors.push(`Expected schema ${SEVE_THEME_SCHEMA}.`);
  if (!theme.modes || typeof theme.modes !== "object") errors.push("Missing modes.");
  for (const mode of ["cream", "blackout"] as const) {
    const tokens = theme.modes?.[mode] as Partial<ThemeModeTokens> | undefined;
    if (!tokens) {
      errors.push(`Missing ${mode} mode.`);
      continue;
    }
    for (const name of COLOR_TOKEN_NAMES) {
      const color = tokens[name];
      if (typeof color !== "string" || !SAFE_COLOR.test(color.trim())) errors.push(`${mode}.${name} is missing or is not a supported CSS color.`);
    }
    const primaryContrast = typeof tokens["text/primary"] === "string" && typeof tokens["surface/panel"] === "string"
      ? contrastRatio(tokens["text/primary"], tokens["surface/panel"])
      : null;
    if (primaryContrast != null && primaryContrast < 4.5) errors.push(`${mode} primary text must be at least 4.5:1 against panel.`);
    const mutedContrast = typeof tokens["text/muted"] === "string" && typeof tokens["surface/panel"] === "string"
      ? contrastRatio(tokens["text/muted"], tokens["surface/panel"])
      : null;
    if (mutedContrast != null && mutedContrast < 3) warnings.push(`${mode} muted text is below 3:1 against panel.`);
  }
  const type = theme.type;
  if (!type || typeof type !== "object") errors.push("Missing typography tokens.");
  for (const key of ["family/body", "family/mono", "family/display"]) {
    const family = type?.[key];
    if (typeof family !== "string" || !SAFE_FONT.test(family)) errors.push(`type.${key} is missing or unsafe.`);
    else if (!LOADED_FONTS.has(family)) warnings.push(`${family} is not bundled in SEVE and will fall back until its web font is added.`);
  }
  for (const group of [["space", theme.space], ["radius", theme.radius]] as const) {
    if (!group[1] || typeof group[1] !== "object") errors.push(`Missing ${group[0]} tokens.`);
    else for (const [key, number] of Object.entries(group[1])) {
      if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 128) errors.push(`${group[0]}.${key} is outside the supported range.`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

function fontStack(family: string | number | undefined, fallback: string): string {
  return typeof family === "string" ? `"${family}", ${fallback}` : fallback;
}

export function cssVariablesForTheme(theme: SeveThemePayload, mode: ThemeMode): Record<string, string> {
  const t = theme.modes[mode];
  const chromeGradient = `linear-gradient(180deg, ${t["surface/panel"]}, ${t["surface/inset"]})`;
  const buttonGradient = `linear-gradient(180deg, ${t["surface/panel"]}, ${t["surface/chassis"]})`;
  const translucent = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;
  const vars: Record<string, string> = {
    "--surface-chassis": t["surface/chassis"],
    "--surface-panel": t["surface/panel"],
    "--surface-inset": t["surface/inset"],
    "--surface-well": t["surface/well"],
    "--line-subtle": t["line/subtle"],
    "--line-strong": t["line/strong"],
    "--text-primary": t["text/primary"],
    "--text-muted": t["text/muted"],
    "--text-disabled": t["text/disabled"],
    "--status-success": t["status/success"],
    "--status-attention": t["status/attention"],
    "--status-danger": t["status/danger"],
    "--status-info": t["status/info"],
    "--status-neutral": t["status/neutral"],
    "--focus-ring": t["focus/ring"],
    "--hardware-accent": t["hardware/accent"],
    "--909-surface-canvas": t["surface/chassis"],
    "--909-surface-panel": t["surface/panel"],
    "--909-surface-panel-raised": t["surface/panel"],
    "--909-surface-panel-inset": t["surface/inset"],
    "--909-text-primary": t["text/primary"],
    "--909-text-secondary": t["text/muted"],
    "--909-text-tertiary": t["text/disabled"],
    "--909-neutral-text": t["status/neutral"],
    "--909-positive-text": t["status/success"],
    "--909-positive-icon": t["status/success"],
    "--909-positive-fill": translucent(t["status/success"], 10),
    "--909-negative-text": t["status/danger"],
    "--909-warning-text": t["status/attention"],
    "--909-info-text": t["status/info"],
    "--909-border": t["line/subtle"],
    "--909-border-strong": t["line/strong"],
    "--909-focus": t["focus/ring"],
    "--909-scroll-track": t["surface/chassis"],
    "--909-scroll-track-edge": t["line/strong"],
    "--909-scroll-track-well": t["surface/inset"],
    "--909-scroll-thumb": t["text/muted"],
    "--909-scroll-thumb-hi": t["status/neutral"],
    "--909-scroll-thumb-lo": t["text/disabled"],
    "--909-control-rest-top": t["surface/panel"],
    "--909-control-rest-bottom": t["surface/chassis"],
    "--909-control-rest-text": t["text/primary"],
    "--909-control-rest-border": t["line/strong"],
    "--909-control-selected-top": t["surface/chassis"],
    "--909-control-selected-bottom": t["surface/inset"],
    "--909-control-selected-text": t["text/primary"],
    "--909-control-selected-border": t["status/attention"],
    "--909-control-selected-strike": t["status/attention"],
    "--909-control-primary-bottom": t["hardware/accent"],
    "--909-control-toggle-fill": t["status/success"],
    "--909-control-toggle-text": t["surface/panel"],
    "--909-overlay-canvas": t["surface/chassis"],
    "--909-overlay-panel": t["surface/panel"],
    "--909-overlay-inset": t["surface/inset"],
    "--909-overlay-text": t["text/primary"],
    "--909-overlay-muted": t["text/muted"],
    "--909-overlay-disabled": t["text/disabled"],
    "--909-overlay-border": t["line/subtle"],
    "--909-overlay-border-strong": t["line/strong"],
    "--909-overlay-success": t["status/success"],
    "--909-overlay-attention": t["status/attention"],
    "--909-overlay-danger": t["status/danger"],
    "--bg": t["surface/chassis"],
    "--chassis": t["surface/chassis"],
    "--chassis-2": t["surface/inset"],
    "--chassis-edge": t["line/strong"],
    "--chassis-dark": t["surface/inset"],
    "--panel": t["surface/panel"],
    "--panel-2": t["surface/inset"],
    "--panel-3": t["surface/inset"],
    "--border": t["line/subtle"],
    "--border-bright": t["line/strong"],
    "--text": t["text/primary"],
    "--ink": t["text/primary"],
    "--muted": t["text/muted"],
    "--ink-soft": t["text/muted"],
    "--muted-2": t["text/disabled"],
    "--green": t["status/success"],
    "--red": t["status/danger"],
    "--amber": t["status/attention"],
    "--blue": t["status/info"],
    "--accent": t["hardware/accent"],
    "--accent-cream": t["hardware/accent"],
    "--nav-orange": t["hardware/accent"],
    "--frame-bg": t["surface/chassis"],
    "--chrome-bg": t["surface/panel"],
    "--chrome-grad": chromeGradient,
    "--chrome-edge": t["line/strong"],
    "--chrome-ink": t["text/primary"],
    "--chrome-soft": t["text/muted"],
    "--silk": t["text/muted"],
    "--btn-bg": t["surface/panel"],
    "--btn-grad": buttonGradient,
    "--btn-ink": t["text/primary"],
    "--btn-edge": t["line/strong"],
    "--kbd-bg": t["surface/well"],
    "--kbd-edge": t["line/strong"],
    "--kbd-ink": t["text/primary"],
    "--sep": t["line/subtle"],
    "--sep-line": t["line/subtle"],
    "--hw-1": t["surface/panel"],
    "--hw-2": t["surface/inset"],
    "--hw-edge": t["line/strong"],
    "--hw-ink": t["text/primary"],
    "--hw-soft": t["text/muted"],
    "--hw-well": t["surface/well"],
    "--hw-line": t["line/subtle"],
    "--hw-green": t["status/success"],
    "--hw-red": t["status/danger"],
    "--hw-red-soft": t["status/danger"],
    "--hw-amber": t["status/attention"],
    "--neg-chrome": t["status/danger"],
    "--metal": t["surface/chassis"],
    "--metal-2": t["surface/inset"],
    "--metal-hi": t["surface/panel"],
    "--metal-edge": t["line/strong"],
    "--line": t["line/subtle"],
    "--line-2": t["line/strong"],
    "--m2-green": t["status/success"],
    "--m2-green-soft": t["status/success"],
    "--m2-red": t["status/danger"],
    "--m2-red-soft": t["status/danger"],
    "--m2-amber": t["status/attention"],
    "--m2-mut": t["text/muted"],
    "--m2-blue": t["status/info"],
    "--run-ink": t["status/success"],
    "--run-edge": translucent(t["status/success"], 55),
    "--run-bg": translucent(t["status/success"], 10),
    "--909-negative-fill": translucent(t["status/danger"], 12),
    "--fire-stop": t["status/danger"],
    "--fire-take": t["status/success"],
    "--st-pos": t["status/success"],
    "--st-neg": t["status/danger"],
    "--909-font-sans": fontStack(theme.type["family/body"], "system-ui, sans-serif"),
    "--909-font-mono": fontStack(theme.type["family/mono"], "ui-monospace, monospace"),
    "--font-body": fontStack(theme.type["family/body"], "system-ui, sans-serif"),
    "--font-mono": fontStack(theme.type["family/mono"], "ui-monospace, monospace"),
    "--font-display": fontStack(theme.type["family/display"], "system-ui, sans-serif"),
    "--sans": fontStack(theme.type["family/body"], "system-ui, sans-serif"),
    "--mono": fontStack(theme.type["family/mono"], "ui-monospace, monospace"),
    "--wordmark": fontStack(theme.type["family/display"], "system-ui, sans-serif"),
    "--sh-sans": fontStack(theme.type["family/body"], "system-ui, sans-serif"),
    "--sh-mono": fontStack(theme.type["family/mono"], "ui-monospace, monospace"),
  };
  return vars;
}

export function encodeTheme(theme: SeveThemePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(theme));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeTheme(encoded: string): SeveThemePayload {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as SeveThemePayload;
}

export function contrastRatio(foreground: string, background: string): number | null {
  const parse = (color: string): [number, number, number] | null => {
    const hex = color.match(/^#([0-9a-f]{6})$/i);
    if (hex) return [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16)) as [number, number, number];
    const rgb = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
  };
  const fg = parse(foreground);
  const bg = parse(background);
  if (!fg || !bg) return null;
  const luminance = ([r, g, b]: [number, number, number]) => {
    const channel = (n: number) => {
      const value = n / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return channel(r) * 0.2126 + channel(g) * 0.7152 + channel(b) * 0.0722;
  };
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
