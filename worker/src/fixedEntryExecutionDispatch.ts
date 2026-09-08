import { fixedEntryOwnershipPresent, fixedEntryPolicyPresent } from "../../lib/channels/fixedEntryOwnership.js";
import type { ExecCtx } from "./execute.js";
import type { ShadowDecision } from "./decide.js";
import type { ChannelConfig, PositionRow } from "./store.js";
export { fixedEntryOwnershipPresent };
export function fixedEntryRequested(ch: ChannelConfig, ctx: ExecCtx): boolean {
  return Object.prototype.hasOwnProperty.call(ch, "fixedContractAdmission")
    && ch.fixedContractAdmission !== undefined || fixedEntryPolicyPresent(ctx.configurationWriteStamp?.entry_policy);
}
export interface FixedEntryExecutionDriver {
  enter(d: ShadowDecision, ch: ChannelConfig, spotClose: number, ctx: ExecCtx): Promise<void>;
  exit(d: ShadowDecision, row: PositionRow, ctx: ExecCtx): Promise<void>;
  reconcile(row: PositionRow, ctx: ExecCtx): Promise<void>;
}
let driver: FixedEntryExecutionDriver | null = null;
/** Boot installs one implementation. Hot swapping ownership is prohibited. */
export function installFixedEntryExecutionDriver(value: FixedEntryExecutionDriver): void {
  if (driver) throw new Error("fixed_execution:driver_already_installed");
  if (!value || [value.enter, value.exit, value.reconcile].some(fn => typeof fn !== "function")) throw new Error("fixed_execution:driver_invalid");
  driver = Object.freeze({ enter: value.enter.bind(value), exit: value.exit.bind(value), reconcile: value.reconcile.bind(value) });
}
export function fixedEntryExecutionDriver(): FixedEntryExecutionDriver {
  if (!driver) throw new Error("fixed_execution:durable_driver_unavailable");
  return driver;
}
