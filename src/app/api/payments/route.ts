import { paymentRequestSchema } from "@/lib/payments/models";
import { createPaymentProposal } from "@/lib/payments/server";
import { assertLocalPaymentRequest } from "@/lib/payments/security";
import { inspectPayment, recheckPayment, replyPayment, startPayment } from "@/lib/payments/jobs";
import { earnServerContext } from "@/lib/earn/server-context";
import { EarnAccessError } from "@/lib/earn/security";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalPaymentRequest(request);
    const input = paymentRequestSchema.safeParse(await request.json());
    if (!input.success) throw new EarnAccessError("INVALID_REQUEST", "The payment request is invalid.", 400);
    const value = input.data;
    let result;
    if (value.action === "REVIEW") {
      if (!value.obligationId) throw new EarnAccessError("INVALID_REQUEST", "Select an obligation.", 400);
      result = await createPaymentProposal(value.scope, value.obligationId);
    } else {
      if (!value.proposalId) throw new EarnAccessError("INVALID_REQUEST", "Select a payment proposal.", 400);
      const context = await earnServerContext(value.scope);
      if (value.action === "CONFIRM") {
        assertLocalPaymentRequest(request, true);
        if (!value.confirmed) throw new EarnAccessError("CONFIRMATION_REQUIRED", "Separate payment confirmation is required.", 400);
        result = await startPayment(context, value.proposalId);
      } else if (value.action === "REPLY") {
        assertLocalPaymentRequest(request, true);
        if (!value.requestId || (!value.txHash && !value.userOperationHash && !value.cancelled)) throw new EarnAccessError("INVALID_REQUEST", "A valid signature reply is required.", 400);
        result = await replyPayment(context, value.proposalId, { ...value, requestId: value.requestId });
      } else result = value.action === "RECHECK" ? await recheckPayment(context, value.proposalId, value.txHash) : await inspectPayment(context, value.proposalId);
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "PAYMENT_UNAVAILABLE", message: known ? error.message : "Payment could not be verified. No automatic retry will occur. Inspect any submitted transaction before continuing." }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
