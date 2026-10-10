import { z } from "zod";
import { earnServerContext } from "@/lib/earn/server-context";
import { assertRequestAccess, EarnAccessError } from "@/lib/earn/security";
import { reserveLiveUsage } from "@/lib/execution/live-readiness";
import { gatewayMoveStatus, quoteGatewayMove, submitGatewayMove } from "@/lib/gateway/moves";
import { advanceGatewayPayment, confirmGatewayPayment, recoverGatewayPayment, reviewGatewayPayment, signGatewayPayment } from "@/lib/gateway/payments";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
const signature = z.string().regex(/^0x[\da-fA-F]{130}$/).transform((value) => value as `0x${string}`);
const scope = z.enum(["TREASURY", "SMOKE_TEST"]).default("TREASURY");
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("MOVE_QUOTE"), scope, sourceKey: z.string().max(64), amountMinor: z.string().regex(/^\d{1,15}$/) }).strict(),
  z.object({ action: z.literal("MOVE_SUBMIT"), scope, handle: z.string().max(8_000), intent: z.unknown(), signature }).strict(),
  z.object({ action: z.literal("MOVE_STATUS"), scope, handle: z.string().max(8_000) }).strict(),
  z.object({ action: z.literal("PAY_REVIEW"), scope, obligationId: z.string().max(128), sourceKey: z.string().max(64) }).strict(),
  z.object({ action: z.literal("PAY_CONFIRM"), scope, proposalId: z.string().uuid(), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("PAY_SIGN"), scope, proposalId: z.string().uuid(), requestId: z.string().uuid(), signature: signature.optional(), rejected: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal("PAY_STATUS"), scope, proposalId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("PAY_RECOVER"), scope, proposalId: z.string().uuid() }).strict(),
]);
// Only these can lead to a signature or a submission; the rest are reviews and status reads.
const EXECUTION = new Set(["MOVE_SUBMIT", "PAY_CONFIRM", "PAY_SIGN"]);

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    const action = parsed.success ? parsed.data.action : "";
    const mode = await assertRequestAccess(request, action.startsWith("PAY_") ? "PAYMENT" : "EARN", EXECUTION.has(action));
    if (!parsed.success) throw new EarnAccessError("INVALID_REQUEST", "The cross-chain request is invalid.", 400);
    const input = parsed.data;
    const context = await earnServerContext(input.scope);
    let result: unknown;
    switch (input.action) {
      case "MOVE_QUOTE": result = await quoteGatewayMove(context, mode, input.sourceKey, BigInt(input.amountMinor)); break;
      case "MOVE_SUBMIT": result = await submitGatewayMove(context, mode, input.handle, input.intent, input.signature); break;
      case "MOVE_STATUS": await reserveLiveUsage(context.client, mode, "ADVANCE"); result = await gatewayMoveStatus(context, input.handle); break;
      case "PAY_REVIEW": result = await reviewGatewayPayment(context, mode, input.obligationId, input.sourceKey); break;
      case "PAY_CONFIRM": result = await confirmGatewayPayment(context, mode, input.proposalId); break;
      case "PAY_SIGN":
        if (Boolean(input.signature) === Boolean(input.rejected)) throw new EarnAccessError("INVALID_REQUEST", "Send either a signature or a rejection.", 400);
        await reserveLiveUsage(context.client, mode, "ADVANCE");
        result = await signGatewayPayment(context, input.proposalId, input.requestId, input.signature ?? null); break;
      case "PAY_STATUS": await reserveLiveUsage(context.client, mode, "ADVANCE"); result = await advanceGatewayPayment(context, input.proposalId); break;
      case "PAY_RECOVER": await reserveLiveUsage(context.client, mode, "ADVANCE"); result = await recoverGatewayPayment(context, input.proposalId); break;
    }
    return Response.json(result, { headers });
  } catch (error) {
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "GATEWAY_UNAVAILABLE", message: known ? error.message : "The cross-chain request could not be completed. Nothing new was sent; check the status before trying again." }, { status: known ? error.status : 503, headers });
  }
}
