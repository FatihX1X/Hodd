import type { RunStatus } from "./models";
export type StepState = "PREPARED" | "SUBMITTING" | "SUBMITTED" | "VERIFIED" | "FAILED" | "UNKNOWN";
/** A submission fence is irreversible without receipt evidence. UNKNOWN is never resubmitted. */
export function stepAction(state: StepState): "SUBMIT" | "RECHECK" | "DONE" {
  return state === "PREPARED" ? "SUBMIT" : state === "VERIFIED" || state === "FAILED" ? "DONE" : "RECHECK";
}
export function recoveredRunStatus(previous: RunStatus, verified: boolean, reverted: boolean): RunStatus {
  if (verified) return previous === "UNKNOWN" ? "PARTIAL" : "COMPLETED";
  if (reverted) return "FAILED";
  return "UNKNOWN";
}
