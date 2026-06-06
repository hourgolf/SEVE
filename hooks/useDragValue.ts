"use client";

import { useCallback, useRef, useState } from "react";

export interface UseDragValueOpts {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Fires once on pointer release — the natural "commit/write" boundary. */
  onCommit?: (v: number) => void;
  /** Vertical pixels of drag for the full min→max sweep. */
  pixelsForFullRange?: number;
  disabled?: boolean;
  /** For aria-valuetext, so screen readers announce a meaningful value. */
  format?: (v: number) => string;
}

type Anchor = { y: number; value: number; shift: boolean };

/**
 * Powers a draggable rotary knob / fader with no library. Vertical drag maps to
 * value; the value is computed absolutely from a pointerdown anchor (never
 * accumulated) to avoid float drift and async-state fights. Shift = fine mode.
 * Full keyboard + aria support. Uses pointer capture so fast drags don't break.
 */
export function useDragValue(opts: UseDragValueOpts) {
  const {
    value,
    min,
    max,
    step,
    onChange,
    onCommit,
    pixelsForFullRange = 200,
    disabled,
    format,
  } = opts;

  const [dragging, setDragging] = useState(false);
  const anchor = useRef<Anchor | null>(null);
  // Live value within an event stream (before React re-renders).
  const latest = useRef(value);
  latest.current = value;

  // Touch (coarse pointer) needs MORE travel per sweep — a finger is far less precise
  // than a mouse, so the same px/value sensitivity feels twitchy. ~45% longer drag for
  // the full range makes landing a value far easier on a phone.
  const fullRange = useRef(pixelsForFullRange);
  fullRange.current =
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
      ? Math.round(pixelsForFullRange * 1.45)
      : pixelsForFullRange;

  const clampSnap = useCallback(
    (v: number) => {
      const snapped = min + Math.round((v - min) / step) * step;
      return Math.min(max, Math.max(min, snapped));
    },
    [min, max, step]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      anchor.current = { y: e.clientY, value: latest.current, shift: e.shiftKey };
      setDragging(true);
    },
    [disabled]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const a = anchor.current;
      if (!a) return;
      // Re-anchor on shift toggle so sensitivity changes don't jump the value.
      if (e.shiftKey !== a.shift) {
        a.y = e.clientY;
        a.value = latest.current;
        a.shift = e.shiftKey;
      }
      const fine = e.shiftKey ? 6 : 1;
      const deltaPx = a.y - e.clientY; // up = increase
      const next = clampSnap(
        a.value + (deltaPx / (fullRange.current * fine)) * (max - min)
      );
      if (next !== latest.current) {
        latest.current = next;
        onChange(next);
      }
    },
    [clampSnap, pixelsForFullRange, max, min, onChange]
  );

  const end = useCallback(() => {
    if (!anchor.current) return;
    anchor.current = null;
    setDragging(false);
    onCommit?.(latest.current);
  }, [onCommit]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      const big = step * 10;
      const base = latest.current; // burst-safe: accumulate across rapid keys
      let n: number | undefined;
      switch (e.key) {
        case "ArrowUp":
        case "ArrowRight":
          n = base + step;
          break;
        case "ArrowDown":
        case "ArrowLeft":
          n = base - step;
          break;
        case "PageUp":
          n = base + big;
          break;
        case "PageDown":
          n = base - big;
          break;
        case "Home":
          n = min;
          break;
        case "End":
          n = max;
          break;
        default:
          return;
      }
      e.preventDefault();
      const v = clampSnap(n);
      latest.current = v;
      onChange(v);
      onCommit?.(v);
    },
    [disabled, step, value, min, max, clampSnap, onChange, onCommit]
  );

  return {
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown,
    },
    aria: {
      role: "slider" as const,
      tabIndex: disabled ? -1 : 0,
      "aria-valuemin": min,
      "aria-valuemax": max,
      "aria-valuenow": value,
      "aria-valuetext": format ? format(value) : String(value),
      "aria-disabled": disabled || undefined,
    },
  };
}
