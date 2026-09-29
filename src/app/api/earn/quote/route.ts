import { createEarnQuote, EarnGatewayError } from "@/lib/earn/gateway";
import { earnQuoteRequestSchema } from "@/lib/earn/models";
import { EarnAccessError, assertLocalEarnExecution } from "@/lib/earn/security";

const headers = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  try {
    assertLocalEarnExecution(request);
    const parsed = earnQuoteRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ status: "ERROR", code: "INVALID_QUOTE_REQUEST", message: "The Earn quote request failed validation." }, { status: 400, headers });
    const quote = await createEarnQuote(parsed.data);
    return Response.json({ status: "READY", quote }, { headers });
  } catch (error) {
    const known = error instanceof EarnGatewayError || error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "QUOTE_UNAVAILABLE", message: known ? error.message : "A fresh Earn quote could not be prepared." }, { status: known ? error.status : 503, headers });
  }
}

