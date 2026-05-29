"use client";

export interface TransportButtonProps {
  label: string;
  variant?: "start" | "stop" | "default";
  active?: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function TransportButton({
  label,
  variant = "default",
  active = false,
  onPress,
  disabled,
}: TransportButtonProps) {
  return (
    <button
      type="button"
      className={`xport xport-${variant}${active ? " active" : ""}`}
      onClick={onPress}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
