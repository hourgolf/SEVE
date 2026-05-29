import type { UnderlyingBar } from "@/lib/types";

// Inline SVG sparkline of the last ~60 minute closes. No chart library —
// the path math mirrors the reference HTML's drawSpark().
const W = 600;
const H = 90;
const P = 6;

export function Sparkline({ bars }: { bars: UnderlyingBar[] }) {
  const xs = bars
    .map((b) => (b.close == null ? null : Number(b.close)))
    .filter((v): v is number => v != null);

  let body: React.ReactNode = null;
  if (xs.length >= 2) {
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const N = xs.length;
    const x = (i: number) => P + (i * (W - 2 * P)) / (N - 1);
    const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);

    let d = `M ${x(0)} ${y(xs[0])}`;
    for (let i = 1; i < N; i++) d += ` L ${x(i)} ${y(xs[i])}`;

    const up = xs[N - 1] >= xs[0];
    const c = up ? "#2fd573" : "#f0563f";

    body = (
      <>
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity="0.25" />
            <stop offset="100%" stopColor={c} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L ${x(N - 1)} ${H} L ${x(0)} ${H} Z`} fill="url(#spark-fill)" />
        <path d={d} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(N - 1)} cy={y(xs[N - 1])} r={3} fill={c} />
      </>
    );
  }

  const meta = xs.length ? `${xs.length} bars` : "—";

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">SPY — Intraday (1-min closes)</span>
        <span className="x">{meta}</span>
      </div>
      <div className="pbody">
        <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {body}
        </svg>
      </div>
    </div>
  );
}
