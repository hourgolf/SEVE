// Volume strip aligned under the price chart. Bars colored by the bar's
// direction (green up / red down). Pure inline SVG.

const VIEW_W = 600;

export function VolumeBars({
  bars,
  height = 46,
}: {
  bars: { volume: number; open: number; close: number }[];
  height?: number;
}) {
  const H = height;
  const P = 4;
  if (!bars.length) {
    return (
      <svg className="chart-svg" style={{ height }} viewBox={`0 0 ${VIEW_W} ${H}`} preserveAspectRatio="none" />
    );
  }
  const maxV = Math.max(1, ...bars.map((b) => b.volume));
  const N = bars.length;
  const slot = (VIEW_W - 2 * P) / N;
  const w = Math.max(1, slot * 0.7);
  return (
    <svg className="chart-svg" style={{ height }} viewBox={`0 0 ${VIEW_W} ${H}`} preserveAspectRatio="none">
      {bars.map((b, i) => {
        const h = Math.max(0.5, (b.volume / maxV) * (H - 2));
        const x = P + i * slot + slot / 2 - w / 2;
        return (
          <rect
            key={i}
            x={x}
            y={H - h}
            width={w}
            height={h}
            fill={b.close >= b.open ? "#2fd573" : "#f0563f"}
            opacity={0.5}
          />
        );
      })}
    </svg>
  );
}
