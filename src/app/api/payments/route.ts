import { paymentRequestSchema } from "@/lib/payments/models";
import { createPaymentProposal } from "@/lib/payments/server";
import { advancePayment, recoverPayment, replyPayment, startPayment } from "@/lib/payments/jobs";
import { earnServerContext } from "@/lib/earn/server-context";
import { assertRequestAccess, EarnAccessError } from "@/lib/earn/security";
import { assertLiveReady, reserveLiveUsage } from "@/lib/execution/live-readiness";
export const runtime = "nodejs";
export const maxDuration = 60;
const EXECUTION_ACTIONS = new Set(["CONFIRM", "REPLY", "RECOVER"]);
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const input = paymentRequestSchema.safeParse(body);
    // Reviews, status and receipt rechecks need same-origin JSON and a session; only
    // actions that can lead to a signature need an open execution mode.
    const mode = await assertRequestAccess(request, "PAYMENT", input.success && EXECUTION_ACTIONS.has(input.data.action));
    if (!input.success) throw new EarnAccessError("INVALID_REQUEST", "The payment request is invalid.", 400);
    const value = input.data;
    const context = await earnServerContext(value.scope);
    let result;
    if (value.action === "REVIEW") {
      if (!value.obligationId) throw new EarnAccessError("INVALID_REQUEST", "Select an obligation.", 400);
      await assertLiveReady(context, mode, "QUOTE");
      result = await createPaymentProposal(context, value.obligationId, mode);
    } else {
      if (!value.proposalId) throw new EarnAccessError("INVALID_REQUEST", "Select a payment proposal.", 400);
      if (value.action === "CONFIRM") {
        if (!value.confirmed) throw new EarnAccessError("CONFIRMATION_REQUIRED", "Separate payment confirmation is required.", 400);
        result = await startPayment(context, mode, value.proposalId);
      } else {
        await reserveLiveUsage(context.client, mode, "ADVANCE");
        if (value.action === "REPLY") {
          if (!value.requestId || (!value.txHash && !value.userOperationHash && !value.cancelled && !value.challengeApproved)) throw new EarnAccessError("INVALID_REQUEST", "A valid signature reply is required.", 400);
          result = await replyPayment(context, value.proposalId, { ...value, requestId: value.requestId });
        } else if (value.action === "RECOVER") result = await recoverPayment(context, value.proposalId, value.acknowledgeNoPendingTransaction === true);
        else result = await advancePayment(context, value.proposalId, value.action === "RECHECK" ? value.txHash : undefined, value.action === "RECHECK");
      }
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "PAYMENT_UNAVAILABLE", message: known ? error.message : "Payment could not be verified. No automatic retry will occur. Inspect any submitted transaction before continuing." }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
