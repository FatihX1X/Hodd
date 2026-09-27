import { ViemArcTreasuryReader } from "@/lib/arc/reader";
import { ArcReadError } from "@/lib/arc/reader-core";
import { walletAddressInputSchema } from "@/lib/arc/schemas";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const addressResult = walletAddressInputSchema.safeParse(new URL(request.url).searchParams.get("address"));
  if (!addressResult.success) {
    return Response.json({ status: "ERROR", code: "INVALID_ADDRESS", message: "Enter a valid EVM wallet address." }, { status: 400, headers: noStoreHeaders });
  }
  try {
    const snapshot = await new ViemArcTreasuryReader().readSnapshot(addressResult.data);
    return Response.json({ status: "READY", snapshot }, { headers: noStoreHeaders });
  } catch (error) {
    const code = error instanceof ArcReadError ? error.code : "INVALID_RESPONSE";
    const message = error instanceof ArcReadError ? error.message : "The Arc Testnet response could not be verified.";
    const status = code === "INVALID_ADDRESS" ? 400 : code === "WRONG_CHAIN" || code === "INVALID_USDC" ? 502 : 503;
    return Response.json({ status: "ERROR", code, message }, { status, headers: noStoreHeaders });
  }
}
