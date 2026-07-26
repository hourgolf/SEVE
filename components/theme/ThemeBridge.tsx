"use client";

import "@/app/theme-bridge.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SEVE_THEME,
  SEVE_THEME_HASH_KEY,
  SEVE_THEME_STORAGE_KEY,
  contrastRatio,
  cssVariablesForTheme,
  decodeTheme,
  encodeTheme,
  validateSeveTheme,
  type SeveThemePayload,
  type ThemeMode,
} from "@/lib/theme/seveTheme";

const EVENT_OPEN = "seve:theme-lab";
const EVENT_CHANGED = "seve:theme-changed";

function applyTheme(theme: SeveThemePayload, mode: ThemeMode) {
  const variables = cssVariablesForTheme(theme, mode);
  const targets = [
    document.documentElement,
    ...Array.from(document.querySelectorAll<HTMLElement>(".console-root, .shell-root, .m2-app")),
  ];
  for (const target of targets) {
    for (const [name, value] of Object.entries(variables)) target.style.setProperty(name, value);
  }
  window.dispatchEvent(new CustomEvent(EVENT_CHANGED, { detail: { active: true, name: theme.name } }));
}

function clearTheme() {
  const names = Object.keys(cssVariablesForTheme(DEFAULT_SEVE_THEME, "cream"));
  const targets = [
    document.documentElement,
    ...Array.from(document.querySelectorAll<HTMLElement>(".console-root, .shell-root, .m2-app")),
  ];
  for (const target of targets) for (const name of names) target.style.removeProperty(name);
  window.dispatchEvent(new CustomEvent(EVENT_CHANGED, { detail: { active: false } }));
}

function readHashTheme(): SeveThemePayload | null {
  const raw = new URLSearchParams(window.location.hash.slice(1)).get(SEVE_THEME_HASH_KEY);
  if (!raw) return null;
  try {
    const theme = decodeTheme(raw);
    return validateSeveTheme(theme).valid ? theme : null;
  } catch {
    return null;
  }
}

