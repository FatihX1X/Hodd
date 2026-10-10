import { walletAddressInputSchema } from "@/lib/arc/schemas";
import { readUnifiedUsdc } from "@/lib/gateway/balances";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, max-age=0" };

/** Public, read-only: USDC for one address in its wallet and in Circle Gateway on every supported testnet. */
export async function GET(request: Request) {
  const address = walletAddressInputSchema.safeParse(new URL(request.url).searchParams.get("address"));
  if (!address.success) return Response.json({ status: "ERROR", code: "INVALID_ADDRESS", message: "Enter a valid EVM wallet address." }, { status: 400, headers });
  try { return Response.json({ status: "READY", view: await readUnifiedUsdc(address.data) }, { headers }); }
  catch { return Response.json({ status: "ERROR", code: "UNIFIED_BALANCE_UNAVAILABLE", message: "Cross-chain balances could not be read right now." }, { status: 503, headers }); }
}
