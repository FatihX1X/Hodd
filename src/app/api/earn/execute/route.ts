import { executeEarnQuote, EarnGatewayError } from "@/lib/earn/gateway";
import { earnExecuteRequestSchema } from "@/lib/earn/models";
import { EarnAccessError, assertLocalEarnExecution } from "@/lib/earn/security";

const headers = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  try {
    assertLocalEarnExecution(request);
    const parsed = earnExecuteRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ status: "ERROR", code: "INVALID_EXECUTION_REQUEST", message: "Explicit confirmation and a valid quote are required." }, { status: 400, headers });
    const result = await executeEarnQuote(parsed.data.quoteId, parsed.data.warningsAcknowledged);
    return Response.json({ status: "READY", result }, { headers });
  } catch (error) {
    const known = error instanceof EarnGatewayError || error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "EXECUTION_STATUS_UNKNOWN", message: known ? error.message : "Execution status is unknown. Check the wallet and explorer before retrying." }, { status: known ? error.status : 502, headers });
  }
}

