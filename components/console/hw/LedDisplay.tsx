"use client";

// Red 7-segment LED readout, inline SVG (no webfont — keeps deps minimal).
// Same "compute geometry in TS, emit SVG" idiom as Sparkline.

// Segment polygons in a 40×72 digit cell.
const SEG: Record<string, string> = {
  a: "9,4 31,4 27,8 13,8",
  b: "32,5 32,33 28,29 28,9",
  c: "32,39 32,67 28,63 28,43",
  d: "13,64 27,64 31,68 9,68",
  e: "8,39 8,67 12,63 12,43",
  f: "8,5 8,33 12,29 12,9",
  g: "9,36 13,33 27,33 31,36 27,39 13,39",
};

// Which segments light for each character.
const DIGIT: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcfgd",
  "-": "g",
  " ": "",
};

function SevenSeg({ char, color }: { char: string; color: string }) {
  const on = DIGIT[char] ?? "";
  return (
    <svg viewBox="0 0 40 72" className="seven-seg" aria-hidden>
      {Object.entries(SEG).map(([k, pts]) => {
        const lit = on.includes(k);
        return (
          <polygon
            key={k}
            points={pts}
            fill={color}
            opacity={lit ? 1 : 0.06}
            style={lit ? { filter: `drop-shadow(0 0 2.5px ${color})` } : undefined}
          />
        );
      })}
    </svg>
  );
}

export interface LedDisplayProps {
  value: string; // pre-formatted
  digits: number; // fixed width (right-aligned)
  color?: string;
  caption?: string;
}

export function LedDisplay({
  value,
  digits,
  color = "var(--led-red)",
  caption,
}: LedDisplayProps) {
  // Right-align into a fixed-width window: truncate or left-pad with blanks.
  const trimmed = value.length > digits ? value.slice(-digits) : value;
  const padded = trimmed.padStart(digits, " ");
  const chars = padded.split("");

  return (
    <div className="led">
      <div className="led-window">
        {chars.map((c, i) => (
          <SevenSeg key={i} char={c} color={color} />
        ))}
        <div className="led-glass" />
      </div>
      {caption && <div className="led-caption">{caption}</div>}
    </div>
  );
}
