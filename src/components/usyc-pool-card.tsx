"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Coins, LoaderCircle, TriangleAlert } from "lucide-react";
import { formatUnits } from "viem";
import { ARCSCAN_TX } from "@/lib/usyc/constants";
import { usycErrorSchema, usycQuoteResponseSchema, usycVerifySchema, type UsycPosition, type UsycQuote, type UsycStep } from "@/lib/usyc/models";
import { formatMoney } from "@/lib/treasury/format";
import { parseMoneyInput } from "@/lib/treasury/money";
import type { Money } from "@/lib/treasury/models";
import { getActiveWalletRuntime, isSignerFor } from "@/lib/wallet/runtime";
import { useHasActiveSigner } from "@/lib/wallet/use-active-signer";
import { WalletPreflightError } from "@/lib/wallet/preflight";
import { ProgressRail, type RailOutcome, type Step } from "./progress-rail";
import { Meter, SectionCard, SectionHeading, StatusPill, inputClass, labelClass } from "./primitives";
import { ConfirmButton } from "./confirm-button";
import { InfoTip, Ring, moneyColor } from "./visuals";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

type Kind = UsycQuote["kind"];
type Stage = "check" | UsycStep["stage"] | "verified";
/** One deposit or withdrawal, driven only by server answers and the wallet. */
export type UsycRun = Readonly<{ kind: Kind; stage: Stage; sub: "preparing" | "wallet" | "confirming"; outcome: RailOutcome; hash?: string; message?: string; receivedUsdcMinor?: string }>;

const usdc = (minorUnits: string | bigint): Money => ({ currency: "USDC", decimals: 6, minorUnits: minorUnits.toString() });
const show = (minorUnits: string | bigint) => formatMoney(usdc(minorUnits), { fractionDigits: 6 });
const price = (value: string) => Number(formatUnits(BigInt(value), 18)).toFixed(4);
const verbs: Record<Kind, string> = { DEPOSIT: "Deposit", WITHDRAW: "Withdraw" };
const POLL_MS = 2000, VERIFY_DEADLINE_MS = 4 * 60_000;

/** The pool deposit or withdrawal as rail milestones: check → (approve) → deposit or withdraw → verified. */
export function usycProgress(run: UsycRun) {
  const order: Stage[] = run.kind === "DEPOSIT" ? ["check", "APPROVE", "DEPOSIT", "verified"] : ["check", "WITHDRAW", "verified"];
  const label: Record<Stage, string> = { check: "Check", APPROVE: "Approve USDC", DEPOSIT: "Deposit", WITHDRAW: "Withdraw", verified: "Verified" };
  const at = order.indexOf(run.stage), done = run.outcome === "done";
  const steps: Step[] = order.map((stage, index) => {
    if (done || index < at) return { key: stage, label: label[stage], state: "done", note: stage === "check" ? "Ready" : stage === "verified" ? "Receipt checked" : "Confirmed" };
    if (index > at) return { key: stage, label: label[stage], state: "waiting", note: index === order.length - 1 ? "Last" : "Next" };
    if (run.outcome === "failed" || run.outcome === "unknown") return { key: stage, label: label[stage], state: run.outcome, note: run.outcome === "failed" ? "Stopped" : "Unknown" };
    return { key: stage, label: label[stage], state: "active", note: run.sub === "wallet" ? "In your wallet" : run.sub === "confirming" ? "Confirming" : "Preparing" };
  });
  const verb = verbs[run.kind];
  const caption = done ? (run.kind === "DEPOSIT" ? "Deposit verified on Arc Testnet. Your USDC now earns through USYC." : `Withdrawal verified: ${run.receivedUsdcMinor ? show(run.receivedUsdcMinor) : "your USDC"} is back in your wallet.`)
    : run.outcome === "failed" ? (run.message ?? "Stopped here. Nothing else is sent from this request.")
    : run.outcome === "unknown" ? (run.message ?? "The outcome is unknown. Check your wallet before trying again.")
    : run.stage === "check" ? "Checking the pool, Circle's limits and your balance."
    : run.sub === "wallet" ? (run.stage === "APPROVE" ? "Approve exactly this amount of USDC for Hodd's pool in your wallet." : `Sign the ${verb.toLowerCase()} in your wallet.`)
    : run.sub === "confirming" ? "Sent. Waiting for Arc Testnet to confirm it."
    : "Preparing the next step.";
  return { steps, active: done ? order.length - 1 : Math.max(at, 0), caption, verb };
}

