"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, X } from "lucide-react";
import { gatewayDepositCalls, parseUsdcInput } from "@/lib/gateway/deposit-calls";
import { GATEWAY_CHAINS, gatewayChainByKey } from "@/lib/gateway/chains";
import { gatewayErrorSchema, gatewayMoveSchema, type GatewayMove, type UnifiedUsdcView } from "@/lib/gateway/models";
import { formatMoney } from "@/lib/treasury/format";
import { minMoney, multiplyBps, subtractMoneyFloor } from "@/lib/treasury/money";
import { getActiveWalletRuntime, isSignerFor } from "@/lib/wallet/runtime";
import { useHasActiveSigner } from "@/lib/wallet/use-active-signer";
import { EarnOperationDialog } from "./earn-operation-dialog";
import { buttonClass, inputClass, labelClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

const usdc = (minor: bigint | string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: minor.toString() });
const show = (minor: bigint | string) => formatMoney(usdc(minor), { fractionDigits: 6 });
const decimal = (minor: bigint) => `${minor / 1_000_000n}.${(minor % 1_000_000n).toString().padStart(6, "0")}`.replace(/\.?0+$/, "");
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Brings USDC from any Gateway testnet to the user's own Arc wallet, then offers
 * the normal Morpho deposit. Two steps: (1) optional deposit into Gateway on the
 * source chain (wallet transactions there), (2) a free EIP-712 signature; Circle
 * mints on Arc. The Morpho deposit keeps its own quote, policy limit and signature.
 */
