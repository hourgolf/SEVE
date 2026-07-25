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
  "$": "afgcd",
  "E": "afged",
  "V": "cde",
  " ": "",
};

function SevenSeg({
  char,
  color,
  dot,
}: {
  char: string;
  color: string;
  dot?: boolean;
}) {
  const glyph = char.toUpperCase();
  const on = DIGIT[glyph] ?? "";
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
      {/* decimal point — lit when this digit is immediately followed by '.' */}
      <circle
        cx="36"
        cy="66"
        r="3"
        fill={color}
        opacity={dot ? 1 : 0.06}
        style={dot ? { filter: `drop-shadow(0 0 2.5px ${color})` } : undefined}
      />
      {glyph === "$" && (
        <line
          x1="20"
          y1="1"
          x2="20"
          y2="71"
          stroke={color}
          strokeWidth="2.6"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 2.5px ${color})` }}
        />
      )}
    </svg>
  );
}

export interface LedDisplayProps {
  value: string; // pre-formatted
  digits: number; // fixed width (right-aligned)
  color?: string;
  caption?: string;
  unit?: string; // small glowing suffix (e.g. "K") for glyphs outside the limited display alphabet
}

export function LedWordmark({
  value,
  color,
  label = value,
}: {
  value: string;
  color: string;
  label?: string;
}) {
  return (
    <span className="led-wordmark" role="img" aria-label={label}>
      {Array.from(value).map((char, index) => <SevenSeg key={`${char}-${index}`} char={char} color={color} />)}
      <span className="led-glass" aria-hidden />
    </span>
  );
}

export function LedDisplay({
  value,
  digits,
  color = "var(--led-red)",
  caption,
  unit,
}: LedDisplayProps) {
  // Parse into digit cells; a '.' attaches as the decimal dot of the prior
  // cell rather than consuming a cell of its own.
  const cells: { char: string; dot: boolean }[] = [];
  for (const ch of value) {
    if (ch === "." && cells.length) cells[cells.length - 1].dot = true;
    else cells.push({ char: ch, dot: false });
  }
  while (cells.length < digits) cells.unshift({ char: " ", dot: false });
  const shown = cells.slice(-digits);

  return (
    <div className="led">
      <div className="led-window">
        {shown.map((c, i) => (
          <SevenSeg key={i} char={c.char} dot={c.dot} color={color} />
        ))}
        {unit && (
          <span className="led-unit" style={{ color }}>
            {unit}
          </span>
        )}
        <div className="led-glass" />
      </div>
      {caption && <div className="led-caption">{caption}</div>}
    </div>
  );
}
