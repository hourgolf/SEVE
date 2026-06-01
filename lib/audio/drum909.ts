// ============================================================================
//  Tiny synthesized TR-909 voice box — no samples, pure Web Audio. The 16-step
//  tape doubles as a playable drum machine: each pad triggers one 909 voice.
//
//  Classic synthesis recipes (oscillator pitch/amp envelopes + filtered noise),
//  kept compact. The AudioContext is created lazily on the first hit so it
//  starts inside a user gesture (browser autoplay policy), and resumed each
//  time in case the tab suspended it.
// ============================================================================

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): { ctx: AudioContext; master: GainNode; noise: AudioBuffer } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // 1s of white noise, reused by every noisy voice.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx && master && noiseBuf ? { ctx, master, noise: noiseBuf } : null;
}

function noiseSource(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const n = ctx.createBufferSource();
  n.buffer = buf;
  return n;
}

// One-shot amplitude envelope: fast attack, exponential-ish decay to silence.
function env(ctx: AudioContext, t: number, peak: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  return g;
}

type Voice = (a: { ctx: AudioContext; master: GainNode; noise: AudioBuffer }, t: number) => void;

// ---- the kit ---------------------------------------------------------------
const bd: Voice = ({ ctx, master }, t) => {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(54, t + 0.08);
  const g = env(ctx, t, 1, 0.32);
  // click transient
  const c = ctx.createOscillator();
  c.type = "triangle";
  c.frequency.setValueAtTime(1100, t);
  const cg = env(ctx, t, 0.3, 0.018);
  o.connect(g).connect(master);
  c.connect(cg).connect(master);
  o.start(t); o.stop(t + 0.34);
  c.start(t); c.stop(t + 0.03);
};

const tom = (base: number, decay: number): Voice => ({ ctx, master }, t) => {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(base, t);
  o.frequency.exponentialRampToValueAtTime(base * 0.55, t + decay * 0.9);
  const g = env(ctx, t, 0.9, decay);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + decay + 0.02);
};

const snare = (tone: number): Voice => ({ ctx, master, noise }, t) => {
  // two body oscillators
  [tone, tone * 1.6].forEach((f) => {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(f, t);
    const g = env(ctx, t, 0.4, 0.11);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.13);
  });
  // noise snap
  const n = noiseSource(ctx, noise);
  const bp = ctx.createBiquadFilter();
  bp.type = "highpass";
  bp.frequency.value = 1500;
  const g = env(ctx, t, 0.7, 0.16);
  n.connect(bp).connect(g).connect(master);
  n.start(t); n.stop(t + 0.18);
};

const hat = (decay: number): Voice => ({ ctx, master, noise }, t) => {
  const n = noiseSource(ctx, noise);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 9000;
  const g = env(ctx, t, 0.5, decay);
  n.connect(hp).connect(bp).connect(g).connect(master);
  n.start(t); n.stop(t + decay + 0.02);
};

const clap: Voice = ({ ctx, master, noise }, t) => {
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1100;
  bp.Q.value = 1.2;
  // three quick retriggers + a tail
  [0, 0.01, 0.02].forEach((dt) => {
    const n = noiseSource(ctx, noise);
    const g = env(ctx, t + dt, 0.5, 0.05);
    n.connect(bp).connect(g).connect(master);
    n.start(t + dt); n.stop(t + dt + 0.06);
  });
  const n = noiseSource(ctx, noise);
  const g = env(ctx, t + 0.02, 0.4, 0.16);
  n.connect(bp).connect(g).connect(master);
  n.start(t + 0.02); n.stop(t + 0.2);
};

const rim: Voice = ({ ctx, master }, t) => {
  const o = ctx.createOscillator();
  o.type = "square";
  o.frequency.setValueAtTime(440, t);
  const g = env(ctx, t, 0.5, 0.03);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.04);
};

const cowbell: Voice = ({ ctx, master }, t) => {
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2640;
  bp.Q.value = 1.5;
  const g = env(ctx, t, 0.5, 0.24);
  [540, 800].forEach((f) => {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(f, t);
    o.connect(bp);
    o.start(t); o.stop(t + 0.26);
  });
  bp.connect(g).connect(master);
};

const cymbal = (decay: number, hp: number): Voice => ({ ctx, master, noise }, t) => {
  const n = noiseSource(ctx, noise);
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = env(ctx, t, 0.45, decay);
  n.connect(f).connect(g).connect(master);
  n.start(t); n.stop(t + decay + 0.05);
};

const clave: Voice = ({ ctx, master }, t) => {
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(1200, t);
  const g = env(ctx, t, 0.5, 0.045);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.06);
};

// 16 pads → a playable 909-flavoured layout (kicks/snares/toms/perc/cymbals).
const KIT: Voice[] = [
  bd,                 // 1  bass drum
  snare(190),         // 2  snare
  clap,               // 3  hand clap
  rim,                // 4  rim shot
  tom(95, 0.34),      // 5  low tom
  tom(160, 0.28),     // 6  mid tom
  tom(240, 0.22),     // 7  hi tom
  cowbell,            // 8  cowbell
  hat(0.045),         // 9  closed hat
  hat(0.34),          // 10 open hat
  cymbal(1.1, 5000),  // 11 crash
  cymbal(0.5, 6500),  // 12 ride
  clave,              // 13 clave
  snare(260),         // 14 snare (hi)
  bd,                 // 15 bass drum
  hat(0.045),         // 16 closed hat
];

export const PAD_COUNT = KIT.length;

// Short 909-style silkscreen labels, index-aligned with KIT above.
export const VOICE_LABELS = [
  "BD", "SD", "CP", "RS", "LT", "MT", "HT", "CB",
  "CH", "OH", "CC", "RC", "CL", "SD", "BD", "CH",
];

// Full names for tooltips / accessibility, index-aligned with KIT.
export const VOICE_NAMES = [
  "Bass Drum", "Snare", "Clap", "Rim Shot", "Low Tom", "Mid Tom", "Hi Tom", "Cowbell",
  "Closed Hat", "Open Hat", "Crash", "Ride", "Clave", "Snare", "Bass Drum", "Closed Hat",
];

/** Trigger the 909 voice mapped to pad `index` (0-based). No-op server-side. */
export function play909(index: number): void {
  const a = audio();
  if (!a) return;
  const voice = KIT[((index % KIT.length) + KIT.length) % KIT.length];
  try {
    voice(a, a.ctx.currentTime);
  } catch {
    /* a transient OscillatorNode/buffer hiccup shouldn't break the UI */
  }
}
