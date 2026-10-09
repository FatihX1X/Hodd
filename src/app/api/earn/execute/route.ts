import { earnExecuteRequestSchema } from "@/lib/earn/models";
import { earnServerContext } from "@/lib/earn/server-context";
import { startEarnExecution } from "@/lib/earn/executions";
import { assertRequestAccess, EarnAccessError } from "@/lib/earn/security";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const mode = await assertRequestAccess(request, "EARN", true);
    const input = earnExecuteRequestSchema.safeParse(await request.json());
    if (!input.success) throw new EarnAccessError("INVALID_REQUEST", "The confirmation request is invalid.", 400);
    return Response.json(await startEarnExecution(await earnServerContext(input.data.workspaceScope), mode, input.data.quoteId, input.data.warningsAcknowledged), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "EXECUTION_UNAVAILABLE", message: known ? error.message : "Execution could not be started. Do not retry an uncertain submission automatically." }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
