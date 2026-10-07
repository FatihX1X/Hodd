import { z } from "zod";
import { earnServerContext } from "@/lib/earn/server-context";
import { claimTestSignerRequest } from "@/lib/earn/jobs";
import { assertLocalEarnExecution, EarnAccessError } from "@/lib/earn/security";
import { requestHostOrigin } from "@/lib/earn/access-policy";
import { sendTestSignerTransaction, testSignerAccount } from "@/lib/wallet/test-signer";

const address = z.string().regex(/^0x[\da-fA-F]{40}$/).transform((value) => value as `0x${string}`);
const schema = z.object({
  calls: z.array(z.object({ to: address, data: z.string().regex(/^0x[\da-fA-F]*$/).transform((value) => value as `0x${string}`).optional(), value: z.string().regex(/^\d+$/).optional() }).strict()).length(1),
  gasCeiling: z.object({ gasLimit: z.string().regex(/^\d+$/), gasPriceWei: z.string().regex(/^\d+$/) }).strict(),
}).strict();
const headers = { "Cache-Control": "no-store" };
export const runtime = "nodejs";

/** Public address only; 404 whenever the dev test signer is not fully enabled. */
export async function GET(request: Request) {
  const account = testSignerAccount(requestHostOrigin(request).hostname);
  if (!account) return Response.json({ status: "UNAVAILABLE" }, { status: 404, headers });
  return Response.json({ status: "READY", address: account.address }, { headers });
}

export async function POST(request: Request) {
  try {
    assertLocalEarnExecution(request);
    const account = testSignerAccount(requestHostOrigin(request).hostname);
    if (!account) throw new EarnAccessError("TEST_SIGNER_DISABLED", "The local test signer is not enabled.", 404);
    const input = schema.safeParse(await request.json());
    if (!input.success) throw new EarnAccessError("INVALID_REQUEST", "The test signer request is invalid.", 400);
    // The browser runtime does not know the scope; use whichever workspace selected this signer.
    let context: Awaited<ReturnType<typeof earnServerContext>> | null = null;
    for (const scope of ["SMOKE_TEST", "TREASURY"] as const) {
      const candidate = await earnServerContext(scope).catch(() => null);
      if (candidate?.wallet.provider === "TEST_SIGNER" && candidate.wallet.address.toLowerCase() === account.address.toLowerCase()) { context = candidate; break; }
    }
    if (!context) throw new EarnAccessError("TEST_SIGNER_NOT_SELECTED", "No signed-in workspace has selected the local test signer.", 409);
    const claimed = claimTestSignerRequest(context.binding, input.data.calls, input.data.gasCeiling);
    const txHash = await sendTestSignerTransaction(account, claimed.call, claimed.gasCeiling);
    return Response.json({ status: "SIGNED", txHash }, { headers });
  } catch (error) {
    // Every refusal here happens before signing, so nothing was submitted.
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", submitted: false, code: known ? error.code : "TEST_SIGNER_UNAVAILABLE", message: known ? error.message : "The test signer refused before signing." }, { status: known ? error.status : 503, headers });
  }
}
