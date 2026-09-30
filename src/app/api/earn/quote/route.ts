export async function POST() {
  return Response.json({ status: "ERROR", code: "SIGNER_EXECUTION_DISABLED", message: "User-owned Earn execution is currently paused." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
