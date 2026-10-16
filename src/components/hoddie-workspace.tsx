"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarClock, Check, ChevronLeft, ChevronRight, Clock, Hourglass, LoaderCircle, ShieldCheck, Sparkles, Square, Trash2, TrendingUp, Wallet, X, type LucideIcon } from "lucide-react";
import type { HoddieResult } from "@/lib/hoddie/models";
import { useHoddie } from "./hoddie-provider";
import { HoddieDraft } from "./hoddie-draft";
import { AgentRequests } from "./agent-requests";
import { SectionCard, SectionHeading, StatusPill, buttonClass, labelClass } from "./primitives";
import { Ring, moneyColor } from "./visuals";
import { Tip } from "./tip";

function Proposal({ proposal }: { proposal: NonNullable<HoddieResult["proposal"]> }) {
  const { confirm, dismiss, handled, busy } = useHoddie(); const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10_000); return () => window.clearInterval(timer); }, []);
  const expired = Date.parse(proposal.expiresAt) <= now; const used = handled.includes(proposal.handle);
  return <section className="mt-4 border border-[#7fa6ff]/30 bg-[#4678ff]/10 p-4" aria-label="Change review">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#9ec5f4]"><ShieldCheck aria-hidden="true" className="size-3.5" />{used ? "Review closed" : expired ? "Review expired" : "Your approval required"}</p>
      <p className="inline-flex items-center gap-1.5 text-[12px] text-white/55"><Clock aria-hidden="true" className="size-3" />Review expires {new Date(proposal.expiresAt).toLocaleTimeString()}</p>
    </div>
    <h3 className="mt-3 break-words text-sm font-semibold">{proposal.summary}</h3>
    <ul className="mt-3 space-y-1 text-xs leading-5 text-white/75">{proposal.lines.map((line, index) => <li className="break-words" key={index}>{line}</li>)}</ul>
    <dl className="mt-4 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-3">{proposal.impact.map((item) => <div key={item.label} className="min-w-0"><dt className="text-[12px] text-white/55">{item.label}</dt><dd className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"><span className="mono break-words text-xs tabular-nums text-white/55 line-through decoration-white/30">{item.before}<span className="sr-only"> before</span></span><ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-white/40" /><span className="mono break-words text-base font-medium tabular-nums text-[#f4f1e8]">{item.after}<span className="sr-only"> after</span></span></dd></div>)}</dl>
    <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || used || expired} onClick={() => void confirm(proposal.handle)} className={buttonClass.primary}><Check className="size-3.5" aria-hidden="true" />{proposal.kind === "PAYMENT_REQUEST" || proposal.kind === "EARN_REQUEST" ? "Save request for wallet review" : "Apply change"}</button><button disabled={busy || used} onClick={() => dismiss(proposal.handle)} className={buttonClass.ghost}><X className="size-3.5" aria-hidden="true" />Reject</button></div>
    <p className="mt-3 text-[12px] leading-5 text-white/55">Applying a request does not send an onchain transaction.</p>
  </section>;
}
/** A value that is mainly a number (an amount, a date, a count) reads as a figure; anything longer reads as text. */
const isFigure = (value: string) => /\d/.test(value) && value.length <= 28;
const percentOf = (value: string) => { const match = /^(\d+(?:\.\d+)?)\s*%$/.exec(value.trim()); return match ? Number(match[1]) / 100 : null; };
const sourceTone = { LIVE: "success", PARTIAL: "warning", NOT_CONNECTED: "neutral" } as const;

