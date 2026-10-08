import { z } from "zod";
import { earnServerContext } from "@/lib/earn/server-context";
import { claimTestSignerRequest } from "@/lib/earn/jobs";
import { claimTestSignerPayment } from "@/lib/payments/jobs";
import { assertLocalEarnExecution, EarnAccessError } from "@/lib/earn/security";
import { requestHostOrigin } from "@/lib/earn/access-policy";
import { paymentGasCeiling, sendTestSignerTransaction, testSignerAccount } from "@/lib/wallet/test-signer";

const address = z.string().regex(/^0x[\da-fA-F]{40}$/).transform((value) => value as `0x${string}`);
const calls = z.array(z.object({ to: address, data: z.string().regex(/^0x[\da-fA-F]*$/).transform((value) => value as `0x${string}`).optional(), value: z.string().regex(/^\d+$/).optional() }).strict()).length(1);
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EARN"), calls, gasCeiling: z.object({ gasLimit: z.string().regex(/^\d+$/), gasPriceWei: z.string().regex(/^\d+$/) }).strict() }).strict(),
  // Payments are bound to the server-held proposal fee quote, never a client value.
  z.object({ kind: z.literal("PAYMENT"), calls }).strict(),
]);
const headers = { "Cache-Control": "no-store" };
export const runtime = "nodejs";

/** Public address only; UNAVAILABLE whenever the dev test signer is not fully enabled. */
export async function GET(request: Request) {
  const account = testSignerAccount(requestHostOrigin(request).hostname);
  // 200, not 404: the wallet panel probes this on every page and must not log console errors.
  if (!account) return Response.json({ status: "UNAVAILABLE" }, { headers });
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
    let txHash: `0x${string}`;
    if (input.data.kind === "EARN") {
      const claimed = claimTestSignerRequest(context.binding, input.data.calls, input.data.gasCeiling);
      txHash = await sendTestSignerTransaction(account, claimed.call, claimed.gasCeiling);
    } else {
      const claimed = claimTestSignerPayment(context.binding, input.data.calls);
      txHash = await sendTestSignerTransaction(account, claimed.call, await paymentGasCeiling(claimed.feeQuote));
    }
    return Response.json({ status: "SIGNED", txHash }, { headers });
  } catch (error) {
    // Every refusal here happens before signing, so nothing was submitted.
    const known = error instanceof EarnAccessError;
    return Response.json({ status: "ERROR", submitted: false, code: known ? error.code : "TEST_SIGNER_UNAVAILABLE", message: known ? error.message : "The test signer refused before signing." }, { status: known ? error.status : 503, headers });
  }
}
