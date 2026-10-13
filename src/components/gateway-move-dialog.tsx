"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { gatewayDepositCalls, gatewayPermitDepositCall, parseUsdcInput } from "@/lib/gateway/deposit-calls";
import { GATEWAY_CHAINS, gatewayChainByKey } from "@/lib/gateway/chains";
import { gatewayErrorSchema, gatewayMoveSchema, type GatewayMove, type UnifiedUsdcView } from "@/lib/gateway/models";
import { formatMoney } from "@/lib/treasury/format";
import { minMoney, multiplyBps, subtractMoneyFloor } from "@/lib/treasury/money";
import { getActiveWalletRuntime, isSignerFor } from "@/lib/wallet/runtime";
import { useHasActiveSigner } from "@/lib/wallet/use-active-signer";
import { ConfirmButton } from "./confirm-button";
import { EarnOperationDialog } from "./earn-operation-dialog";
import { buttonClass, inputClass, labelClass } from "./primitives";
import { ProgressRail, type RailOutcome, type Step } from "./progress-rail";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

const usdc = (minor: bigint | string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: minor.toString() });
const show = (minor: bigint | string) => formatMoney(usdc(minor), { fractionDigits: 6 });
const decimal = (minor: bigint) => `${minor / 1_000_000n}.${(minor % 1_000_000n).toString().padStart(6, "0")}`.replace(/\.?0+$/, "");
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const CREDIT_POLL_MS = 10_000, CREDIT_DEADLINE_MS = 45 * 60_000, MINT_DEADLINE_MS = 5 * 60_000;
const ARCSCAN_TX = "https://testnet.arcscan.app/tx/";

class GatewayCallError extends Error { constructor(public readonly code: string, message: string) { super(message); } }
const rejected = (caught: unknown) => typeof caught === "object" && caught !== null && "code" in caught && caught.code === 4001;

type MoveStage = "prepare" | "sign" | "deposit" | "credit" | "mint" | "done";
/** One bring-to-Arc run, driven by the server's quote, the wallet and Gateway's answers. */
export type MoveRun = Readonly<{
  stage: MoveStage; outcome: RailOutcome; source: string; wait: string; amountMinor: string;
  deposit: boolean; permit: boolean; depositMinor?: string; depositHash?: string; depositExplorer?: string; mintHash?: string; message?: string;
}>;

/** The move as rail milestones: sign → (deposit → Gateway credit) → mint on Arc → done. */
export function gatewayMoveProgress(run: MoveRun) {
  const order: Exclude<MoveStage, "prepare">[] = run.deposit ? ["sign", "deposit", "credit", "mint", "done"] : ["sign", "mint", "done"];
  const label = { sign: "Sign", deposit: "Deposit", credit: "Gateway credit", mint: "Mint on Arc", done: "Done" } as const;
  const next = { sign: "Free", deposit: run.permit ? "1 transaction" : "2 transactions", credit: run.wait, mint: "Circle", done: "Verified" } as const;
  const stage = run.stage === "prepare" ? "sign" : run.stage;
  const at = order.indexOf(stage), done = run.outcome === "done";
  const steps: Step[] = order.map((key, index) => {
    if (done || index < at) return { key, label: label[key], state: "done", note: key === "credit" ? "Credited" : key === "mint" ? "Minted" : key === "done" ? "Verified" : "Done" };
    if (index > at) return { key, label: label[key], state: "waiting", note: next[key] };
    if (run.outcome === "failed" || run.outcome === "unknown") return { key, label: label[key], state: run.outcome, note: run.outcome === "failed" ? "Stopped" : "Unknown" };
    return { key, label: label[key], state: "active", note: run.stage === "prepare" ? "Preparing" : key === "sign" || key === "deposit" ? "In your wallet" : key === "credit" ? "Waiting" : "Minting" };
  });
  const caption = done ? `Done. ${show(run.amountMinor)} is in your Arc wallet.`
    : run.outcome === "failed" || run.outcome === "unknown" ? (run.message ?? "Stopped here. Nothing else is sent from this request.")
    : run.stage === "prepare" ? "Getting a fresh quote from Circle Gateway."
    : run.stage === "sign" ? "Sign the transfer in your wallet. It is free."
    : run.stage === "deposit" ? (run.permit ? `Sign the permit (free), then send one transaction on ${run.source} to deposit ${show(run.depositMinor ?? "0")}.` : `Approve, then deposit ${show(run.depositMinor ?? "0")} on ${run.source}.`)
    : run.stage === "credit" ? `Deposited. Circle Gateway credits it after ${run.wait}. Hodd sends your signed transfer as soon as it lands; you can close this window, but keep the page open.`
    : "Circle is minting the USDC on Arc.";
  const link = run.mintHash ? { href: `${ARCSCAN_TX}${run.mintHash}`, text: "Open Arc mint" } : run.depositHash && run.depositExplorer ? { href: `${run.depositExplorer}${run.depositHash}`, text: "Open deposit" } : null;
  return { steps, active: done ? order.length - 1 : Math.max(at, 0), caption, link };
}

