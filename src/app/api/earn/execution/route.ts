import { z } from "zod";
import { earnServerContext } from "@/lib/earn/server-context";
import { advanceEarnExecution } from "@/lib/earn/executions";
import { assertRequestAccess, EarnAccessError } from "@/lib/earn/security";
import { reserveLiveUsage } from "@/lib/execution/live-readiness";

const hash = z.string().regex(/^0x[\da-fA-F]{64}$/);
const schema = z.object({ workspaceScope: z.enum(["TREASURY", "SMOKE_TEST"]).default("TREASURY"), executionId: z.string().uuid(), requestId: z.string().uuid().optional(), txHash: hash.optional(), userOperationHash: hash.optional(), challengeApproved: z.literal(true).optional(), cancelled: z.boolean().optional(), uncertain: z.boolean().optional(),
  action: z.enum(["ADVANCE", "RECOVER"]).default("ADVANCE"), candidateTxHash: hash.optional(), acknowledgeNoPendingTransaction: z.literal(true).optional() }).strict();
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const mode = await assertRequestAccess(request, "EARN", true);
    const input = schema.safeParse(await request.json());
    if (!input.success) throw new EarnAccessError("INVALID_REQUEST", "The execution status request is invalid.", 400);
    const value = input.data;
    const context = await earnServerContext(value.workspaceScope);
    await reserveLiveUsage(context.client, mode, "ADVANCE");
    const reply = value.requestId ? { requestId: value.requestId, txHash: value.txHash, userOperationHash: value.userOperationHash, challengeApproved: value.challengeApproved, cancelled: value.cancelled, uncertain: value.uncertain } : undefined;
    const recovery = value.action === "RECOVER" ? { candidateTxHash: value.candidateTxHash, acknowledgeNoPendingTransaction: value.acknowledgeNoPendingTransaction } : undefined;
    return Response.json(await advanceEarnExecution(context, mode, value.executionId, reply, recovery), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "EXECUTION_STATUS_UNAVAILABLE", message: known ? error.message : "Execution status is unavailable. Inspect the explorer; do not resubmit automatically." }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
