// ============================================================================
//  kit — the 909 KIT: synthesized drum voices as OPT-IN audible desk alerts
//  (909-redesign slice 1, mock: docs/ui-909-redesign-mockup-2026-07-02.html).
//  entry fill = BD kick · winning exit = SD snare · stop-out = RS rim ·
//  EOD/event flatten = OH hat · crash reserved for KILL (not wired yet).
//  Pure WebAudio synthesis — no samples, no deps, SSR-safe. ALERT-ONLY: this
//  module never touches the trade path; if audio fails it fails silent.
//  Off by default; the KIT pad (desktop shell / mobile OPS sheet) toggles it,
//  persisted to localStorage. Enabling counts as the user gesture that unlocks
//  the AudioContext.
// ============================================================================

export type KitVoice = "kick" | "snare" | "rim" | "hat" | "crash";

const KEY = "seve-kit";
let enabled: boolean | null = null; // lazy — read localStorage on first use
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

function load(): boolean {
  if (enabled === null) {
    try {
      enabled = typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

export function kitEnabled(): boolean {
  return load();
}

export function setKitEnabled(on: boolean): void {
  enabled = on;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode — session-only */
  }
  if (on) ac(); // resume/create on the toggle gesture
  listeners.forEach((l) => l());
}

/** Subscribe to KIT on/off changes (keeps the shell pad + sheet row in sync). */
export function onKitChange(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// percussive gain envelope → destination
function envG(c: AudioContext, t: number, peak: number, dur: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(c.destination);
  return g;
}

function noiseSrc(c: AudioContext, dur: number): AudioBufferSourceNode {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const n = c.createBufferSource();
  n.buffer = b;
  return n;
}

const VOICES: Record<KitVoice, (c: AudioContext) => void> = {
  kick(c) {
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.connect(envG(c, t, 0.85, 0.3));
    o.start(t);
    o.stop(t + 0.32);
  },
  snare(c) {
    const t = c.currentTime;
    const n = noiseSrc(c, 0.25);
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    n.connect(f);
    f.connect(envG(c, t, 0.5, 0.18));
    n.start(t);
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = 185;
    o.connect(envG(c, t, 0.35, 0.1));
    o.start(t);
    o.stop(t + 0.12);
  },
  rim(c) {
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = 1720;
    o.connect(envG(c, t, 0.22, 0.05));
    o.start(t);
    o.stop(t + 0.06);
  },
  hat(c) {
    const t = c.currentTime;
    const n = noiseSrc(c, 0.4);
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7200;
    n.connect(f);
    f.connect(envG(c, t, 0.3, 0.34));
    n.start(t);
  },
  crash(c) {
    const t = c.currentTime;
    const n = noiseSrc(c, 1.3);
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 4300;
    n.connect(f);
    f.connect(envG(c, t, 0.45, 1.2));
    n.start(t);
  },
};

/** Play a kit voice. No-op unless the KIT is enabled (pass force=true for the
 *  toggle's own audible confirmation). Never throws. */
export function playKit(v: KitVoice, force = false): void {
  if (!force && !kitEnabled()) return;
  const c = ac();
  if (!c) return;
  try {
    VOICES[v](c);
  } catch {
    /* audio is best-effort */
  }
}

/** Map a close_reason + realized P&L to the exit voice: stops/stalls = rim,
 *  EOD/event flattens = hat, everything else by sign (win = snare). */
export function voiceForClose(reason: string | null | undefined, realized: number): KitVoice {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("stop") || r.includes("stall")) return "rim";
  if (r.includes("eod") || r.includes("event")) return "hat";
  return realized >= 0 ? "snare" : "rim";
}