export function GatewayMoveDialog({ view, defaultSourceKey, onChanged }: { view: UnifiedUsdcView; defaultSourceKey?: string; onChanged: () => Promise<unknown> }) {
  const { workspace, workspaceScope, operationalWorkspace, assessment, earnState, refreshWallet, refreshEarn, readOnly } = useTreasuryWorkspace();
  const connection = workspace.walletConnection;
  const hasSigner = useHasActiveSigner(connection);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [note, setNote] = useState("");
  const [sourceKey, setSourceKey] = useState(defaultSourceKey ?? view.chains.find((item) => BigInt(item.gateway?.minorUnits ?? "0") > 0n || (item.domain !== 26 && BigInt(item.wallet?.minorUnits ?? "0") > 0n))?.key ?? "Base_Sepolia");
  const [depositAmount, setDepositAmount] = useState(""); const [amount, setAmount] = useState("");
  const [move, setMove] = useState<GatewayMove | null>(null); const [depositHashes, setDepositHashes] = useState<string[]>([]);
  const source = gatewayChainByKey(sourceKey)!;
  const row = view.chains.find((item) => item.key === sourceKey);
  const eoa = connection?.accountType === "EOA";
  const runtime = () => { const current = getActiveWalletRuntime(); return isSignerFor(current, connection) ? current : null; };

  const call = async (body: object) => {
    const response = await fetch("/api/gateway", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: workspaceScope, ...body }) });
    const json: unknown = await response.json();
    const failure = gatewayErrorSchema.safeParse(json); if (failure.success) throw new Error(failure.data.message);
    return gatewayMoveSchema.parse(json);
  };
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The cross-chain step did not complete."); } finally { setBusy(false); } };

  const deposit = () => run(async () => {
    const value = parseUsdcInput(depositAmount); const signer = runtime();
    if (!value) throw new Error("Enter a USDC amount with at most 6 decimals.");
    if (!signer?.sendOnChain) throw new Error("Reconnect MetaMask or Rabby to send the Gateway deposit.");
    if (BigInt(row?.wallet?.minorUnits ?? "0") < value) throw new Error(`Your wallet on ${source.label} holds less than that.`);
    const before = BigInt(row?.gateway?.minorUnits ?? "0");
    setNote(`Approve, then deposit on ${source.label}. Each step needs a little ${source.nativeSymbol} for gas.`);
    const hashes = await signer.sendOnChain(source, gatewayDepositCalls(source, value), (hash) => setDepositHashes((current) => [...current, hash]));
    setDepositHashes(hashes);
    setNote(`Deposited on ${source.label}. Circle Gateway credits it after ${source.depositWait}; this window keeps checking.`);
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      const next = await onChanged() as UnifiedUsdcView | null;
      const credited = BigInt(next?.chains.find((item) => item.key === sourceKey)?.gateway?.minorUnits ?? "0");
      if (credited >= before + value) { setNote(`Gateway credited ${show(value)} on ${source.label}. You can move it to Arc now.`); setAmount(decimal(credited)); return; }
      await wait(10_000);
    }
    setNote("Still waiting for Gateway to credit the deposit. Close this window and check the All chains card later; nothing is lost.");
  });

  const review = () => run(async () => {
    const value = parseUsdcInput(amount);
    if (!value) throw new Error("Enter a USDC amount with at most 6 decimals.");
    setMove(await call({ action: "MOVE_QUOTE", sourceKey, amountMinor: value.toString() }));
  });

  const signAndMove = () => run(async () => {
    if (!move?.typedData) return;
    const signer = runtime();
    if (!signer?.signGatewayIntent) throw new Error("Reconnect MetaMask or Rabby to sign. Nothing was sent.");
    let signature: `0x${string}`;
    try { signature = await signer.signGatewayIntent({ typedData: move.typedData, intent: move.intent, handle: move.handle }); }
    catch (caught) { const denied = typeof caught === "object" && caught !== null && "code" in caught && caught.code === 4001; throw new Error(denied ? "The signature was rejected in the wallet. Nothing was sent." : caught instanceof Error ? caught.message : "The wallet did not sign. Nothing was sent."); }
    let current = await call({ action: "MOVE_SUBMIT", handle: move.handle, intent: move.intent, signature });
    setMove(current);
    const deadline = Date.now() + 5 * 60_000;
    while (current.stage === "SUBMITTED" && Date.now() < deadline) { await wait(2_500); current = await call({ action: "MOVE_STATUS", handle: current.handle }); setMove(current); }
    if (current.stage === "CONFIRMED") { await Promise.allSettled([refreshWallet(), refreshEarn(), onChanged()]); }
    else if (current.stage === "SUBMITTED") setNote("Circle has not minted yet. Use Check status; the same signature can never mint twice.");
  });

  const recheck = () => run(async () => { if (!move) return; const current = await call({ action: "MOVE_STATUS", handle: move.handle }); setMove(current); if (current.stage === "CONFIRMED") await Promise.allSettled([refreshWallet(), refreshEarn(), onChanged()]); });

  // Same Morpho limit the Strategies page uses: deployable capital and the strategy cap.
  const portfolio = earnState.status === "READY" ? earnState.portfolio : null;
  const vault = portfolio?.vaults[0];
  const morpho = operationalWorkspace?.strategies.find((strategy) => strategy.kind === "MORPHO");
  const depositLimit = assessment && operationalWorkspace && morpho ? minMoney(assessment.deployableCapital, subtractMoneyFloor(multiplyBps(operationalWorkspace.totalTreasury, workspace.policy.strategyCapsBps.MORPHO), morpho.balance)) : null;
  const executionEnabled = portfolio ? ["TESTNET_LIVE", "LOCAL_ENABLED"].includes(portfolio.integration.execution) : false;
  const minted = move?.stage === "CONFIRMED" ? BigInt(move.amount.minorUnits) : 0n;
  const suggested = depositLimit ? (BigInt(depositLimit.minorUnits) < minted ? BigInt(depositLimit.minorUnits) : minted) : 0n;

  return <Dialog.Root open={open} onOpenChange={(value) => { if (busy && !value) return; setOpen(value); if (!value) { setMove(null); setError(""); setNote(""); setDepositHashes([]); } }}>
    <Dialog.Trigger asChild><button disabled={!connection || readOnly} className={buttonClass.primary}>Bring USDC to Arc <ArrowUpRight aria-hidden="true" className="size-3.5" /></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#101319] p-5 text-[#f4f1e8] focus:outline-none">
      <div className="flex items-center justify-between gap-4"><Dialog.Title className="text-xl font-semibold">Bring USDC to Arc</Dialog.Title><Dialog.Close disabled={busy} aria-label="Close" className="grid size-10 place-items-center border border-white/20"><X className="size-4" /></Dialog.Close></div>
      <Dialog.Description className="mt-3 text-sm leading-6 text-white/65">Circle Gateway moves USDC from any supported testnet to your own Arc wallet in seconds. Then you can deposit it into the Morpho vault within your treasury policy.</Dialog.Description>
      {!eoa && <p role="note" className="mt-4 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs text-[#ffd27f]">Moving funds needs a MetaMask or Rabby wallet (it signs Gateway messages directly). Circle smart wallets can view balances only for now.</p>}
      {eoa && !hasSigner && <p role="note" className="mt-4 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs text-[#ffd27f]">Reconnect your wallet in the wallet panel to sign.</p>}

      <label className={`${labelClass} mt-6 block`}>Source chain
        <select value={sourceKey} disabled={busy || Boolean(move)} onChange={(event) => setSourceKey(event.target.value)} className={inputClass}>
          {GATEWAY_CHAINS.map((chain) => { const item = view.chains.find((entry) => entry.key === chain.key); return <option key={chain.key} value={chain.key}>{chain.label} · wallet {item?.wallet ? formatMoney(item.wallet) : "n/a"} · Gateway {item?.gateway ? formatMoney(item.gateway) : "n/a"}</option>; })}
        </select>
      </label>

      <section aria-label="Step 1: deposit into Gateway" className="mt-6 border border-white/15 p-4">
        <p className={labelClass}>1 · Add to Gateway on {source.label} (only if needed)</p>
        <p className="mt-2 text-xs leading-5 text-white/60">Wallet on {source.label}: {row?.wallet ? formatMoney(row.wallet, { fractionDigits: 6 }) : "unavailable"} · already in Gateway: {row?.gateway ? formatMoney(row.gateway, { fractionDigits: 6 }) : "unavailable"}. Depositing needs {source.nativeSymbol} for gas; Gateway credits it after {source.depositWait}.</p>
        <div className="mt-3 flex gap-2"><input aria-label="Gateway deposit amount" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} inputMode="decimal" placeholder="USDC" className={`${inputClass} mt-0`} /><button disabled={busy || !eoa || !hasSigner || Boolean(move)} onClick={() => void deposit()} className={buttonClass.ghost}>Deposit</button></div>
        {depositHashes.map((hash) => <a key={hash} href={`${source.explorerTx}${hash}`} target="_blank" rel="noreferrer" className="mono mt-2 block break-all text-[10px] text-[#8fb0ff] underline">{hash}</a>)}
      </section>

      <section aria-label="Step 2: move to Arc" className="mt-4 border border-white/15 p-4">
        <p className={labelClass}>2 · Move to your Arc wallet</p>
        {!move && <><div className="mt-3 flex gap-2"><input aria-label="Amount to move" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="USDC" className={`${inputClass} mt-0`} /><button disabled={busy || !eoa || !hasSigner} onClick={() => void review()} className={buttonClass.ghost}>Review</button></div><p className="mt-2 text-xs text-white/50">Gateway and Circle forwarding fees come out of the Gateway balance on top of the amount; the review shows the exact cap.</p></>}
        {move && <div className="mt-3 space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-3"><div><dt className={labelClass}>You receive on Arc</dt><dd className="mono mt-1">{formatMoney(move.amount, { fractionDigits: 6 })}</dd></div><div><dt className={labelClass}>Max fees</dt><dd className="mono mt-1">{formatMoney(move.fee, { fractionDigits: 6 })}</dd></div></dl>
          <p className="break-all text-xs text-white/60">Recipient: {move.recipient} (your wallet)</p>
          <p role="status" className="border border-white/20 p-3 text-xs">{move.stage} · {move.message}</p>
          {move.stage === "SIGN" && <button disabled={busy || !hasSigner} onClick={() => void signAndMove()} className={`${buttonClass.primary} w-full`}>Sign (free) and move to Arc</button>}
          {move.stage === "SUBMITTED" && !busy && <button onClick={() => void recheck()} className={buttonClass.ghost}>Check status (sends nothing)</button>}
          {move.mintTxHash && <a href={`https://testnet.arcscan.app/tx/${move.mintTxHash}`} target="_blank" rel="noreferrer" className="mono block break-all text-[10px] text-[#8fb0ff] underline">Arc mint: {move.mintTxHash}</a>}
          {move.stage === "FAILED" && <button onClick={() => setMove(null)} className={buttonClass.ghost}>Review again</button>}
        </div>}
      </section>

      {move?.stage === "CONFIRMED" && <section aria-label="Step 3: deposit into Morpho" className="mt-4 border border-[#7fa6ff]/40 p-4">
        <p className={labelClass}>3 · Deposit into Morpho on Arc</p>
        {vault && depositLimit ? <>
          <p className="mt-2 text-xs leading-5 text-white/60">The treasury engine allows up to {formatMoney(depositLimit, { fractionDigits: 6 })} into Morpho right now (deployable capital and the Morpho cap). Obligations and the safety buffer stay protected.</p>
          <div className="mt-3"><EarnOperationDialog key={move.mintTxHash ?? "deposit"} operation="DEPOSIT" vault={vault} position={portfolio?.positions.find((item) => item.vaultAddress.toLowerCase() === vault.address.toLowerCase())} policyLimit={depositLimit} enabled={executionEnabled && !readOnly} initialAmount={suggested > 0n ? decimal(suggested) : ""} /></div>
        </> : <p className="mt-2 text-xs text-white/60">Loading the verified Morpho vault and your fresh balance…</p>}
      </section>}

      {note && <p role="status" className="mt-4 text-xs leading-5 text-white/70">{note}</p>}
      {error && <p role="alert" className="mt-4 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92]">{error}</p>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
