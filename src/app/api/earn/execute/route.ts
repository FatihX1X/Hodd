import { earnExecuteRequestSchema } from "@/lib/earn/models";
import { earnServerContext } from "@/lib/earn/server-context";
import { startEarnJob } from "@/lib/earn/jobs";
import { assertLocalEarnExecution, EarnAccessError } from "@/lib/earn/security";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalEarnExecution(request);
    const input = earnExecuteRequestSchema.safeParse(await request.json());
    if (!input.success) throw new EarnAccessError("INVALID_REQUEST", "The confirmation request is invalid.", 400);
    return Response.json(await startEarnJob(await earnServerContext(input.data.workspaceScope), input.data.quoteId, input.data.warningsAcknowledged), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "EXECUTION_UNAVAILABLE", message: known ? error.message : "Execution could not be started. Do not retry an uncertain submission automatically." }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
