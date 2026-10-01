import { earnQuoteRequestSchema } from "@/lib/earn/models";
import { earnServerContext } from "@/lib/earn/server-context";
import { prepareServerQuote } from "@/lib/earn/server-quotes";
import { assertLocalEarnExecution, EarnAccessError } from "@/lib/earn/security";
import { EarnGatewayError } from "@/lib/earn/gateway";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalEarnExecution(request);
    const input = earnQuoteRequestSchema.safeParse(await request.json());
    if (!input.success) return Response.json({ status: "ERROR", code: "INVALID_REQUEST", message: "The quote request is invalid." }, { status: 400 });
    const quote = await prepareServerQuote(await earnServerContext(input.data.workspaceScope), input.data);
    return Response.json({ status: "READY", quote }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof EarnAccessError || error instanceof EarnGatewayError;
    return Response.json({ status: "ERROR", code: known ? error.code : "QUOTE_UNAVAILABLE", message: known ? error.message : "A verified quote could not be prepared. No transaction was submitted." }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
