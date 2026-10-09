"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Fingerprint, LoaderCircle, LogIn, RefreshCw, ShieldCheck, Unplug, WalletCards, X } from "lucide-react";
import { ARC_TESTNET_EXPLORER_URL } from "@/lib/arc/constants";
import { formatDate } from "@/lib/treasury/format";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { connectCircleEmbeddedWallet, connectInjectedWallet, connectModularWallet, connectTestSigner, testSignerAvailable, type InjectedProvider } from "@/lib/wallet/connectors";
import { setActiveWalletRuntime, type ActiveWalletRuntime } from "@/lib/wallet/runtime";
import { useHasActiveSigner } from "@/lib/wallet/use-active-signer";
import { useWalletOwnership } from "@/lib/wallet/use-wallet-ownership";
import { MoneyValue, SectionCard, SectionHeading, StatusPill } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

const shortAddress = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;
const providerLabels = { CIRCLE_USER_CONTROLLED: "Circle Embedded", CIRCLE_MODULAR: "Circle Passkey", INJECTED_METAMASK: "MetaMask", INJECTED_RABBY: "Rabby", TEST_SIGNER: "Test signer (dev)" } as const;

export function WalletPanel() {
  const { workspaceScope, workspace, walletState, earnState, disconnectWallet, connectWallet, refreshWallet, refreshEarn, storageIssue } = useTreasuryWorkspace();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState(""); const [progress, setProgress] = useState(""); const [signedIn, setSignedIn] = useState(false);
  const connection = workspace.walletConnection;
  const [injectedProvider, setInjectedProvider] = useState<InjectedProvider | null>(null);
  // Dev-only: the server answers 404 unless its local test signer is fully enabled.
  const [testSignerAddress, setTestSignerAddress] = useState<string | null>(null);
  useEffect(() => { let active = true; void testSignerAvailable().then((address) => { if (active) setTestSignerAddress(address); }); return () => { active = false; }; }, []);
  const signingSession = useHasActiveSigner(connection);
  const liveExecution = earnState.status === "READY" && earnState.portfolio.integration.execution === "TESTNET_LIVE";
  const ownership = useWalletOwnership(connection, liveExecution);
  const verifyOwnership = async () => { setBusy("OWNERSHIP"); setError(""); try { await ownership.verify(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Wallet ownership could not be verified."); } finally { setBusy(null); } };
  const scopeLabel = workspaceScope === "SMOKE_TEST" ? "SMOKE-TEST workspace" : "MAIN treasury";
  const snapshot = walletState.status === "READY" ? walletState.snapshot : walletState.status === "ERROR" ? walletState.staleSnapshot : undefined;

  useEffect(() => {
    const client = createSupabaseBrowserClient(); if (!client) return;
    void client.auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
    const { data } = client.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session?.user)));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!injectedProvider || !connection) return;
    const invalidate = () => disconnectWallet();
    injectedProvider.on?.("accountsChanged", invalidate);
    injectedProvider.on?.("chainChanged", invalidate);
    return () => {
      injectedProvider.removeListener?.("accountsChanged", invalidate);
      injectedProvider.removeListener?.("chainChanged", invalidate);
    };
  }, [injectedProvider, connection, disconnectWallet]);

  const finish = (runtime: ActiveWalletRuntime) => { setActiveWalletRuntime(runtime); connectWallet(runtime.connection); setOpen(false); setBusy(null); setError(""); setProgress(""); };
  const run = async (name: string, action: () => Promise<ActiveWalletRuntime>) => {
    setBusy(name); setError(""); setProgress("");
    try { finish(await action()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The wallet could not be connected."); setBusy(null); }
  };
  const injected = async (kind: "METAMASK" | "RABBY") => {
    setBusy(kind); setError("");
    try { const result = await connectInjectedWallet(kind); setInjectedProvider(result.provider); finish(result.runtime); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The browser wallet could not be connected."); setBusy(null); }
  };

  // Signers are memory-only: reload, expiry and scope switches require re-authorizing the same provider.
  const reconnect = () => {
    if (!connection) return;
    if (connection.provider === "INJECTED_METAMASK" || connection.provider === "INJECTED_RABBY") return void injected(connection.provider === "INJECTED_RABBY" ? "RABBY" : "METAMASK");
    if (connection.provider === "CIRCLE_MODULAR") return void run("PASSKEY_LOGIN", () => connectModularWallet("LOGIN"));
    if (connection.provider === "TEST_SIGNER") return void run("TEST_SIGNER", connectTestSigner);
    return void run("CIRCLE", () => connectCircleEmbeddedWallet(setProgress));
  };

  if (connection) {
    return <SectionCard><SectionHeading index="01.0" title={providerLabels[connection.provider]} description={`${scopeLabel} · User-controlled ${connection.accountType} · Arc Testnet`} action={<StatusPill label={walletState.status === "READY" ? "LIVE" : walletState.status === "ERROR" ? "UNAVAILABLE" : "SYNCING"} tone={walletState.status === "READY" ? "success" : walletState.status === "ERROR" ? "danger" : "info"} />} />
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-end"><div><p className="text-[10px] uppercase tracking-[0.12em] text-white/50">{connection.label}</p><a href={`${ARC_TESTNET_EXPLORER_URL}/address/${connection.address}`} target="_blank" rel="noreferrer" className="mono mt-2 inline-flex items-center gap-2 text-sm font-semibold hover:text-[#8fb0ff]">{shortAddress(connection.address)} <ArrowUpRight className="size-3.5" /></a><div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/60"><span>Custody: user</span><span>Balance reads: enabled</span><span className={signingSession ? undefined : "font-semibold text-[#ff9a92]"}>Signer session: {signingSession ? "active" : "reconnect required"}</span><span>No shared treasury wallet</span>{ownership.status === "VERIFIED" && <span className="text-[#7fe3a8]">Ownership verified</span>}</div></div><div className="md:text-right"><p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Verified USDC balance</p>{snapshot ? <MoneyValue money={snapshot.balance} className={walletState.status === "ERROR" ? "mt-2 block text-2xl text-white/40" : "mt-2 block text-2xl"} /> : <p className="mono mt-2 text-lg text-white/50">Awaiting Arc…</p>}{snapshot && <p className="mt-2 text-[10px] text-white/50">{walletState.status === "ERROR" ? "Stale · excluded from calculations" : `Block ${snapshot.blockNumber} · ${formatDate(snapshot.observedAt, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`}</p>}</div></div>
      {!signingSession && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-t border-[#fab219]/30 bg-[#fab219]/10 px-5 py-3 text-xs text-[#ffd27f]"><p>Balances are live, but this wallet cannot sign until you reconnect it. Signers are kept only in memory and end on reload, expiry or workspace switch.</p><button disabled={Boolean(busy)} onClick={reconnect} className="inline-flex shrink-0 items-center gap-2 bg-[#f4f1e8] px-3 py-2 font-semibold text-[#0b0b0d] disabled:opacity-50">{busy ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="size-3.5" />}Reconnect signer</button></div>}
      {signingSession && ownership.status === "MISSING" && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-t border-[#5598e7]/30 bg-[#5598e7]/10 px-5 py-3 text-xs text-[#9ec5f4]"><p>Live testnet operations need a one-time, free signature proving this wallet is yours. It moves no funds.</p><button disabled={Boolean(busy)} onClick={() => void verifyOwnership()} className="inline-flex shrink-0 items-center gap-2 bg-[#f4f1e8] px-3 py-2 font-semibold text-[#0b0b0d] disabled:opacity-50">{busy === "OWNERSHIP" ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <ShieldCheck className="size-3.5" />}Verify wallet</button></div>}
      {(progress || (error && !open)) && <p role={error ? "alert" : "status"} className="border-t border-white/10 px-5 py-3 text-xs text-[#ff9a92]">{error || progress}</p>}
      {walletState.status === "ERROR" && <div role="alert" className="border-t border-[#ff9a92]/30 bg-[#d03b3b]/15 px-5 py-3 text-xs text-[#ff9a92]">{walletState.message} Treasury calculations are paused.</div>}
      <div className="flex flex-wrap justify-between gap-3 border-t border-white/10 px-5 py-4"><button onClick={() => { refreshWallet(); refreshEarn(); }} className="inline-flex items-center gap-2 border border-white/[0.14] px-3 py-2 text-xs font-semibold"><RefreshCw className="size-3.5" />Refresh</button><button onClick={disconnectWallet} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#ff9a92]"><Unplug className="size-3.5" />Disconnect</button></div>
    </SectionCard>;
  }

  const choiceClass = "flex min-h-40 flex-col items-start border border-white/[0.14] p-4 text-left hover:border-[#7fa6ff]/60 disabled:cursor-not-allowed disabled:opacity-40";
  return <SectionCard><SectionHeading index="01.0" title="Your treasury wallet" description={`${scopeLabel} · Choose one user-controlled wallet for this workspace`} action={<StatusPill label="NOT CONNECTED" />} /><div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="max-w-2xl"><p className="text-sm font-semibold">Funds stay in the wallet selected by the user.</p><p className="mt-2 text-xs leading-5 text-white/60">Hodd never pools balances into a shared developer wallet and never requests a seed phrase or private key.</p></div><Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setError(""); setProgress(""); setBusy(null); } }}><Dialog.Trigger asChild><button disabled={Boolean(storageIssue)} className="inline-flex shrink-0 items-center gap-2 bg-[#f4f1e8] px-4 py-3 text-sm font-semibold text-[#0b0b0d]"><WalletCards className="size-4" />Choose wallet</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="wallet-dialog-description" className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-[#101319] shadow-2xl focus:outline-none"><div className="flex items-center justify-between border-b border-white/[0.14] px-5 py-4"><div><p className="mono text-[9px] uppercase text-white/50">User-owned custody</p><Dialog.Title className="mt-1 text-lg font-semibold">Choose how to control your wallet</Dialog.Title></div><Dialog.Close aria-label="Close wallet dialog" className="grid size-10 place-items-center border border-white/[0.14]"><X className="size-4" /></Dialog.Close></div><Dialog.Description id="wallet-dialog-description" className="px-5 pt-5 text-sm leading-6 text-white/65">Each option creates one authoritative Arc Testnet wallet session. Hodd does not combine balances across providers.</Dialog.Description>
          <div className="grid gap-3 p-5 md:grid-cols-3"><div className={choiceClass}><Fingerprint className="size-5 text-[#8fb0ff]" /><h3 className="mt-4 text-sm font-semibold">Circle Passkey</h3><p className="mt-2 text-xs leading-5 text-white/60">Use Windows Hello, Face ID or a security key. No browser extension.</p><div className="mt-auto flex w-full gap-2 pt-4"><button disabled={Boolean(busy)} onClick={() => void run("PASSKEY_REGISTER", () => connectModularWallet("REGISTER"))} className="flex-1 bg-[#f4f1e8] px-3 py-2 text-xs text-[#0b0b0d]">Create</button><button disabled={Boolean(busy)} onClick={() => void run("PASSKEY_LOGIN", () => connectModularWallet("LOGIN"))} className="flex-1 border border-white/20 px-3 py-2 text-xs">Sign in</button></div></div>
            <div className={choiceClass}><ShieldCheck className="size-5 text-[#8fb0ff]" /><h3 className="mt-4 text-sm font-semibold">Circle Embedded</h3><p className="mt-2 text-xs leading-5 text-white/60">Sign in with Hodd, then approve wallet actions with Circle PIN.</p>{signedIn ? <button disabled={Boolean(busy)} onClick={() => void run("CIRCLE", () => connectCircleEmbeddedWallet(setProgress))} className="mt-auto w-full bg-[#f4f1e8] px-3 py-2 text-xs text-[#0b0b0d]">Connect embedded wallet</button> : <a href="/login" className="mt-auto inline-flex w-full items-center justify-center gap-2 border border-white/20 px-3 py-2 text-xs"><LogIn className="size-3.5" />Sign in first</a>}</div>
            <div className={choiceClass}><WalletCards className="size-5 text-[#8fb0ff]" /><h3 className="mt-4 text-sm font-semibold">Browser wallet</h3><p className="mt-2 text-xs leading-5 text-white/60">Use an existing MetaMask or Rabby account and approve in the extension.</p><div className="mt-auto flex w-full gap-2 pt-4"><button disabled={Boolean(busy)} onClick={() => void injected("METAMASK")} className="flex-1 bg-[#f4f1e8] px-3 py-2 text-xs text-[#0b0b0d]">MetaMask</button><button disabled={Boolean(busy)} onClick={() => void injected("RABBY")} className="flex-1 border border-white/20 px-3 py-2 text-xs">Rabby</button></div></div></div>
          {testSignerAddress && <div className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 border border-dashed border-[#fab219]/30 bg-[#fab219]/10 p-4 text-xs text-[#ffd27f]"><div><p className="font-semibold">Test signer (local development only)</p><p className="mono mt-1 break-all">{testSignerAddress}</p><p className="mt-1">Key held by this dev server. Earn only. Evidence is recorded as TEST_SIGNER and never counts for MetaMask, Rabby or Circle.</p></div><button disabled={Boolean(busy)} onClick={() => void run("TEST_SIGNER", connectTestSigner)} className="shrink-0 border border-white/20 bg-[#0b0b0d] text-[#f4f1e8] px-3 py-2 font-semibold">Use test signer</button></div>}
          {(busy || progress) && <div role="status" className="mx-5 mb-5 flex items-center gap-2 border border-[#5598e7]/30 bg-[#5598e7]/10 p-3 text-xs text-[#9ec5f4]">{busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}{progress || "Waiting for wallet approval…"}</div>}{error && <p role="alert" className="mx-5 mb-5 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92]">{error}</p>}<p className="mx-5 mb-5 text-[10px] leading-4 text-white/50">Never enter an API key, entity secret, recovery file, seed phrase or private key into Hodd.</p>
        </Dialog.Content></Dialog.Portal></Dialog.Root></div></SectionCard>;
}
