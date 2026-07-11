"use client";

// PERFORM room placeholder (PERFORM/STUDIO rebuild · S1). The mode switch is
// real, but the watching surface — chart hero + right rail + chicklet dock —
// lands in S2. Until then this honest dark-glass panel stands in its place.
export function PerformPlaceholder() {
  return (
    <div className="perform-stub">
      <div className="ps-mark">PERFORM</div>
      <div className="ps-sub">watching surface — slice S2</div>
      <div className="ps-sub" style={{ opacity: 0.7 }}>
        press <span className="ps-kbd">S</span> to return to STUDIO
      </div>
    </div>
  );
}
