import { Blockchain } from "@circle-fin/user-controlled-wallets";
import { boundUserToken, circleUserWalletClient } from "@/lib/circle/user-wallet-server";
import { requireSupabaseUser } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireSupabaseUser();
  if (auth.status !== "READY") return Response.json({ status: "ERROR", code: auth.status, message: "Sign in before reading embedded wallets." }, { status: 401 });
  const client = circleUserWalletClient(); const userToken = await boundUserToken(auth.userId);
  if (!client || !userToken) return Response.json({ status: "ERROR", code: "SESSION_REQUIRED", message: "Refresh the embedded wallet session." }, { status: 401 });
  try {
    const response = await client.listWallets({ userToken, blockchain: Blockchain.ArcTestnet });
    const wallets = (response.data?.wallets ?? []).map((wallet) => ({ id: wallet.id, address: wallet.address, blockchain: wallet.blockchain, accountType: wallet.accountType }));
    return Response.json({ status: "READY", wallets }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ status: "ERROR", code: "WALLET_LIST_FAILED", message: "Circle wallets could not be loaded." }, { status: 502 }); }
}
