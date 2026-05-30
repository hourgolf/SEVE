// Pure inline-SVG line/area chart body (no panel chrome). Optional VWAP overlay.
// Reused by the Monitor's intraday chart and the Desk's equity curve.

const VIEW_W = 600;

export interface Overlay {
  values: number[];
  color: string;
  dash?: boolean;
}

export function LineChart({
  values,
  vwap,
  overlays = [],
  height = 150,
  id = "line",
}: {
  values: number[];
  vwap?: number[];
  overlays?: Overlay[];
  height?: number;
  id?: string;
}) {
  const H = height;
  const P = 6;
  if (values.length < 2) {
    return (
      <svg
        className="chart-svg"
        style={{ height }}
        viewBox={`0 0 ${VIEW_W} ${H}`}
        preserveAspectRatio="none"
      />
    );
  }
  const vw = vwap?.filter((v): v is number => v != null) ?? [];
  const ovVals = overlays.flatMap((o) => o.values).filter((v): v is number => v != null);
  const extent = values.concat(vw, ovVals);
  const min = Math.min(...extent);
  const max = Math.max(...extent);
  const N = values.length;
  const x = (i: number) => P + (i * (VIEW_W - 2 * P)) / (N - 1);
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);

  let d = `M ${x(0)} ${y(values[0])}`;
  for (let i = 1; i < N; i++) d += ` L ${x(i)} ${y(values[i])}`;

  const up = values[N - 1] >= values[0];
  const c = up ? "#2fd573" : "#f0563f";
  const gid = `fill-${id}`;

  let vwapD = "";
  if (vwap && vwap.length === N) {
    vwapD = `M ${x(0)} ${y(vwap[0])}`;
    for (let i = 1; i < N; i++) vwapD += ` L ${x(i)} ${y(vwap[i])}`;
  }

  const pathOf = (vals: number[]) => {
    if (vals.length !== N) return "";
    let p = `M ${x(0)} ${y(vals[0])}`;
    for (let i = 1; i < N; i++) p += ` L ${x(i)} ${y(vals[i])}`;
    return p;
  };

  return (
    <svg
      className="chart-svg"
      style={{ height }}
      viewBox={`0 0 ${VIEW_W} ${H}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.25" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${x(N - 1)} ${H} L ${x(0)} ${H} Z`} fill={`url(#${gid})`} />
      {vwapD && (
        <path
          d={vwapD}
          fill="none"
          stroke="#ffb224"
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.7}
        />
      )}
      {overlays.map((o, k) => (
        <path
          key={k}
          d={pathOf(o.values)}
          fill="none"
          stroke={o.color}
          strokeWidth={1.4}
          strokeDasharray={o.dash ? "4 3" : undefined}
          opacity={0.9}
        />
      ))}
      <path d={d} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={x(N - 1)} cy={y(values[N - 1])} r={3} fill={c} />
    </svg>
  );
}
