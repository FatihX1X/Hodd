"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Check, ChevronLeft, ChevronRight, LoaderCircle, Square, Trash2, X } from "lucide-react";
import type { HoddieResult } from "@/lib/hoddie/models";
import { useHoddie } from "./hoddie-provider";
import { HoddieDraft } from "./hoddie-draft";
import { AgentRequests } from "./agent-requests";

function Proposal({ proposal }: { proposal: NonNullable<HoddieResult["proposal"]> }) {
  const { confirm, dismiss, handled, busy } = useHoddie(); const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10_000); return () => window.clearInterval(timer); }, []);
  const expired = Date.parse(proposal.expiresAt) <= now; const used = handled.includes(proposal.handle);
  return <section className="mt-4 border border-[#0a52e8]/25 bg-[#eef2ff] p-4" aria-label="Change review">
    <p className="mono text-[10px] uppercase tracking-wider text-[#0a52e8]">{used ? "Review closed" : expired ? "Review expired" : "Your approval required"}</p>
    <h3 className="mt-2 break-words text-sm font-semibold">{proposal.summary}</h3>
    <ul className="mt-3 space-y-1 text-xs leading-5 text-black/65">{proposal.lines.map((line, index) => <li className="break-words" key={index}>{line}</li>)}</ul>
    <dl className="mt-4 grid gap-3 border-t border-black/10 pt-3 sm:grid-cols-3">{proposal.impact.map((item) => <div key={item.label}><dt className="text-[10px] text-black/60">{item.label}</dt><dd className="mono mt-1 break-words text-xs">{item.before} → {item.after}</dd></div>)}</dl>
    <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || used || expired} onClick={() => void confirm(proposal.handle)} className="flex min-h-11 items-center gap-2 bg-[#0b0b0d] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"><Check className="size-3.5" aria-hidden="true" />{proposal.kind === "PAYMENT_REQUEST" || proposal.kind === "EARN_REQUEST" ? "Save request for wallet review" : "Apply change"}</button><button disabled={busy || used} onClick={() => dismiss(proposal.handle)} className="flex min-h-11 items-center gap-2 border border-black/20 px-4 py-2.5 text-xs disabled:opacity-40"><X className="size-3.5" aria-hidden="true" />Reject</button></div>
    <p className="mt-3 text-[10px] text-black/60">Review expires {new Date(proposal.expiresAt).toLocaleTimeString()}. Applying a request does not send an onchain transaction.</p>
  </section>;
}
function Result({ result }: { result: HoddieResult }) {
  const { manual, busy } = useHoddie();
  return <div className="min-w-0">
    <p className="whitespace-pre-wrap text-sm leading-6">{result.message}</p>
    {result.interpretedBy && <p className="mt-2 text-[10px] text-black/60">Interpreted by {result.interpretedBy === "GEMINI" ? "Gemini" : "NVIDIA Nemotron"} · figures supplied by Hodd</p>}
    {result.source && <p className="mono mt-3 text-[10px] uppercase tracking-wider text-black/60">{result.source} · {result.observedAt ? new Date(result.observedAt).toLocaleString() : "No timestamp"} · Hodd treasury data</p>}
    <div className="mt-3 grid gap-3">{result.cards.map((card, index) => <section key={index} className="min-w-0 border border-black/15 p-4"><h3 className="text-sm font-semibold">{card.title}</h3><dl className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">{card.fields.map((field) => <div key={field.label} className="min-w-0"><dt className="text-[10px] text-black/60">{field.label}</dt><dd className="mono mt-1 break-all text-xs leading-5">{field.value}</dd></div>)}</dl></section>)}</div>
    {result.choices && <div className="mt-4 grid gap-2">{result.choices.map((choice) => <button key={choice.handle} disabled={busy} onClick={() => void manual({ mode: "SELECT", handle: choice.handle })} className="min-h-11 border border-black/20 p-3 text-left text-xs hover:bg-black/5 disabled:opacity-40">{choice.label}</button>)}</div>}
    {result.draft && <HoddieDraft draft={result.draft} />}{result.proposal && <Proposal proposal={result.proposal} />}
    {result.navigation && <Link href={result.navigation} className="mt-4 inline-flex min-h-11 items-center gap-2 border border-black/20 px-4 py-2.5 text-xs">Open {result.navigation === "/" ? "Portfolio" : result.navigation.slice(1)}<ChevronRight className="size-3.5" aria-hidden="true" /></Link>}
  </div>;
}
const examples = ["Summarize my treasury", "Can I pay tomorrow's bills?", "Show my allocation preview", "Create a 500 USDC obligation due tomorrow"];
export function HoddieWorkspace() {
  const state = useHoddie(); const [message, setMessage] = useState(""); const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [showRequests, setShowRequests] = useState(false);
  const wasBusy = useRef(false);
  useEffect(() => { if (wasBusy.current && !state.busy) inputRef.current?.focus(); wasBusy.current = state.busy; }, [state.busy]);
  const ready = state.providers.some((item) => item.ready);
  const enabled = state.allowed && state.signedIn && ready && state.workspaceScope === "TREASURY";
  const moveSuggestions = (direction: number) => suggestionsRef.current?.scrollBy({ left: direction * 240, behavior: "auto" });
  const submit = (event: React.FormEvent) => { event.preventDefault(); const value = message.trim(); if (!value || !enabled || state.busy) return; setMessage(""); void state.send(value); };
  return <div className="mx-auto w-full min-w-0 max-w-4xl px-3 py-4 md:px-6 md:py-6">
    <section className="flex min-w-0 flex-col border border-black/15 bg-[#fffdf7]" aria-label="Hoddie conversation">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-4 py-3 md:px-6"><div className="flex items-center gap-3"><Bot className="size-5 text-[#0a52e8]" aria-hidden="true" /><div><h1 className="text-xl font-semibold tracking-tight">Hoddie</h1><p className="text-[10px] text-black/60">Your treasury assistant · EN / TR</p></div></div><button disabled={state.busy} onClick={state.clear} className="inline-flex min-h-11 items-center gap-2 px-2 text-xs text-black/60 disabled:opacity-40"><Trash2 className="size-3.5" aria-hidden="true" />Clear chat</button></header>
        {!ready && state.providers.length > 0 && <p role="status" className="px-4 py-3 text-xs text-[#694813]">Command providers are not configured yet.</p>}
        {!state.signedIn ? <div className="m-4 border border-black/15 p-4"><p className="text-sm">Sign in to use your own main treasury with Hoddie.</p><Link href="/login" className="mt-3 inline-flex min-h-11 items-center bg-[#0b0b0d] px-4 py-2 text-xs text-white">Sign in</Link></div> : !state.allowed && <div className="m-4 border border-[#0a52e8]/20 bg-[#eef2ff] p-4"><h2 className="text-sm font-semibold">Allow command interpretation</h2><p className="mt-2 text-xs leading-5 text-black/65">Hoddie tries Google Gemini first, then OpenRouter’s free NVIDIA Nemotron endpoint if Gemini is unavailable. Only your masked command is shared, never account results or chat history. Free services have their own retention and training terms. Do not enter sensitive, personal or confidential information.</p><button disabled={state.busy || !ready} onClick={() => void state.accept()} className="mt-3 min-h-11 bg-[#0b0b0d] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Allow Hoddie for this session</button></div>}
        {state.workspaceScope !== "TREASURY" && <p role="status" className="m-5 border border-black/15 p-4 text-xs">Hoddie uses the main treasury only. Select Return to treasury in the workspace bar.</p>}
        <div role="log" aria-label="Conversation messages" aria-live="polite" className="min-h-[32svh] space-y-5 px-4 py-6 md:min-h-[42svh] md:px-6">
          {!state.messages.length && <div className="py-8 text-center"><p className="text-sm font-semibold">What can I help you with?</p><p className="mt-2 text-xs text-black/60">Ask in English or Turkish.</p></div>}
          {state.messages.map((item) => <article key={item.id} className={`min-w-0 ${item.role === "user" ? "ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-[#f0ede4] px-4 py-3" : "max-w-full"}`}><p className="mono mb-2 text-[10px] uppercase tracking-wider text-black/60">{item.role === "user" ? "You" : "Hoddie"}</p>{item.parts.map((part, index) => part.type === "text" ? <p key={index} className="whitespace-pre-wrap break-words text-sm leading-6">{part.text}</p> : part.type === "data-hoddie" ? <Result key={index} result={part.data} /> : null)}</article>)}
        </div>
        <div className="min-w-0 border-t border-black/10 px-2 pt-3 md:px-4">
          <div className="flex min-w-0 items-center gap-1"><button type="button" aria-label="Previous suggestions" aria-controls="hoddie-suggestions" onClick={() => moveSuggestions(-1)} className="flex size-11 shrink-0 items-center justify-center text-black/60 hover:bg-black/5"><ChevronLeft className="size-4" aria-hidden="true" /></button><div ref={suggestionsRef} id="hoddie-suggestions" role="region" aria-label="Suggested commands" tabIndex={0} className="flex min-w-0 flex-1 snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain py-1">{examples.map((example) => <button key={example} disabled={state.busy} onClick={() => { setMessage(example); inputRef.current?.focus(); }} className="min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border border-black/15 px-4 py-2 text-xs hover:border-[#0a52e8]/40 disabled:opacity-40">{example}</button>)}</div><button type="button" aria-label="Next suggestions" aria-controls="hoddie-suggestions" onClick={() => moveSuggestions(1)} className="flex size-11 shrink-0 items-center justify-center text-black/60 hover:bg-black/5"><ChevronRight className="size-4" aria-hidden="true" /></button></div>
        </div>
        <form onSubmit={submit} className="px-4 pb-4 pt-2 md:px-6"><label htmlFor="hoddie-command" className="sr-only">Your command</label><div className="flex items-end gap-2 rounded-2xl border border-black/20 bg-white p-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#0a52e8]"><textarea ref={inputRef} id="hoddie-command" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={2} placeholder="Ask Hoddie…" className="min-w-0 flex-1 resize-y bg-transparent px-2 py-2 text-sm leading-6 focus:outline-none" />{state.busy ? <button type="button" aria-label="Stop" onClick={() => void state.stop()} disabled={state.status !== "submitted" && state.status !== "streaming"} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-black/20 disabled:opacity-40"><Square className="size-3.5" aria-hidden="true" /></button> : <button aria-label="Send command" disabled={!enabled || !message.trim()} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0b0b0d] text-white disabled:opacity-35"><ArrowUp className="size-4" aria-hidden="true" /></button>}</div><p className="mt-2 text-center text-[10px] leading-4 text-black/60">Hodd supplies the figures. You approve changes. Never share secrets.</p></form>
        {state.busy && <p role="status" className="flex items-center gap-2 border-t border-black/10 px-5 py-3 text-xs text-black/60"><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{state.status === "submitted" ? "Interpreting your command…" : "Checking with Hodd…"}</p>}
        {state.issue && <p role="alert" className="break-words border-t border-[#9a433c]/25 bg-[#f5dedb] px-5 py-4 text-xs leading-5 text-[#7b332d]">{state.issue}</p>}
        {state.allowed && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 px-4 py-1 md:px-6"><span className="text-[10px] text-black/60">Gemini first · free Nemotron fallback · session only</span><button disabled={state.busy} onClick={() => void state.revoke()} className="min-h-11 text-[10px] text-black/60 disabled:opacity-40">Revoke permission</button></div>}
    </section>
    <details className="mt-3 border border-black/10" onToggle={(event) => setShowRequests(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer px-4 py-3 text-xs text-black/60">Wallet review requests</summary>{showRequests && <div className="px-3"><AgentRequests /></div>}</details>
  </div>;
}
