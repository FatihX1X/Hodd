import "server-only";
import { earnServerContext } from "@/lib/earn/server-context";
import { assertLiveAmount, assertLiveReady } from "@/lib/execution/live-readiness";
import { EarnAccessError } from "@/lib/earn/security";
import { liveControls } from "@/lib/earn/live-controls";
import { usycExecutionState, usycGate } from "./access";
import { UsycError } from "./errors";
import { usycRequestSchema } from "./models";
import { quoteDeposit, quoteWithdraw } from "./quotes";
import { readUsycStatus } from "./status";
import { verifyUsycTransaction } from "./verify";

const headers = { "Cache-Control": "no-store" };
const env = () => ({ nodeEnv: process.env.NODE_ENV, vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV, liveFlag: process.env.HODD_TESTNET_LIVE, localFlag: process.env.HODD_EARN_EXECUTION_ENABLED });

/** Wallets whose browser runtime can send these transactions: injected wallets and Circle Passkey. PIN wallets and the dev signer cannot. */
const SIGNING_PROVIDERS = new Set(["INJECTED_METAMASK", "INJECTED_RABBY", "CIRCLE_MODULAR"]);

/**
 * Hodd's USYC pool (HoddUSYCVault) for the signed-in session wallet. Users deal only in USDC; the pool holds USYC.
 * GET: the wallet's pool position (read-only; `position` is null while the pool is not deployed).
 * POST `{ action: "QUOTE_DEPOSIT", amountMinor }`, `{ action: "QUOTE_WITHDRAW", amountMinor | all }`: a quote with
 * ready-to-sign calls and server-chosen gas ceilings. POST `{ action: "VERIFY", step, txHash, amountMinor? }`: what
 * a transaction did for the wallet. The wallet is always the session's wallet. Hodd never holds, signs or sends
 * anything for the user. Errors are `{ status: "ERROR", code, message }`.
 */
export async function usycHttp(request: Request) {
  try {
    if (request.method === "GET") {
      const c = await earnServerContext();
      const position = await readUsycStatus(c.wallet.address);
      const state = usycExecutionState(request, env(), await liveControls());
      return Response.json({ status: "READY", position, executionEnabled: state.open, executionNote: state.note, walletCanSign: SIGNING_PROVIDERS.has(c.wallet.provider) }, { headers });
    }
    const raw: unknown = await request.json().catch(() => null);
    // Access is decided before anything else is read, so a closed host answers the same for any body.
    const verifying = typeof raw === "object" && raw !== null && (raw as { action?: unknown }).action === "VERIFY";
    const gate = await usycGate(request, env(), liveControls, !verifying);
    if (!gate.allowed) throw new EarnAccessError(gate.code, gate.message, gate.status);
    const parsed = usycRequestSchema.safeParse(raw);
    if (!parsed.success) throw new UsycError("INVALID_REQUEST", "The USYC request is invalid.", 400);
    const input = parsed.data;
    const c = await earnServerContext();
    const wallet = c.wallet.address;
    if (input.action === "VERIFY") {
      if (input.step === "APPROVE" && input.amountMinor === undefined) throw new UsycError("INVALID_REQUEST", "Checking an approval needs the approved amount.", 400);
      return Response.json(await verifyUsycTransaction({ wallet, step: input.step, txHash: input.txHash, amount: input.amountMinor === undefined ? undefined : BigInt(input.amountMinor) }), { headers });
    }
    if (!SIGNING_PROVIDERS.has(c.wallet.provider)) throw new UsycError("USYC_WALLET_UNSUPPORTED", "This wallet type cannot sign USYC transactions in Hodd yet. Use MetaMask, Rabby or a Circle Passkey wallet. Nothing was sent.", 409);
    if (input.action === "QUOTE_DEPOSIT") assertLiveAmount(gate.mode, input.amountMinor);
    // Provider switch, ownership proof and the per-user/global usage reservation, as for Earn quotes.
    await assertLiveReady(c, gate.mode, "QUOTE");
    const quote = input.action === "QUOTE_DEPOSIT" ? await quoteDeposit(wallet, BigInt(input.amountMinor)) : await quoteWithdraw(wallet, input.all ? { all: true } : { amountMinor: BigInt(input.amountMinor!) });
    return Response.json({ status: "READY", quote }, { headers });
  } catch (error) {
    const known = error instanceof EarnAccessError || error instanceof UsycError;
    const code = known ? error.code : "USYC_UNAVAILABLE";
    return Response.json({ status: "ERROR", code, message: known ? error.message : "USYC is temporarily unavailable. Nothing was sent or changed; try again in a moment." }, { status: known ? error.status : 503, headers });
  }
}
