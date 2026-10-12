/** Shared, fail-closed definition for API status and deterministic assessments. */
export function autopilotIsActive(status: { mandate?: { enabled?: boolean; paused?: boolean } | null; returnRequested?: boolean } | null | undefined): boolean {
  return status?.mandate?.enabled === true && status.mandate.paused === false && status.returnRequested === false;
}