/**
 * Brings USDC from any Gateway testnet to the user's own Arc wallet with one button (pressed twice: "Confirm?").
 * The server quotes the move; if the Gateway balance on the source chain is short, the quote includes the deposit.
 * The wallet then signs the transfer (free), signs an exact USDC permit (free) and sends ONE deposit transaction;
 * once Gateway credits it, Hodd submits the transfer signed at the start and Circle mints on Arc. The Morpho deposit
 * afterwards keeps its own quote, policy limit and signature.
 */
export function GatewayMoveDialog({ view, defaultSourceKey, onChanged }: { view: UnifiedUsdcView; defaultSourceKey?: string; onChanged: () => Promise<unknown> }) {
  const { workspace, workspaceScope, operationalWorkspace, assessment, earnState, refreshWallet, refreshEarn, readOnly } = useTreasuryWorkspace();
  const connection = workspace.walletConnection;
  const hasSigner = useHasActiveSigner(connection);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [sourceKey, setSourceKey] = useState(defaultSourceKey ?? view.chains.find((item) => BigInt(item.gateway?.minorUnits ?? "0") > 0n || (item.domain !== 26 && BigInt(item.wallet?.minorUnits ?? "0") > 0n))?.key ?? "Base_Sepolia");
  const [amount, setAmount] = useState(""); const [run, setRun] = useState<MoveRun | null>(null); const [move, setMove] = useState<GatewayMove | null>(null);
  const [topUp, setTopUp] = useState(""); const [topUpNote, setTopUpNote] = useState(""); const [topUpHashes, setTopUpHashes] = useState<string[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const source = gatewayChainByKey(sourceKey)!;
  const row = view.chains.find((item) => item.key === sourceKey);
  const eoa = connection?.accountType === "EOA";
  const runtime = () => { const current = getActiveWalletRuntime(); return isSignerFor(current, connection) ? current : null; };
  const update = (patch: Partial<MoveRun>) => setRun((current) => current ? { ...current, ...patch } : current);

  const call = async (body: object) => {
    const response = await fetch("/api/gateway", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: workspaceScope, ...body }) });
    const json: unknown = await response.json();
    const failure = gatewayErrorSchema.safeParse(json); if (failure.success) throw new GatewayCallError(failure.data.code, failure.data.message);
    return gatewayMoveSchema.parse(json);
  };
  const creditedOn = async () => { const next = await onChanged() as UnifiedUsdcView | null; return BigInt(next?.chains.find((item) => item.key === sourceKey)?.gateway?.minorUnits ?? "0"); };

  // What the button will do, from the balances already on screen. The server's quote decides.
  const value = parseUsdcInput(amount);
  const walletMinor = BigInt(row?.wallet?.minorUnits ?? "0"), gatewayMinor = BigInt(row?.gateway?.minorUnits ?? "0");
  const plan = !value ? null : gatewayMinor > value ? "GATEWAY" : walletMinor + gatewayMinor > value ? "DEPOSIT" : "SHORT";
  const running = run?.outcome === "running";

  const bring = async () => {
    const signer = runtime();
    if (!value) { setError("Enter a USDC amount with at most 6 decimals."); return; }
    if (!signer?.signGatewayIntent) { setError("Reconnect MetaMask or Rabby to sign. Nothing was sent."); return; }
    setBusy(true); setError(""); setMove(null);
    setRun({ stage: "prepare", outcome: "running", source: source.label, wait: source.depositWait, amountMinor: value.toString(), deposit: plan === "DEPOSIT", permit: true });
    let sent = false;
    try {
      const quote = await call({ action: "MOVE_QUOTE", sourceKey, amountMinor: value.toString() });
      setMove(quote);
      const deposit = quote.deposit ?? null;
      if (deposit && !signer.sendOnChain) throw new Error(`Depositing on ${source.label} needs MetaMask or Rabby. Nothing was sent.`);
      update({ stage: "sign", deposit: Boolean(deposit), permit: Boolean(deposit?.permit && signer.signTypedDataOn), depositMinor: deposit?.amountMinor });
      let signature: `0x${string}`;
      try { signature = await signer.signGatewayIntent({ typedData: quote.typedData ?? {}, intent: quote.intent, handle: quote.handle }); }
      catch (caught) { throw new Error(rejected(caught) ? "The signature was rejected in the wallet. Nothing was sent." : caught instanceof Error ? caught.message : "The wallet did not sign. Nothing was sent."); }

      if (deposit) {
        update({ stage: "deposit", depositExplorer: source.explorerTx });
        const amountMinor = BigInt(deposit.amountMinor);
        let calls: readonly { to: `0x${string}`; data: `0x${string}`; value: string }[];
        try {
          if (deposit.permit && signer.signTypedDataOn) {
            const permit = await signer.signTypedDataOn(source, deposit.permit.typedData);
            calls = [gatewayPermitDepositCall(source, connection!.address, amountMinor, BigInt(deposit.permit.deadline), permit)];
          } else calls = gatewayDepositCalls(source, amountMinor);
        } catch (caught) { throw new Error(rejected(caught) ? "The permit was rejected in the wallet. Nothing was sent, and the signed transfer is never used." : caught instanceof Error ? caught.message : "The wallet did not sign the permit. Nothing was sent."); }
        try { await signer.sendOnChain!(source, calls, (hash) => { sent = true; update({ depositHash: hash }); }); }
        catch (caught) {
          if (!sent) throw new Error(rejected(caught) ? "The deposit was rejected in the wallet. Nothing was sent, and the signed transfer is never used." : caught instanceof Error ? caught.message : "The deposit was not sent. Nothing was sent.");
          setRun((current) => current && { ...current, outcome: "unknown", message: `The deposit on ${source.label} was sent but not confirmed here. Check it in the explorer; if it landed, the USDC waits in Gateway and the next Bring uses it without a new deposit.` });
          return;
        }
        update({ stage: "credit" });
        const target = BigInt(quote.amount.minorUnits) + BigInt(quote.fee.minorUnits), deadline = Date.now() + CREDIT_DEADLINE_MS;
        while ((await creditedOn().catch(() => 0n)) < target) {
          if (!alive.current) return;
          if (Date.now() > deadline) { setRun((current) => current && { ...current, outcome: "unknown", message: `Gateway has not credited the deposit on ${source.label} yet. Your USDC is safe in Gateway; press Bring again later and it moves without a new deposit.` }); return; }
          await wait(CREDIT_POLL_MS);
        }
      }

      update({ stage: "mint" });
      let current: GatewayMove | null = null;
      for (let attempt = 0; !current; attempt += 1) {
        try { current = await call({ action: "MOVE_SUBMIT", handle: quote.handle, intent: quote.intent, signature }); }
        catch (caught) { if (caught instanceof GatewayCallError && caught.code === "GATEWAY_BALANCE_INSUFFICIENT" && deposit && attempt < 6 && alive.current) { await wait(CREDIT_POLL_MS); continue; } throw caught; }
      }
      setMove(current);
      const deadline = Date.now() + MINT_DEADLINE_MS;
      while (current.stage === "SUBMITTED" && Date.now() < deadline && alive.current) { await wait(2_500); current = await call({ action: "MOVE_STATUS", handle: current.handle }); setMove(current); }
      if (current.stage === "CONFIRMED") { update({ stage: "done", outcome: "done", mintHash: current.mintTxHash ?? undefined }); await Promise.allSettled([refreshWallet(), refreshEarn(), onChanged()]); }
      else if (current.stage === "FAILED") setRun((state) => state && { ...state, outcome: "failed", message: current!.message });
      else setRun((state) => state && { ...state, outcome: "unknown", mintHash: current!.mintTxHash ?? undefined, message: "Circle has not minted yet. Use Check status; the same signature can never mint twice." });
    } catch (caught) {
      setRun((current) => current && { ...current, outcome: "failed", message: caught instanceof Error ? caught.message : "The move did not complete. Nothing else is sent from this request." });
    } finally { setBusy(false); }
  };

  const recheck = async () => {
    if (!move) return;
    setBusy(true); setError("");
    try {
      const current = await call({ action: "MOVE_STATUS", handle: move.handle }); setMove(current);
      if (current.stage === "CONFIRMED") { update({ stage: "done", outcome: "done", mintHash: current.mintTxHash ?? undefined }); await Promise.allSettled([refreshWallet(), refreshEarn(), onChanged()]); }
      else if (current.stage === "FAILED") setRun((state) => state && { ...state, outcome: "failed", message: current.message });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Circle Gateway status is unavailable. Try again shortly."); }
    finally { setBusy(false); }
  };

  // Only adds USDC to Gateway on the source chain (for example to pay a bill from there later).
  const addToGateway = async () => {
    const signer = runtime(), amountMinor = parseUsdcInput(topUp);
    setError("");
    if (!amountMinor) { setError("Enter a USDC amount with at most 6 decimals."); return; }
    if (!signer?.sendOnChain) { setError("Reconnect MetaMask or Rabby to send the Gateway deposit."); return; }
    if (walletMinor < amountMinor) { setError(`Your wallet on ${source.label} holds less than that.`); return; }
    setBusy(true);
    try {
      setTopUpNote(`Approve, then deposit on ${source.label}. Each step needs a little ${source.nativeSymbol} for gas.`);
      const hashes = await signer.sendOnChain(source, gatewayDepositCalls(source, amountMinor), (hash) => setTopUpHashes((current) => [...current, hash]));
      setTopUpHashes(hashes);
      setTopUpNote(`Deposited on ${source.label}. Circle Gateway credits it after ${source.depositWait}.`);
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The Gateway deposit did not complete."); }
    finally { setBusy(false); }
  };

  // Same Morpho limit the Strategies page uses: deployable capital and the strategy cap.
  const portfolio = earnState.status === "READY" ? earnState.portfolio : null;
  const vault = portfolio?.vaults[0];
  const morpho = operationalWorkspace?.strategies.find((strategy) => strategy.kind === "MORPHO");
  const depositLimit = assessment && operationalWorkspace && morpho ? minMoney(assessment.deployableCapital, subtractMoneyFloor(multiplyBps(operationalWorkspace.totalTreasury, workspace.policy.strategyCapsBps.MORPHO), morpho.balance)) : null;
  const executionEnabled = portfolio ? ["TESTNET_LIVE", "LOCAL_ENABLED"].includes(portfolio.integration.execution) : false;
  const minted = move?.stage === "CONFIRMED" ? BigInt(move.amount.minorUnits) : 0n;
  const suggested = depositLimit ? (BigInt(depositLimit.minorUnits) < minted ? BigInt(depositLimit.minorUnits) : minted) : 0n;
  const progress = run ? gatewayMoveProgress(run) : null;
  // While Gateway credits a deposit (minutes), the window may close; the page keeps going.
  const lockedOpen = busy && run?.stage !== "credit";

  return <Dialog.Root open={open} onOpenChange={(next) => { if (lockedOpen && !next) return; setOpen(next); if (!next && !running) { setRun(null); setMove(null); setError(""); setTopUpNote(""); setTopUpHashes([]); } }}>
    <Dialog.Trigger asChild><button disabled={!connection || readOnly} className={buttonClass.primary}>{running ? <><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />Moving to Arc…</> : <>Bring USDC to Arc <ArrowUpRight aria-hidden="true" className="size-3.5" /></>}</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#101319] p-5 text-[#f4f1e8] focus:outline-none">
      <div className="flex items-center justify-between gap-4"><Dialog.Title className="text-xl font-semibold">Bring USDC to Arc</Dialog.Title><Dialog.Close disabled={lockedOpen} aria-label="Close" className="grid size-10 place-items-center border border-white/20"><X className="size-4" /></Dialog.Close></div>
      <Dialog.Description className="mt-3 text-sm leading-6 text-white/65">One button moves USDC from any supported testnet to your own Arc wallet through Circle Gateway. Then you can deposit it into the Morpho vault within your treasury policy.</Dialog.Description>
      {!eoa && <p role="note" className="mt-4 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs text-[#ffd27f]">Moving funds needs a MetaMask or Rabby wallet (it signs Gateway messages directly). Circle smart wallets can view balances only for now.</p>}
      {eoa && !hasSigner && <p role="note" className="mt-4 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs text-[#ffd27f]">Reconnect your wallet in the wallet panel to sign.</p>}

      <label className={`${labelClass} mt-6 block`}>Source chain
        <select value={sourceKey} disabled={busy || running} onChange={(event) => setSourceKey(event.target.value)} className={inputClass}>
          {GATEWAY_CHAINS.map((chain) => { const item = view.chains.find((entry) => entry.key === chain.key); return <option key={chain.key} value={chain.key}>{chain.label} · wallet {item?.wallet ? formatMoney(item.wallet) : "n/a"} · Gateway {item?.gateway ? formatMoney(item.gateway) : "n/a"}</option>; })}
        </select>
      </label>
      <label className={`${labelClass} mt-4 block`}>Amount to receive on Arc
        <input aria-label="Amount to move" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="USDC" disabled={busy || running} className={`${inputClass} mono`} />
      </label>
      <p className="mt-2 text-xs leading-5 text-white/60">On {source.label}: wallet {row?.wallet ? formatMoney(row.wallet, { fractionDigits: 6 }) : "unavailable"}, in Gateway {row?.gateway ? formatMoney(row.gateway, { fractionDigits: 6 }) : "unavailable"}.</p>
      {plan && !run && <p role="note" className={`mt-3 border p-3 text-xs leading-5 ${plan === "SHORT" ? "border-[#ff9a92]/30 bg-[#d03b3b]/15 text-[#ff9a92]" : "border-white/15 text-white/70"}`}>{plan === "GATEWAY"
        ? `Already in Gateway on ${source.label}: one free signature, then Circle mints on Arc in seconds. Gateway and forwarding fees come out of the Gateway balance.`
        : plan === "DEPOSIT"
          ? `Hodd first deposits about ${show(value! - gatewayMinor)} plus fees from your ${source.label} wallet: free signatures and one transaction (it needs a little ${source.nativeSymbol} for gas). Gateway credits it after ${source.depositWait}, then Circle mints on Arc by itself.`
          : `Your ${source.label} wallet and Gateway balance hold ${show(walletMinor + gatewayMinor)}. Enter less.`}</p>}
      {!run || run.outcome !== "running" ? <ConfirmButton disabled={busy || !eoa || !hasSigner || !value || plan === "SHORT" || readOnly} onClick={() => void bring()} className="mt-4 w-full py-4">{value ? `Bring ${decimal(value)} USDC to Arc` : "Bring to Arc"}</ConfirmButton> : null}

      {progress && <ProgressRail className="mt-4" label="Move progress" steps={progress.steps} active={progress.active} outcome={run!.outcome} caption={progress.caption} link={progress.link} />}
      {run?.outcome === "unknown" && move?.stage === "SUBMITTED" && <button disabled={busy} onClick={() => void recheck()} className={`${buttonClass.ghost} mt-3`}>Check status (sends nothing)</button>}
      {move && run && run.outcome !== "running" && <p className="mt-3 text-xs text-white/55">Fees up to {formatMoney(move.fee, { fractionDigits: 6 })}, paid from the Gateway balance. Recipient: your wallet {move.recipient.slice(0, 6)}…{move.recipient.slice(-4)}.</p>}

      {move?.stage === "CONFIRMED" && <section aria-label="Deposit into Morpho" className="mt-4 border border-[#7fa6ff]/40 p-4">
        <p className={labelClass}>Next: deposit into Morpho on Arc</p>
        {vault && depositLimit ? <>
          <p className="mt-2 text-xs leading-5 text-white/60">The treasury engine allows up to {formatMoney(depositLimit, { fractionDigits: 6 })} into Morpho right now (deployable capital and the Morpho cap). Obligations and the safety buffer stay protected.</p>
          <div className="mt-3"><EarnOperationDialog key={move.mintTxHash ?? "deposit"} operation="DEPOSIT" vault={vault} position={portfolio?.positions.find((item) => item.vaultAddress.toLowerCase() === vault.address.toLowerCase())} policyLimit={depositLimit} enabled={executionEnabled && !readOnly} initialAmount={suggested > 0n ? decimal(suggested) : ""} /></div>
        </> : <p className="mt-2 text-xs text-white/60">Loading the verified Morpho vault and your fresh balance…</p>}
      </section>}

      <details className="mt-6 border border-white/15">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm">Only add to Gateway on {source.label}</summary>
        <div className="space-y-2 px-4 pb-4">
          <p className="text-xs leading-5 text-white/60">Keeps the USDC in Gateway, for example to pay a bill from there later. Needs {source.nativeSymbol} for gas; Gateway credits it after {source.depositWait}.</p>
          <div className="flex gap-2"><input aria-label="Gateway deposit amount" value={topUp} onChange={(event) => setTopUp(event.target.value)} inputMode="decimal" placeholder="USDC" className={`${inputClass} mt-0`} /><button disabled={busy || running || !eoa || !hasSigner} onClick={() => void addToGateway()} className={buttonClass.ghost}>Deposit</button></div>
          {topUpHashes.map((hash) => <a key={hash} href={`${source.explorerTx}${hash}`} target="_blank" rel="noreferrer" className="mono block break-all text-[10px] text-[#8fb0ff] underline">{hash}</a>)}
          {topUpNote && <p role="status" className="text-xs leading-5 text-white/70">{topUpNote}</p>}
        </div>
      </details>

      {error && <p role="alert" className="mt-4 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92]">{error}</p>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
