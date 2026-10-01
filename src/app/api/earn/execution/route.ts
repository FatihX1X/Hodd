import { z } from "zod";
import { earnServerContext } from "@/lib/earn/server-context";
import { inspectEarnJob, replyToEarnJob } from "@/lib/earn/jobs";
import { assertLocalEarnExecution, EarnAccessError } from "@/lib/earn/security";
const schema = z.object({ workspaceScope: z.enum(["TREASURY", "SMOKE_TEST"]).default("TREASURY"), executionId: z.string().uuid(), requestId: z.string().uuid().optional(), txHash: z.string().regex(/^0x[\da-fA-F]{64}$/).optional(), userOperationHash: z.string().regex(/^0x[\da-fA-F]{64}$/).optional(), cancelled: z.boolean().optional(), uncertain: z.boolean().optional() }).strict();
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalEarnExecution(request);
    const input = schema.safeParse(await request.json());
    if (!input.success) throw new EarnAccessError("INVALID_REQUEST", "The execution status request is invalid.", 400);
    const context = await earnServerContext(input.data.workspaceScope);
    if (input.data.requestId) await replyToEarnJob(context, input.data.executionId, { ...input.data, requestId: input.data.requestId });
    return Response.json(inspectEarnJob(context, input.data.executionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "EXECUTION_STATUS_UNAVAILABLE", message: known ? error.message : "Execution status is unavailable. Inspect the explorer; do not resubmit automatically." }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
