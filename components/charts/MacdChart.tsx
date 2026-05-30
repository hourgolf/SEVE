// MACD sub-panel aligned under the price chart: histogram (green/red by sign),
// MACD line (blue), signal line (amber), zero line. Pure inline SVG.

const VIEW_W = 600;

export function MacdChart({
  macd,
  signal,
  hist,
  height = 64,
}: {
  macd: number[];
  signal: number[];
  hist: number[];
  height?: number;
}) {
  const H = height;
  const P = 6;
  const N = macd.length;
  if (N < 2) {
    return (
      <svg className="chart-svg" style={{ height }} viewBox={`0 0 ${VIEW_W} ${H}`} preserveAspectRatio="none" />
    );
  }
  const m = Math.max(1e-9, ...macd.map(Math.abs), ...signal.map(Math.abs), ...hist.map(Math.abs));
  const mid = H / 2;
  const y = (v: number) => mid - (v / m) * (mid - P);
  const slot = (VIEW_W - 2 * P) / N;
  const x = (i: number) => P + i * slot + slot / 2;
  const w = Math.max(1, slot * 0.7);
  const lineOf = (arr: number[]) => {
    let p = `M ${x(0)} ${y(arr[0])}`;
    for (let i = 1; i < N; i++) p += ` L ${x(i)} ${y(arr[i])}`;
    return p;
  };
  return (
    <svg className="chart-svg" style={{ height }} viewBox={`0 0 ${VIEW_W} ${H}`} preserveAspectRatio="none">
      <line x1={0} y1={mid} x2={VIEW_W} y2={mid} stroke="#2a3a42" strokeWidth={1} />
      {hist.map((v, i) => {
        const yy = y(v);
        const h = Math.max(0.5, Math.abs(yy - mid));
        return (
          <rect
            key={i}
            x={x(i) - w / 2}
            y={Math.min(yy, mid)}
            width={w}
            height={h}
            fill={v >= 0 ? "#2fd573" : "#f0563f"}
            opacity={0.45}
          />
        );
      })}
      <path d={lineOf(macd)} fill="none" stroke="#3b9eff" strokeWidth={1.4} />
      <path d={lineOf(signal)} fill="none" stroke="#ffb224" strokeWidth={1.2} />
    </svg>
  );
}
