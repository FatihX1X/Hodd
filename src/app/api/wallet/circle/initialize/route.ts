import { Blockchain } from "@circle-fin/user-controlled-wallets";
import { boundUserToken, circleErrorCode, circleUserWalletClient, isSameOrigin } from "@/lib/circle/user-wallet-server";
import { requireSupabaseUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ status: "ERROR", message: "Same-origin request required." }, { status: 403 });
  const auth = await requireSupabaseUser();
  if (auth.status !== "READY") return Response.json({ status: "ERROR", code: auth.status, message: "Sign in before initializing an embedded wallet." }, { status: 401 });
  const client = circleUserWalletClient(); const userToken = await boundUserToken(auth.userId);
  if (!client || !userToken) return Response.json({ status: "ERROR", code: "SESSION_REQUIRED", message: "Refresh the embedded wallet session." }, { status: 401 });
  try {
    const existing = await client.listWallets({ userToken, blockchain: Blockchain.ArcTestnet });
    if (existing.data?.wallets?.some((wallet) => wallet.accountType === "SCA")) return Response.json({ status: "EXISTS" }, { headers: { "Cache-Control": "no-store" } });
    const response = await client.createUserPinWithWallets({ userToken, blockchains: [Blockchain.ArcTestnet], accountType: "SCA" });
    const challengeId = response.data?.challengeId;
    if (!challengeId) throw new Error("Missing challenge");
    return Response.json({ status: "CHALLENGE", challengeId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (circleErrorCode(error) === 155106) return Response.json({ status: "EXISTS" }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ status: "ERROR", code: "INITIALIZATION_FAILED", message: "Circle could not initialize the Arc Testnet wallet." }, { status: 502 });
  }
}