async function post(body: object) {
  const response = await fetch("/api/usyc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: response.ok, body: await response.json() as unknown };
}
const failure = (body: unknown, fallback: string) => { const parsed = usycErrorSchema.safeParse(body); return parsed.success ? parsed.data.message : fallback; };

/**
 * Hodd's USYC pool (HoddUSYCVault): the user deposits and withdraws only USDC, from and to their own wallet; the pool
 * holds the USYC and Circle allowlists only the pool. One click quotes, opens the wallet for each step and verifies
 * every receipt on the server before the next step. Nothing is retried automatically.
 */
export function UsycPoolCard() {
  const { workspace, usycState, readOnly, refreshUsyc, refreshWallet, recordEarnActivity } = useTreasuryWorkspace();
  const hasSigner = useHasActiveSigner(workspace.walletConnection);
  const [amount, setAmount] = useState("");
  const [run, setRun] = useState<UsycRun | null>(null);
  const busy = run?.outcome === "running";
  const data = usycState.status === "READY" ? usycState.data : null;
  const position = data?.position ?? null;

  const verify = async (step: UsycStep, hash: string, amountMinor: string) => {
    const deadline = Date.now() + VERIFY_DEADLINE_MS;
    while (Date.now() < deadline) {
      const reply = await post({ action: "VERIFY", step: step.stage, txHash: hash, amountMinor });
      const parsed = usycVerifySchema.safeParse(reply.body);
      if (!parsed.success) throw new Error(failure(reply.body, "The transaction could not be checked right now."));
      if (parsed.data.status !== "PENDING") return parsed.data;
      await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
    }
    return null;
  };

  const start = async (kind: Kind, all = false) => {
    if (!workspace.walletConnection || busy) return;
    if (!hasSigner) { setRun({ kind, stage: "check", sub: "preparing", outcome: "failed", message: "Your wallet session is not active. Reconnect the wallet and try again. Nothing was sent." }); return; }
    let minor: string | undefined;
    if (!all) { try { minor = parseMoneyInput(amount).minorUnits; } catch (caught) { setRun({ kind, stage: "check", sub: "preparing", outcome: "failed", message: caught instanceof Error ? caught.message : "Enter an amount." }); return; } }
    setRun({ kind, stage: "check", sub: "preparing", outcome: "running" });
    let quote: UsycQuote;
    try {
      const reply = await post(kind === "DEPOSIT" ? { action: "QUOTE_DEPOSIT", amountMinor: minor } : all ? { action: "QUOTE_WITHDRAW", all: true } : { action: "QUOTE_WITHDRAW", amountMinor: minor });
      const parsed = usycQuoteResponseSchema.safeParse(reply.body);
      if (!reply.ok || !parsed.success) throw new Error(failure(reply.body, "The pool could not prepare this right now. Nothing was sent."));
      quote = parsed.data.quote;
    } catch (caught) { setRun({ kind, stage: "check", sub: "preparing", outcome: "failed", message: caught instanceof Error ? caught.message : "Nothing was sent." }); return; }

    let hash: string | undefined;
    for (const step of quote.steps) {
      const signer = getActiveWalletRuntime();
      if (!isSignerFor(signer, workspace.walletConnection) || !signer.sendCalls || signer.connection.address.toLowerCase() !== quote.wallet.toLowerCase()) {
        setRun({ kind, stage: step.stage, sub: "preparing", outcome: "failed", message: "The wallet session changed. Reconnect and try again. Nothing else was sent." }); return;
      }
      setRun({ kind, stage: step.stage, sub: "wallet", outcome: "running" });
      try { hash = await signer.sendCalls([{ to: step.call.to as `0x${string}`, data: step.call.data as `0x${string}`, value: "0" }], step.gasBudgetWei, undefined, undefined, step.gasCeiling); }
      catch (caught) {
        const denied = typeof caught === "object" && caught !== null && "code" in caught && caught.code === 4001;
        const preflight = caught instanceof WalletPreflightError;
        const sure = denied || preflight;
        setRun({ kind, stage: step.stage, sub: "wallet", outcome: sure ? "failed" : "unknown", message: preflight ? `${caught.message} Nothing was sent.` : denied ? "You rejected the request in your wallet. Nothing was sent." : "The wallet did not confirm whether it sent this. Check your wallet activity before trying again." });
        return;
      }
      setRun({ kind, stage: step.stage, sub: "confirming", outcome: "running", hash });
      // The approval is checked for the exact amount; the deposit for the USDC put in; the withdrawal for the shares burned.
      const checked = await verify(step, hash, quote.amountMinor).catch((caught: unknown) => caught instanceof Error ? caught : new Error("The transaction could not be checked."));
      if (checked instanceof Error || checked === null) { setRun({ kind, stage: step.stage, sub: "confirming", outcome: "unknown", hash, message: checked instanceof Error ? `${checked.message} Check the transaction before trying again.` : "Arc Testnet has not confirmed this yet. Check the transaction before trying again." }); return; }
      if (checked.status !== "CONFIRMED") { setRun({ kind, stage: step.stage, sub: "confirming", outcome: "failed", hash, message: checked.status === "REVERTED" ? "Arc Testnet rejected this transaction. Your funds did not move." : "This transaction did not do what was expected. Check it before trying again." }); refreshUsyc(); refreshWallet(); return; }
      if (step.stage !== "APPROVE") {
        const received = checked.receivedUsdcMinor;
        setRun({ kind, stage: "verified", sub: "confirming", outcome: "done", hash, receivedUsdcMinor: received });
        recordEarnActivity(kind === "DEPOSIT" ? "USYC pool deposit confirmed" : "USYC pool withdrawal confirmed", kind === "DEPOSIT" ? `${show(checked.depositedUsdcMinor ?? quote.amountMinor)} went into Hodd's USYC pool.` : `${show(received ?? "0")} came back from Hodd's USYC pool to the wallet.`, "The Arc Testnet receipt was checked against the pool, the wallet and the amount.");
        setAmount(""); refreshUsyc(); refreshWallet();
      }
    }
  };

  const open = Boolean(data?.executionEnabled && data.walletCanSign && position?.circle === "OK" && !readOnly && workspace.walletConnection);
  const canDeposit = open && !position?.depositsPaused && BigInt(position?.maxDepositUsdc ?? "0") > 0n;
  const canWithdraw = open && BigInt(position?.shares ?? "0") > 0n;
  const note = !data ? null : !position ? null : !data.walletCanSign ? "This wallet type cannot sign USYC pool transactions in Hodd yet. Use MetaMask, Rabby or a Circle Passkey wallet."
    : position.circle === "NOT_PERMITTED" ? "Waiting for Circle to enable Hodd's pool. Nothing can be deposited or withdrawn until it does; your balance stays yours."
    : position.circle === "PAUSED" ? "Circle has paused USYC for now. Your balance stays in the pool and can be withdrawn once it resumes."
    : !data.executionEnabled ? data.executionNote
    : position.depositsPaused ? "New deposits are paused by Hodd. Withdrawals still work."
    : null;
  const progress = run ? usycProgress(run) : null;
  // The typed amount against what the pool can take, so the capacity bar answers "will this fit?" while typing.
  const typed = Number(amount.replace(",", "."));
  const capacity = position ? Number(formatUnits(BigInt(position.maxDepositUsdc), 6)) : 0;
  const enteredRatio = amount.trim() !== "" && Number.isFinite(typed) && typed > 0 && capacity > 0 ? typed / capacity : null;

  return <SectionCard>
    <SectionHeading icon={<Coins className="size-4" />} title="USYC via Hodd's pool" action={<div className="flex items-center gap-2"><StatusPill label={!position ? (usycState.status === "ERROR" ? "Unavailable" : usycState.status === "READY" ? "Not live" : "Loading") : position.circle === "OK" ? "Circle enabled" : position.circle === "PAUSED" ? "Circle paused" : "Awaiting Circle"} tone={position?.circle === "OK" ? "success" : usycState.status === "ERROR" ? "danger" : position ? "warning" : "info"} /><InfoTip label="About this pool">Deposit and withdraw USDC only; the pool holds Circle&apos;s USYC. Your wallet signs every step. Deposits ask for an exact USDC approval, then the deposit; withdrawals pay USDC straight back to this wallet. Each transaction carries a 0.5% minimum so a price move cannot take more.</InfoTip></div>} />
    {!position ? <div role="status" className="p-5 text-sm leading-6 text-white/60">{usycState.status === "ERROR" ? usycState.message : usycState.status === "READY" ? "Hodd's USYC pool is not live on Arc Testnet yet. It opens once the pool contract is deployed and Circle enables it." : workspace.walletConnection ? "Loading the USYC pool…" : "Connect your wallet to see the USYC pool."}</div> : <PoolBody position={position} entered={enteredRatio} />}
    {position && <div className="border-t border-white/10 p-5">
      <label className={`block ${labelClass}`}>Amount (USDC)<input aria-label="USYC pool amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="1.00" disabled={busy} className={`${inputClass} mono`} /></label>
      <div className="mt-4 flex flex-wrap gap-2">
        <ConfirmButton onClick={() => void start("DEPOSIT")} disabled={!canDeposit || busy || !amount}>{busy && run?.kind === "DEPOSIT" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <ArrowDownToLine aria-hidden="true" className="size-4" />}Deposit</ConfirmButton>
        <ConfirmButton variant="ghost" onClick={() => void start("WITHDRAW")} disabled={!canWithdraw || busy || !amount}><ArrowUpFromLine aria-hidden="true" className="size-4" />Withdraw</ConfirmButton>
        <ConfirmButton variant="ghost" onClick={() => void start("WITHDRAW", true)} disabled={!canWithdraw || busy}>Withdraw all</ConfirmButton>
      </div>
      {note && <p role="note" className="mt-4 flex items-start gap-2 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs leading-5 text-[#ffd27f]"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>{note}</span></p>}
      {open && !hasSigner && <p role="note" className="mt-4 flex items-start gap-2 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs leading-5 text-[#ffd27f]"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>Signer session: reconnect required. Use “Reconnect signer” in the wallet panel first.</span></p>}
    </div>}
    {progress && run && <ProgressRail label={`${progress.verb} progress`} steps={progress.steps} active={progress.active} outcome={run.outcome} caption={progress.caption} link={run.hash ? { href: `${ARCSCAN_TX}${run.hash}`, text: "Open transaction" } : null} />}
  </SectionCard>;
}

function PoolBody({ position, entered }: { position: UsycPosition; entered: number | null }) {
  const cell = "bg-[#101319] p-4";
  const value = BigInt(position.valueUsdc);
  const withdrawable = value > 0n ? Number(BigInt(position.maxWithdrawUsdc)) / Number(value) : null;
  return <div className="grid grid-cols-1 gap-px bg-white/10 sm:grid-cols-[1.6fr_1fr_1fr]">
    <div className={`${cell} flex items-center gap-4`}>
      <Ring ratio={withdrawable} label="Withdrawable now, as a share of your balance" color={moneyColor.USYC} size={84} stroke={7}><span className="mono text-sm tabular-nums">{withdrawable === null ? "—" : `${Math.round(Math.min(withdrawable, 1) * 100)}%`}</span></Ring>
      <div className="min-w-0">
        <p className={labelClass}>Your balance</p>
        <p className="mono mt-1 text-lg">{show(position.valueUsdc)}</p>
        <p className="mt-0.5 text-[11px] text-white/50">≈ {formatUnits(BigInt(position.usycMinor), 6)} USYC</p>
        <p className={`${labelClass} mt-3`}>Withdrawable now</p>
        <p className="mono mt-1 text-sm" style={{ color: moneyColor.USYC }}>{show(position.maxWithdrawUsdc)}</p>
      </div>
    </div>
    <div className={cell}>
      <p className={labelClass}>Deposit up to</p>
      <p className="mono mt-2 text-lg">{formatMoney(usdc(position.maxDepositUsdc))}</p>
      <Meter ratio={entered} label="Typed amount against deposit capacity" className="mt-3" />
    </div>
    <div className={cell}>
      <p className={labelClass}>USYC price</p>
      <p className="mono mt-2 text-lg">{price(position.priceUsdcPerUsyc)}</p>
      {position.afterHoursPricing && <p className="mt-1 text-[11px] text-white/50">Deposits now buy at the next price ({price(position.subscribePriceUsdcPerUsyc)})</p>}
    </div>
  </div>;
}
