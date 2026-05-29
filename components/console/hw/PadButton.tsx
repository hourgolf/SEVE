"use client";

export interface PadButtonProps {
  label: string;
  lit?: boolean;
  /** CSS color when lit (e.g. "var(--pm-green)"). */
  color?: string;
  onClick: () => void;
  title?: string;
}

// Square MUTE / SOLO pad. Lights in the given color when engaged.
export function PadButton({ label, lit = false, color, onClick, title }: PadButtonProps) {
  return (
    <button
      type="button"
      className={`pad${lit ? " lit" : ""}`}
      style={{ ["--pad" as string]: color ?? "var(--amber)" }}
      onClick={onClick}
      title={title}
      aria-pressed={lit}
    >
      {label}
    </button>
  );
}
