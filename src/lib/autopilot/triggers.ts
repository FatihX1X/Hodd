import { effectiveProtectionLeadDays } from "@/lib/treasury/engine";
import type { TreasuryPolicy, TreasuryWorkspace } from "@/lib/treasury/models";

/*
 * When the scheduler starts an Autopilot run on its own. The scheduler ticks hourly; a run starts only when one of
 * these is true, so the agent acts every six hours and reacts within the hour to the owner's policy changes and to
 * bills entering their protection window, their payment day (when the vault pays approved bills) or falling due.
 */
export type RunTrigger = "MANUAL" | "FIRST_RUN" | "SCHEDULE" | "POLICY_CHANGED" | "BILL_PROTECTION" | "BILL_PAY" | "BILL_DUE";

export const AUTOPILOT_INTERVAL_MS = 6 * 3_600_000;
/** Never two runs closer than this, whatever the reason. */
export const AUTOPILOT_MIN_GAP_MS = 5 * 60_000;
const DAY = 86_400_000;
/** The vault pays an approved bill from this long before it falls due (vault-decision's VAULT_PAY_WINDOW_MS). */
const PAY_WINDOW = DAY;

/** JSON with sorted keys, so two equal policies always compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function scheduledTrigger(input: { now: Date; lastRunAt: Date | null; lastPolicy: TreasuryPolicy | null; workspace: TreasuryWorkspace }): RunTrigger | null {
  const { now, lastRunAt, lastPolicy, workspace } = input;
  if (!lastRunAt) return "FIRST_RUN";
  const since = lastRunAt.getTime(), at = now.getTime();
  if (at - since < AUTOPILOT_MIN_GAP_MS) return null;
  if (lastPolicy && canonical(lastPolicy) !== canonical(workspace.policy)) return "POLICY_CHANGED";
  const lead = effectiveProtectionLeadDays(workspace.policy, { autopilotActive: true }) * DAY;
  const open = workspace.obligations.filter((item) => item.status === "UPCOMING" || item.status === "OVERDUE");
  // A boundary crossed since the last run: the due date itself, or the start of the bill's protection window.
  if (open.some((item) => { const due = Date.parse(item.dueAt); return since < due && due <= at; })) return "BILL_DUE";
  if (open.some((item) => { const start = Date.parse(item.dueAt) - PAY_WINDOW; return since < start && start <= at; })) return "BILL_PAY";
  if (open.some((item) => { const start = Date.parse(item.dueAt) - lead; return since < start && start <= at; })) return "BILL_PROTECTION";
  if (at - since >= AUTOPILOT_INTERVAL_MS) return "SCHEDULE";
  return null;
}

export const triggerLabels: Record<RunTrigger, string> = {
  MANUAL: "Started by you",
  FIRST_RUN: "First scheduled run",
  SCHEDULE: "Six-hour check",
  POLICY_CHANGED: "Your policy changed",
  BILL_PROTECTION: "A bill entered its protection window",
  BILL_PAY: "A bill's payment day started",
  BILL_DUE: "A bill fell due",
};
