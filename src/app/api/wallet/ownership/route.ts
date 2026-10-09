import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { arcClient } from "@/lib/earn/gateway";
import { assertRequestAccess, EarnAccessError } from "@/lib/earn/security";
import { reserveLiveUsage } from "@/lib/execution/live-readiness";
import { paymentAdmin } from "@/lib/payments/admin";
import { ownershipIssuedAtValid, ownershipMessage } from "@/lib/wallet/ownership";

const schema = z.object({
  address: z.string().refine((value) => isAddress(value, { strict: false })),
  issuedAt: z.string().datetime(),
  signature: z.string().regex(/^0x[\da-fA-F]+$/).max(20_000),
  provider: z.enum(["INJECTED_METAMASK", "INJECTED_RABBY", "CIRCLE_MODULAR", "TEST_SIGNER"]),
}).strict();
const headers = { "Cache-Control": "no-store" };
export const runtime = "nodejs";

/** Records that the signed-in user controls a wallet (EOA signature or ERC-1271/6492 smart account). */
export async function POST(request: Request) {
  try {
    const mode = await assertRequestAccess(request, "EARN", false);
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new EarnAccessError("INVALID_REQUEST", "The ownership proof is invalid.", 400);
    const client = await createSupabaseServerClient();
    const { data } = client ? await client.auth.getUser() : { data: { user: null } };
    if (!client || !data.user || data.user.is_anonymous) throw new EarnAccessError("AUTH_REQUIRED", "Sign in before verifying a wallet.", 401);
    await reserveLiveUsage(client, mode, "OWNERSHIP");
    if (!ownershipIssuedAtValid(input.data.issuedAt)) throw new EarnAccessError("PROOF_EXPIRED", "The signature request expired. Sign again.", 409);
    const address = getAddress(input.data.address);
    const message = ownershipMessage(data.user.id, address, input.data.issuedAt);
    const valid = await arcClient.verifyMessage({ address, message, signature: input.data.signature as `0x${string}` }).catch(() => false);
    if (!valid) throw new EarnAccessError("PROOF_INVALID", "The signature does not match this wallet.", 403);
    const { error } = await paymentAdmin().from("wallet_ownership_proofs").upsert({ user_id: data.user.id, wallet_address: address.toLowerCase(), provider: input.data.provider, proof: { message, signature: input.data.signature }, verified_at: new Date().toISOString() });
    if (error) throw new EarnAccessError("PROOF_STORE_UNAVAILABLE", "The proof could not be saved. Try again shortly.", 503);
    return Response.json({ status: "VERIFIED", address }, { headers });
  } catch (error) {
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", code: known ? error.code : "OWNERSHIP_UNAVAILABLE", message: known ? error.message : "Wallet ownership could not be verified." }, { status: known ? error.status : 503, headers });
  }
}