function downloadTheme(theme: SeveThemePayload) {
  const blob = new Blob([`${JSON.stringify(theme, null, 2)}\n`], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = "seve-909-theme.json";
  link.click();
  URL.revokeObjectURL(href);
}

export function openThemeLab() {
  window.dispatchEvent(new CustomEvent(EVENT_OPEN));
}

export function ThemeBridge({ skin, setSkin }: { skin: ThemeMode; setSkin: (skin: ThemeMode) => void }) {
  const [theme, setTheme] = useState<SeveThemePayload | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const openLab = () => setOpen(true);
    window.addEventListener(EVENT_OPEN, openLab);
    let initial = readHashTheme();
    if (!initial) {
      try {
        const stored = localStorage.getItem(SEVE_THEME_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as SeveThemePayload;
          if (validateSeveTheme(parsed).valid) initial = parsed;
        }
      } catch { /* malformed or blocked storage: use shipped theme */ }
    }
    if (initial) {
      setTheme(initial);
      setDraft(JSON.stringify(initial, null, 2));
      if (window.location.hash.includes(`${SEVE_THEME_HASH_KEY}=`)) setOpen(true);
    } else {
      setDraft(JSON.stringify(DEFAULT_SEVE_THEME, null, 2));
    }
    return () => window.removeEventListener(EVENT_OPEN, openLab);
  }, []);

  useEffect(() => {
    if (!theme) return;
    const frame = requestAnimationFrame(() => applyTheme(theme, skin));
    return () => cancelAnimationFrame(frame);
  }, [theme, skin]);

  const validation = useMemo(() => {
    try { return validateSeveTheme(JSON.parse(draft)); }
    catch { return { valid: false, errors: ["JSON is not valid."], warnings: [] }; }
  }, [draft]);

  const contrasts = useMemo(() => {
    try {
      const candidate = JSON.parse(draft) as SeveThemePayload;
      if (!validateSeveTheme(candidate).valid) return [];
      return (["cream", "blackout"] as const).flatMap((mode) => {
        const tokens = candidate.modes[mode];
        return [
          { mode, label: "Primary / panel", ratio: contrastRatio(tokens["text/primary"], tokens["surface/panel"]) },
          { mode, label: "Muted / panel", ratio: contrastRatio(tokens["text/muted"], tokens["surface/panel"]) },
          { mode, label: "Success / panel", ratio: contrastRatio(tokens["status/success"], tokens["surface/panel"]) },
          { mode, label: "Danger / panel", ratio: contrastRatio(tokens["status/danger"], tokens["surface/panel"]) },
        ];
      });
    } catch { return []; }
  }, [draft]);

  const applyDraft = useCallback(() => {
    try {
      const candidate = JSON.parse(draft) as SeveThemePayload;
      const result = validateSeveTheme(candidate);
      if (!result.valid) {
        setMessage("Fix validation errors before applying.");
        return;
      }
      setTheme(candidate);
      localStorage.setItem(SEVE_THEME_STORAGE_KEY, JSON.stringify(candidate));
      setMessage("Draft applied locally. No deployment was created.");
    } catch {
      setMessage("The JSON could not be parsed.");
    }
  }, [draft]);

  const share = useCallback(async () => {
    try {
      const candidate = JSON.parse(draft) as SeveThemePayload;
      if (!validateSeveTheme(candidate).valid) {
        setMessage("Fix validation errors before sharing.");
        return;
      }
      const url = new URL(window.location.href);
      url.hash = new URLSearchParams({ [SEVE_THEME_HASH_KEY]: encodeTheme(candidate) }).toString();
      await navigator.clipboard.writeText(url.toString());
      setMessage("Shareable Theme Lab URL copied.");
    } catch {
      setMessage("Unable to copy the share URL.");
    }
  }, [draft]);

  const reset = useCallback(() => {
    localStorage.removeItem(SEVE_THEME_STORAGE_KEY);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    setTheme(null);
    setDraft(JSON.stringify(DEFAULT_SEVE_THEME, null, 2));
    clearTheme();
    setMessage("Returned to the shipped SEVE theme.");
  }, []);

  return <>
    {theme && <button type="button" className="theme-bridge-badge" onClick={() => setOpen(true)} title="Open Figma Theme Lab">FIGMA DRAFT</button>}
    {open && <div className="theme-lab-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="theme-lab" role="dialog" aria-modal="true" aria-label="SEVE Figma Theme Lab">
        <header>
          <div><b>SEVE 909 · THEME LAB</b><span>Color + font draft · layout metrics locked · local preview only</span></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close Theme Lab">×</button>
        </header>
        <div className="theme-lab-toolbar">
          <span className="theme-lab-segment" role="group" aria-label="Preview mode">
            <button type="button" className={skin === "cream" ? "on" : ""} onClick={() => setSkin("cream")}>CREAM</button>
            <button type="button" className={skin === "blackout" ? "on" : ""} onClick={() => setSkin("blackout")}>BLACKOUT</button>
          </span>
          <label className="theme-lab-file">IMPORT JSON<input type="file" accept="application/json,.json" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) setDraft(await file.text());
            event.target.value = "";
          }} /></label>
          <button type="button" onClick={applyDraft}>APPLY LOCALLY</button>
          <button type="button" onClick={share}>COPY REVIEW LINK</button>
          <button type="button" onClick={() => {
            try { downloadTheme(JSON.parse(draft) as SeveThemePayload); } catch { setMessage("The JSON could not be parsed."); }
          }}>DOWNLOAD</button>
          <button type="button" className="danger" onClick={reset}>RESET</button>
        </div>
        <div className="theme-lab-body">
          <div className="theme-lab-editor">
            <label htmlFor="seve-theme-json">TOKEN PAYLOAD</label>
            <textarea id="seve-theme-json" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} />
          </div>
          <aside>
            <section>
              <b>{validation.valid ? "SCHEMA READY" : "VALIDATION BLOCKED"}</b>
              {validation.errors.map((error) => <p className="bad" key={error}>× {error}</p>)}
              {validation.warnings.map((warning) => <p className="warn" key={warning}>! {warning}</p>)}
              {validation.valid && validation.warnings.length === 0 && <p className="ok">● Foundation recognized · layout remains locked</p>}
            </section>
            <section>
              <b>CONTRAST CHECK</b>
              {contrasts.map((item) => <p key={`${item.mode}-${item.label}`} className={(item.ratio ?? 0) >= 4.5 ? "ok" : "warn"}>
                <span>{item.mode} · {item.label}</span><strong>{item.ratio?.toFixed(2) ?? "—"}:1</strong>
              </p>)}
            </section>
            <section><b>STATUS</b><p>{message || "Paste an export from the Figma plugin, then apply it locally."}</p></section>
          </aside>
        </div>
      </section>
    </div>}
  </>;
}
