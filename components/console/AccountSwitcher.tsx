"use client";

import type { Account } from "@/lib/desk/types";
import { LedDisplay } from "@/components/console/hw/LedDisplay";

// The account selector — segmented control in the chassis header (multi-account cockpit).
// With one account it's a static label (paper-main · PAPER); the moment a second account
// exists it becomes a real selector and the desk scopes its roster to the choice. A 'live'
// account is flagged distinctly (the red-money guardrail starts here).
export function AccountSwitcher({
  accounts, selected, onSelect,
}: {
  accounts: Account[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (accounts.length === 0) return null;
  // Single account → a non-interactive numbered badge. Account names remain in
  // the accessible label/title while the workstation face uses the compact
  // 1/2/3 bank shared with desktop telemetry.
  if (accounts.length === 1) {
    const a = accounts[0];
    return (
      <span className={`acct-badge acct-${a.mode}`} title={`account: ${a.name} (${a.mode})`}>
        <span className="acct-dot" /><LedDisplay value="1" digits={1} color="currentColor" /><span className="acct-mode">{a.mode === "live" ? "LIVE $" : "PAPER"}</span>
      </span>
    );
  }
  return (
    <span className="acct-switch" role="group" aria-label="account">
      {accounts.map((a, index) => (
        <button
          key={a.id}
          type="button"
          className={`acct-opt acct-${a.mode}${selected === a.id ? " on" : ""}`}
          onClick={() => onSelect(a.id)}
          aria-pressed={selected === a.id}
          aria-label={`Account ${index + 1}: ${a.name} (${a.mode})`}
          title={`${a.name} (${a.mode})`}
        >
          <LedDisplay value={String(index + 1)} digits={1} color="currentColor" />{a.mode === "live" && <span className="acct-live-tag">$</span>}
        </button>
      ))}
    </span>
  );
}
