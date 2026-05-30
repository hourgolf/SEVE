// Pure inline-SVG candlestick body (no panel chrome). OHLC candles from
// underlying_bars; green up (close ≥ open), red down.

const VIEW_W = 600;

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
}

export function CandleChart({
  bars,
  vwap,
  height = 150,
}: {
  bars: Candle[];
  vwap?: number[];
  height?: number;
}) {
  const H = height;
  const P = 6;
  if (bars.length < 1) {
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
  const lows = bars.map((b) => b.low);
  const highs = bars.map((b) => b.high);
  const min = Math.min(...lows, ...(vw.length ? vw : []));
  const max = Math.max(...highs, ...(vw.length ? vw : []));
  const N = bars.length;
  const slot = (VIEW_W - 2 * P) / N;
  const cx = (i: number) => P + i * slot + slot / 2;
  const bodyW = Math.max(1.5, Math.min(slot * 0.62, 14));
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);

  let vwapD = "";
  if (vwap && vwap.length === N) {
    vwapD = `M ${cx(0)} ${y(vwap[0])}`;
    for (let i = 1; i < N; i++) vwapD += ` L ${cx(i)} ${y(vwap[i])}`;
  }

  return (
    <svg
      className="chart-svg"
      style={{ height }}
      viewBox={`0 0 ${VIEW_W} ${H}`}
      preserveAspectRatio="none"
    >
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
      {bars.map((b, i) => {
        const up = b.close >= b.open;
        const c = up ? "#2fd573" : "#f0563f";
        const x = cx(i);
        const yHigh = y(b.high);
        const yLow = y(b.low);
        const yo = y(b.open);
        const ycl = y(b.close);
        const top = Math.min(yo, ycl);
        const h = Math.max(1, Math.abs(yo - ycl));
        return (
          <g key={i}>
            <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={c} strokeWidth={1} />
            <rect
              x={x - bodyW / 2}
              y={top}
              width={bodyW}
              height={h}
              fill={c}
              opacity={up ? 0.9 : 1}
            />
          </g>
        );
      })}
    </svg>
  );
}
