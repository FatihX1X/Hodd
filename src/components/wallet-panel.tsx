"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, RefreshCw, Unplug, WalletCards, X } from "lucide-react";
import { ARC_TESTNET_EXPLORER_URL } from "@/lib/arc/constants";
import { formatDate } from "@/lib/treasury/format";
import { MoneyValue, SectionCard, SectionHeading, StatusPill } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

const inputClass = "mt-2 w-full border border-black/20 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#164b32]";
const shortAddress = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;

export function WalletPanel() {
  const { workspace, walletState, earnState, connectWallet, disconnectWallet, refreshWallet, refreshEarn, storageIssue } = useTreasuryWorkspace();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("Treasury wallet");
  const [provider, setProvider] = useState<"CIRCLE_AGENT_WALLET_READ_ONLY" | "CIRCLE_DEVELOPER_CONTROLLED_WALLET">("CIRCLE_DEVELOPER_CONTROLLED_WALLET");
  const [error, setError] = useState("");
  const connection = workspace.walletConnection;
  const snapshot = walletState.status === "READY" ? walletState.snapshot : walletState.status === "ERROR" ? walletState.staleSnapshot : undefined;
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try { connectWallet(address, label, provider); setOpen(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The wallet address is invalid."); }
  };

  if (connection) {
    const developerWallet = connection.provider === "CIRCLE_DEVELOPER_CONTROLLED_WALLET";
    const execution = developerWallet && earnState.status === "READY" ? earnState.portfolio.integration.execution : "READ_ONLY";
    return <SectionCard>
    <SectionHeading index="01.0" title={developerWallet ? "Circle Developer-Controlled Wallet" : "Circle Agent Wallet"} description={`Public Arc Testnet address · ${execution === "LOCAL_ENABLED" ? "local execution enabled" : "read-only"}`} action={<StatusPill label={walletState.status === "READY" ? "LIVE" : walletState.status === "ERROR" ? "UNAVAILABLE" : "SYNCING"} tone={walletState.status === "READY" ? "success" : walletState.status === "ERROR" ? "danger" : "info"} />} />
    <div className="grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <p className="text-[10px] uppercase tracking-[0.12em] text-black/40">{connection.label}</p>
        <a href={`${ARC_TESTNET_EXPLORER_URL}/address/${connection.address}`} target="_blank" rel="noreferrer" className="mono mt-2 inline-flex items-center gap-2 text-sm font-semibold hover:text-[#164b32]">{shortAddress(connection.address)} <ArrowUpRight className="size-3.5" aria-hidden="true" /></a>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-black/50"><span>Arc Testnet · 5042002</span><span>Read balance: enabled</span><span>Signing: {execution === "LOCAL_ENABLED" ? "server-only" : "disabled"}</span><span>Execution: {execution === "LOCAL_ENABLED" ? "local only" : "disabled"}</span></div>
      </div>
      <div className="md:text-right">
        <p className="text-[10px] uppercase tracking-[0.12em] text-black/40">Verified USDC balance</p>
        {snapshot ? <MoneyValue money={snapshot.balance} className={walletState.status === "ERROR" ? "mt-2 block text-2xl text-black/35" : "mt-2 block text-2xl"} /> : <p className="mono mt-2 text-lg text-black/40">Awaiting Arc…</p>}
        {snapshot && <p className="mt-2 text-[10px] text-black/40">{walletState.status === "ERROR" ? "Stale · excluded from calculations" : `Block ${snapshot.blockNumber} · ${formatDate(snapshot.observedAt, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`}</p>}
      </div>
    </div>
    {walletState.status === "ERROR" && <div role="alert" className="border-t border-[#9a433c]/20 bg-[#f5dedb] px-5 py-3 text-xs text-[#7b332d]">{walletState.message} Treasury calculations and allocation preview are paused.</div>}
    <div className="flex flex-wrap justify-between gap-3 border-t border-black/10 px-5 py-4">
      <button onClick={() => { refreshWallet(); refreshEarn(); }} className="inline-flex items-center gap-2 border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5"><RefreshCw className="size-3.5" aria-hidden="true" />Refresh balance & Earn</button>
      <button onClick={disconnectWallet} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#7b332d] hover:bg-[#f5dedb]"><Unplug className="size-3.5" aria-hidden="true" />Disconnect from Hodd</button>
    </div>
  </SectionCard>;
  }

  return <SectionCard>
    <SectionHeading index="01.0" title="Treasury wallet" description="Link an Arc Testnet public address" action={<StatusPill label="NOT CONNECTED" />} />
    <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-2xl"><p className="text-sm font-semibold">Move from demo balance to verified Arc Testnet USDC.</p><p className="mt-2 text-xs leading-5 text-black/50">Hodd stores only the public address in the browser. Developer wallet credentials remain in the local server environment and are never returned to the client.</p></div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild><button disabled={Boolean(storageIssue)} className="inline-flex shrink-0 items-center justify-center gap-2 bg-[#0b0d0c] px-4 py-3 text-sm font-semibold text-white hover:bg-[#242824] disabled:opacity-40"><WalletCards className="size-4" aria-hidden="true" />Connect wallet</button></Dialog.Trigger>
        <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="wallet-dialog-description" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-[#fffdf7] shadow-2xl focus:outline-none"><div className="flex items-center justify-between border-b border-black/15 px-5 py-4"><div><p className="mono text-[9px] uppercase text-black/40">Stage 4 · explicit custody</p><Dialog.Title className="mt-1 text-lg font-semibold">Connect treasury wallet</Dialog.Title></div><Dialog.Close aria-label="Close wallet dialog" className="grid size-10 place-items-center border border-black/15"><X className="size-4" /></Dialog.Close></div>
          <Dialog.Description id="wallet-dialog-description" className="px-5 pt-5 text-sm leading-6 text-black/55">Paste only the public ARC-TESTNET address. Never paste an OTP, API key, entity secret, recovery file, seed phrase or private key into Hodd.</Dialog.Description>
          <div className="mx-5 mt-5 border border-black/15 bg-black/[0.03] p-4"><p className="text-xs font-semibold">Developer wallet setup</p><p className="mt-2 text-xs leading-5 text-black/50">For local Earn execution, the address must match <code className="mono">CIRCLE_WALLET_ADDRESS</code> in <code className="mono">.env.local</code>.</p><a href="https://developers.circle.com/wallets/dev-controlled/create-your-first-wallet" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#164b32]">Official wallet guide <ArrowUpRight className="size-3" /></a></div>
          <form onSubmit={submit} className="space-y-4 p-5"><fieldset><legend className="text-[10px] font-semibold uppercase tracking-[0.1em] text-black/50">Wallet authority</legend><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="border border-black/15 p-3 text-xs"><input type="radio" name="provider" checked={provider === "CIRCLE_DEVELOPER_CONTROLLED_WALLET"} onChange={() => setProvider("CIRCLE_DEVELOPER_CONTROLLED_WALLET")} className="mr-2" />Developer-controlled</label><label className="border border-black/15 p-3 text-xs"><input type="radio" name="provider" checked={provider === "CIRCLE_AGENT_WALLET_READ_ONLY"} onChange={() => setProvider("CIRCLE_AGENT_WALLET_READ_ONLY")} className="mr-2" />Agent wallet · read-only</label></div></fieldset><label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-black/50">Wallet label<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} className={inputClass} /></label><label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-black/50">Public Arc Testnet address<input aria-label="Public Arc Testnet address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} className={`${inputClass} mono`} /></label>{error && <p role="alert" className="border border-[#9a433c]/20 bg-[#f5dedb] p-3 text-xs text-[#7b332d]">{error}</p>}<div className="border border-[#456c9c]/20 bg-[#dfe9f5] p-3 text-xs leading-5 text-[#294e7c]">Balance reads are always public. Signing is server-only and available exclusively for a matching Developer-Controlled Wallet under local development.</div><button className="w-full bg-[#0b0d0c] px-5 py-4 text-sm font-semibold text-white hover:bg-[#242824]">Link public address</button></form>
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
    </div>
  </SectionCard>;
}
