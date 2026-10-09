import { isAddress } from "viem";
import { getEarnPortfolio, EarnGatewayError } from "@/lib/earn/gateway";
import { requestHostOrigin } from "@/lib/earn/access-policy";
import { hostExecutionMode } from "@/lib/earn/security";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const walletAddress = new URL(request.url).searchParams.get("address");
  if (walletAddress && !isAddress(walletAddress, { strict: false })) return Response.json({ status: "ERROR", code: "INVALID_ADDRESS", message: "Enter a valid EVM wallet address." }, { status: 400, headers });
  try {
    const portfolio = await getEarnPortfolio(walletAddress, await hostExecutionMode(requestHostOrigin(request).hostname));
    return Response.json({ status: "READY", ...portfolio, observedAt: new Date().toISOString() }, { headers });
  } catch (error) {
    const known = error instanceof EarnGatewayError;
    return Response.json({ status: "ERROR", code: known ? error.code : "EARN_UNAVAILABLE", message: known ? error.message : "Arc Earn is temporarily unavailable." }, { status: known ? error.status : 503, headers });
  }
}