/** One answer card: each field is a tile with its figure set large; percentages also get a small ring. */
function AnswerCard({ card }: { card: HoddieResult["cards"][number] }) {
  return <SectionCard className="min-w-0 p-4"><h3 className="text-sm font-semibold">{card.title}</h3>
    <dl className="mt-3 grid gap-x-5 gap-y-4 sm:grid-cols-2">{card.fields.map((field, index) => {
      const figure = isFigure(field.value), ratio = percentOf(field.value);
      return <div key={field.label + index} className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0"><dt className="text-[12px] leading-4 text-white/55">{field.label}</dt><dd className={figure ? "mono mt-1 break-words text-lg font-medium leading-6 tabular-nums tracking-[-0.02em]" : "mt-1 break-words text-xs leading-5 text-white/80"}>{field.value}</dd></div>
        {ratio !== null && <Ring ratio={ratio} label={field.label} size={40} stroke={4} color={moneyColor.deployable} />}
      </div>;
    })}</dl>
  </SectionCard>;
}
function Result({ result }: { result: HoddieResult }) {
  const { manual, send, busy } = useHoddie();
  // The reply's language drives correct casing in the reply (Turkish dotted İ); status words are English.
  return <div className="min-w-0" lang={result.language}>
    <p className="whitespace-pre-wrap text-sm leading-6">{result.message}</p>
    {result.status && <div className="mt-3"><StatusPill {...result.status} /></div>}
    {result.source && <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/55"><span lang="en"><StatusPill label={result.source.replaceAll("_", " ")} tone={sourceTone[result.source]} /></span><span className="inline-flex items-center gap-1.5"><Clock aria-hidden="true" className="size-3" />{result.observedAt ? new Date(result.observedAt).toLocaleString() : "No timestamp"}</span><span>Hodd treasury data</span></p>}
    <div className="mt-3 grid gap-3">{result.cards.map((card, index) => <AnswerCard key={index} card={card} />)}</div>
    {result.sources && <nav aria-label="Answer sources" className="mt-3 flex flex-wrap gap-x-4 gap-y-1">{result.sources.map((source) => <Link key={source.href} href={source.href} className="inline-flex min-h-8 items-center text-xs text-[#9ec5f4] underline underline-offset-4">{source.label}</Link>)}</nav>}
    {result.followUps && <div className="mt-3 flex flex-wrap gap-2">{result.followUps.map((question) => <button key={question} disabled={busy} onClick={() => void send(question)} className="min-h-11 rounded-full border border-white/[0.14] px-4 py-2 text-left text-xs hover:border-[#7fa6ff]/60 disabled:opacity-40">{question}</button>)}</div>}
    {result.choices && <div className="mt-4 grid gap-2">{result.choices.map((choice) => <button key={choice.handle} disabled={busy} onClick={() => void manual({ mode: "SELECT", handle: choice.handle })} className="min-h-11 border border-white/25 p-3 text-left text-xs hover:bg-white/[0.05] disabled:opacity-40">{choice.label}</button>)}</div>}
    {result.draft && <HoddieDraft draft={result.draft} />}{result.proposal && <Proposal proposal={result.proposal} />}
    {result.navigation && <Link href={result.navigation} className={`mt-4 ${buttonClass.ghost}`}>Open {result.navigation === "/" ? "Portfolio" : result.navigation.slice(1)}<ChevronRight className="size-3.5" aria-hidden="true" /></Link>}
  </div>;
}
/** Always-there shortcuts above the composer; they fill the box and never send. */
const examples = ["Summarize my treasury", "Can I pay tomorrow's bills?", "Show my allocation preview", "Create a 500 USDC obligation due tomorrow"];
/** The empty chat's starting points, one per kind of question. */
const topics: readonly { Icon: LucideIcon; label: string; question: string }[] = [
  { Icon: Wallet, label: "Balance", question: "What is my balance?" },
  { Icon: CalendarClock, label: "Bills", question: "What is due this week?" },
  { Icon: TrendingUp, label: "Investing", question: "How much can I safely invest?" },
  { Icon: Hourglass, label: "Runway", question: "How long will my cash last?" },
];
const BOTTOM_SLACK = 80;
const distanceFromEnd = (log: HTMLElement) => log.scrollHeight - log.scrollTop - log.clientHeight;
function scrollToEnd(log: HTMLElement | null, smooth = true) {
  if (!log) return;
  log.scrollTo({ top: log.scrollHeight, behavior: smooth && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
}
export function HoddieWorkspace() {
  const state = useHoddie(); const [message, setMessage] = useState(""); const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [showRequests, setShowRequests] = useState(false);
  const wasBusy = useRef(false);
  useEffect(() => { if (wasBusy.current && !state.busy) inputRef.current?.focus(); wasBusy.current = state.busy; }, [state.busy]);
  // The log scrolls inside the panel: follow new content only while the reader is at the end, otherwise offer a jump.
  const logRef = useRef<HTMLDivElement>(null); const pinned = useRef(true); const lastTop = useRef(0); const seen = useRef(-1);
  const [showJump, setShowJump] = useState(false);
  if (!state.messages.length && showJump) setShowJump(false);
  useEffect(() => {
    const count = state.messages.length; const first = seen.current < 0; const sent = count > seen.current && state.messages[count - 1]?.role === "user"; seen.current = count;
    if (!count) { pinned.current = true; lastTop.current = 0; return; }
    if (pinned.current || sent) { pinned.current = true; scrollToEnd(logRef.current, !first); }
  }, [state.messages]);
  const onLogScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const log = event.currentTarget; const up = log.scrollTop < lastTop.current; lastTop.current = log.scrollTop;
    // Only an upward move unpins, so our own smooth scroll (which passes through "far" positions) cannot flash the button.
    if (distanceFromEnd(log) <= BOTTOM_SLACK) { pinned.current = true; setShowJump(false); } else if (up) { pinned.current = false; setShowJump(true); }
  };
  const jumpToLatest = () => { pinned.current = true; setShowJump(false); scrollToEnd(logRef.current); logRef.current?.focus({ preventScroll: true }); };
  const ready = state.providers.some((item) => item.ready);
  const enabled = state.workspaceScope === "TREASURY";
  const moveSuggestions = (direction: number) => suggestionsRef.current?.scrollBy({ left: direction * 240, behavior: "auto" });
  const submit = (event: React.FormEvent) => { event.preventDefault(); const value = message.trim(); if (!value || !enabled || state.busy) return; setMessage(""); void state.send(value); };
  return <div className="mx-auto w-full min-w-0 max-w-6xl">
    <section className="flex min-w-0 flex-col border border-white/[0.14] bg-[#101319]" aria-label="Hoddie conversation">
        <SectionHeading icon={<Sparkles aria-hidden="true" className="size-4" />} title="Treasury conversation" action={<button disabled={state.busy} onClick={state.clear} className="inline-flex min-h-11 shrink-0 items-center gap-2 px-2 text-xs text-white/55 disabled:opacity-40"><Trash2 className="size-3.5" aria-hidden="true" />Clear chat</button>} />
        <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-5 py-2"><div role="status"><StatusPill label="Treasury engine" tone="info" /></div><Tip label="About the Treasury Engine">Engine answers come straight from your treasury figures and need no command interpretation. Changes always need your review.</Tip></div>
        {(!state.signedIn ? <div className="m-4 border border-white/[0.14] p-4"><p className="text-sm">Sign in to prepare changes for your own treasury.</p><Link href="/login" className={`mt-3 ${buttonClass.primary}`}>Sign in</Link></div> : !state.allowed && <div className="m-4 border border-[#7fa6ff]/30 bg-[#4678ff]/10 p-4"><h2 className="text-sm font-semibold">Allow command interpretation</h2><p className="mt-2 text-xs leading-5 text-white/75">Only your latest masked command is shared with external free interpretation services, never account results or chat history. These services have their own retention and training terms. Do not enter sensitive, personal or confidential information.</p><button disabled={state.busy || !ready} onClick={() => void state.accept()} className={`mt-3 ${buttonClass.primary}`}>Allow Hoddie for this session</button>{!ready && <p className="mt-2 text-xs text-white/55">Command interpretation is unavailable. Treasury Engine answers still work.</p>}</div>)}
        {state.workspaceScope !== "TREASURY" && <p role="status" className="m-5 border border-white/[0.14] p-4 text-xs">Hoddie uses the main treasury only. Select Return to treasury in the workspace bar.</p>}
        <div className="relative">
          <div ref={logRef} onScroll={onLogScroll} role="log" aria-label="Conversation messages" aria-live="polite" tabIndex={0} className="h-[58svh] min-h-80 space-y-5 overflow-y-auto overscroll-contain px-4 py-6 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#7fa6ff] md:h-[min(62svh,760px)] md:px-6">
            {!state.messages.length && <div className="py-6 text-center">
              <span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-full border border-[#7fa6ff]/40 text-[#7fa6ff]"><Sparkles className="size-5" /></span>
              <p className="disp mt-4 text-base">What can I help you with?</p>
              <ul aria-label="Questions to start with" className="mx-auto mt-5 flex max-w-xl flex-wrap justify-center gap-2">{topics.map(({ Icon, label, question }) => <li key={label}><button type="button" disabled={state.busy} onClick={() => { setMessage(question); inputRef.current?.focus(); }} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/[0.14] px-4 py-2 text-left text-xs hover:border-[#7fa6ff]/60 disabled:opacity-40"><Icon aria-hidden="true" className="size-3.5 shrink-0 text-[#7fa6ff]" />{question}</button></li>)}</ul>
            </div>}
            {state.messages.map((item) => <article key={item.id} className={`min-w-0 ${item.role === "user" ? "ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-white/[0.06] px-4 py-3" : "max-w-full"}`}><p className={`mb-2 ${labelClass}`}>{item.role === "user" ? "You" : "Hoddie"}</p>{item.parts.map((part, index) => part.type === "text" ? <p key={index} className="whitespace-pre-wrap break-words text-sm leading-6">{part.text}</p> : part.type === "data-hoddie" ? <Result key={index} result={part.data} /> : null)}</article>)}
          </div>
          {showJump && <button type="button" onClick={jumpToLatest} className="absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-white/25 bg-[#0b0b0d] px-4 text-xs text-[#f4f1e8] shadow-lg shadow-black/40 hover:bg-[#15151a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7fa6ff]"><ArrowDown className="size-3.5" aria-hidden="true" />Jump to latest</button>}
        </div>
        <div className="min-w-0 border-t border-white/10 px-2 pt-3 md:px-4">
          <div className="flex min-w-0 items-center gap-1"><button type="button" aria-label="Previous suggestions" aria-controls="hoddie-suggestions" onClick={() => moveSuggestions(-1)} className="flex size-11 shrink-0 items-center justify-center text-white/55 hover:bg-white/[0.05]"><ChevronLeft className="size-4" aria-hidden="true" /></button><div ref={suggestionsRef} id="hoddie-suggestions" role="region" aria-label="Suggested commands" tabIndex={0} className="flex min-w-0 flex-1 snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain py-1">{examples.map((example) => <button key={example} disabled={state.busy} onClick={() => { setMessage(example); inputRef.current?.focus(); }} className="min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border border-white/[0.14] px-4 py-2 text-xs hover:border-[#7fa6ff]/60 disabled:opacity-40">{example}</button>)}</div><button type="button" aria-label="Next suggestions" aria-controls="hoddie-suggestions" onClick={() => moveSuggestions(1)} className="flex size-11 shrink-0 items-center justify-center text-white/55 hover:bg-white/[0.05]"><ChevronRight className="size-4" aria-hidden="true" /></button></div>
        </div>
        <form onSubmit={submit} className="px-4 pb-4 pt-2 md:px-6"><label htmlFor="hoddie-command" className="sr-only">Your command</label><div className="flex items-end gap-2 rounded-2xl border border-white/25 bg-[#0b0b0d] p-2 text-[#f4f1e8] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#7fa6ff]"><textarea ref={inputRef} id="hoddie-command" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={2} placeholder="Ask Hoddie…" className="min-w-0 flex-1 resize-y bg-transparent px-2 py-2 text-sm leading-6 placeholder:text-white/35 focus:outline-none" />{state.busy ? <button type="button" aria-label="Stop" onClick={() => void state.stop()} disabled={state.status !== "submitted" && state.status !== "streaming"} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/25 disabled:opacity-40"><Square className="size-3.5" aria-hidden="true" /></button> : <button aria-label="Send command" disabled={!enabled || !message.trim()} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#f4f1e8] text-[#0b0b0d] transition-colors hover:bg-white disabled:opacity-35"><ArrowUp className="size-4" aria-hidden="true" /></button>}</div><p className="mt-2 text-center text-[12px] leading-4 text-white/55">Hodd supplies the figures. You approve changes. Never share secrets.</p></form>
        {state.busy && <p role="status" className="flex items-center gap-2 border-t border-white/10 px-5 py-3 text-xs text-white/55"><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{state.status === "submitted" ? "Interpreting your command…" : "Checking with Hodd…"}</p>}
        {state.issue && <p role="alert" className="break-words border-t border-[#ff9a92]/30 bg-[#d03b3b]/15 px-5 py-4 text-xs leading-5 text-[#ff9a92]">{state.issue}</p>}
        {state.allowed && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-1 md:px-6"><span className="text-[12px] text-white/55">Command interpretation allowed for this session</span><button disabled={state.busy} onClick={() => void state.revoke()} className="min-h-11 text-[12px] text-white/55 underline-offset-4 hover:text-white hover:underline disabled:opacity-40">Revoke permission</button></div>}
    </section>
    {state.signedIn && <details className="mt-3 border border-white/10" onToggle={(event) => setShowRequests(event.currentTarget.open)}><summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-3 text-xs text-white/55"><Wallet aria-hidden="true" className="size-3.5" />Wallet review requests</summary>{showRequests && <div className="px-3"><AgentRequests /></div>}</details>}
  </div>;
}
