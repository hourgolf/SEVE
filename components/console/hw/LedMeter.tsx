// Vertical segmented LED "volume" meter (mixer-style): green low → amber → red,
// lit from the bottom up to the value. Pairs with a Knob on the mobile strips.
export function LedMeter({ frac, count = 9 }: { frac: number; count?: number }) {
  const N = count;
  const lit = Math.max(0, Math.min(N, Math.round(frac * N)));
  return (
    <div className="led-meter" aria-hidden>
      {Array.from({ length: N }, (_, i) => {
        const idx = N - 1 - i; // 0 = bottom segment
        const tone = idx >= N - 1 ? "hot" : idx >= N - 3 ? "warm" : "cool";
        return <span key={i} className={`lm ${tone}${idx < lit ? " on" : ""}`} />;
      })}
    </div>
  );
}
