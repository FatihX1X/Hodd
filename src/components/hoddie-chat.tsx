"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUp, RotateCcw } from "lucide-react";
import clsx from "clsx";
import { MoneyValue, SectionCard, SectionHeading, StatusPill, buttonClass, labelClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { answerQuestion, starterPrompts, type HoddieContext, type HoddieReply } from "@/lib/hoddie/answers";
import { formatDate } from "@/lib/treasury/format";

type Message = Readonly<{ id: string; role: "user" | "hoddie"; at: number; text?: string; reply?: HoddieReply }>;
type Responder = (context: HoddieContext) => HoddieReply | Promise<HoddieReply>;

const STORAGE_KEY = "hodd.hoddie.chat.v1";
const MAX_LENGTH = 500;
const MIN_THINKING_MS = 450;
const time = (at: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at);

function load(): Message[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is Message => Boolean(item) && typeof item.id === "string" && (item.role === "user" || item.role === "hoddie") && typeof item.at === "number").slice(-60) : [];
  } catch { return []; }
}
function save(messages: readonly Message[]) { try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60))); } catch { /* the conversation simply is not kept */ } }

function Mark({ className = "size-9" }: { className?: string }) {
  return <span aria-hidden="true" className={clsx("grid shrink-0 place-items-center border border-white/[0.14] bg-[#0b0b0d]", className)}><Image src="/brand/hodd-star.png" alt="" width={160} height={160} className="size-[70%]" /></span>;
}

function ReplyBody({ reply, onFollowUp, canAsk }: { reply: HoddieReply; onFollowUp: (question: string) => void; canAsk: boolean }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm leading-6">{reply.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      {reply.status && <StatusPill label={reply.status.label} tone={reply.status.tone} />}
      {reply.facts && reply.facts.length > 0 && (
        <dl className="divide-y divide-white/10 border border-white/[0.14] bg-[#0b0b0d]">
          {reply.facts.map((fact) => (
            <div key={`${fact.label}-${fact.value}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3.5 py-2.5">
              <dt className={labelClass}>{fact.label}</dt><dd className="mono text-xs tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={labelClass}>From</span>
        {reply.sources.map((source) => <Link key={source.href} href={source.href} className="mono border-b border-white/30 pb-0.5 text-[10px] uppercase tracking-[0.12em] text-[#c9cbd3] hover:border-[#7fa6ff] hover:text-white">{source.label}</Link>)}
      </div>
      {reply.followUps.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {reply.followUps.map((question) => <button key={question} type="button" disabled={!canAsk} onClick={() => onFollowUp(question)} className="border border-white/25 px-3 py-2 text-left text-xs text-[#c9cbd3] transition hover:border-[#7fa6ff] hover:text-white disabled:opacity-40">{question}</button>)}
        </div>
      )}
    </div>
  );
}

function Thinking() {
  return (
    <div role="status" aria-label="Hoddie is thinking" className="flex items-start gap-3">
      <Mark className="size-8" />
      <div className="flex h-8 items-center gap-1.5 border border-white/[0.14] bg-white/[0.04] px-3.5">
        {[0, 1, 2].map((index) => <span key={index} aria-hidden="true" className="size-1.5 bg-[#7fa6ff] motion-safe:animate-pulse" style={{ animationDelay: `${index * 160}ms` }} />)}
      </div>
    </div>
  );
}

/** Conversation with Hoddie. `respond` is the only source of replies, so it can be swapped without touching the interface. */
export function HoddieChat({ respond = answerQuestion }: { respond?: Responder }) {
  const { operationalWorkspace, workspace, assessment, hydrated } = useTreasuryWorkspace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const live = useRef({ operationalWorkspace, workspace, assessment, respond });
  useEffect(() => { live.current = { operationalWorkspace, workspace, assessment, respond }; });

  useEffect(() => { const timer = window.setTimeout(() => { setMessages(load()); setRestored(true); }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { if (restored) save(messages); }, [messages, restored]);
  useEffect(() => { const list = listRef.current; if (list) list.scrollTop = messages.length === 0 && !busy ? 0 : list.scrollHeight; }, [messages, busy]);

  const ask = useCallback(async (raw: string) => {
    const question = raw.trim().slice(0, MAX_LENGTH);
    if (!question || busy) return;
    const now = Date.now();
    setMessages((current) => [...current, { id: `u-${now}`, role: "user", at: now, text: question }]);
    setDraft(""); setBusy(true);
    const { operationalWorkspace: engineWorkspace, workspace: shownWorkspace, assessment: engineAssessment, respond: answer } = live.current;
    const started = Date.now();
    let reply: HoddieReply;
    try { reply = await answer({ question, workspace: engineWorkspace ?? shownWorkspace, assessment: engineWorkspace ? engineAssessment : null, evaluatedAt: new Date(engineAssessment?.evaluatedAt ?? Date.now()) }); }
    catch { reply = { paragraphs: ["I could not answer that just now. Nothing was changed. Please try again."], status: { label: "UNAVAILABLE", tone: "danger" }, sources: [], followUps: [] }; }
    await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, MIN_THINKING_MS - (Date.now() - started))));
    const done = Date.now();
    setMessages((current) => [...current, { id: `h-${done}`, role: "hoddie", at: done, reply }]);
    setBusy(false);
    inputRef.current?.focus();
  }, [busy]);

  const submit = (event: React.FormEvent) => { event.preventDefault(); void ask(draft); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(draft); } };
  const reset = () => { setMessages([]); setDraft(""); inputRef.current?.focus(); };
  const empty = messages.length === 0;
  const next = assessment?.nextPayment ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section aria-label="Conversation with Hoddie" className="flex h-[74dvh] min-h-[480px] flex-col border border-white/[0.14] bg-[#101319] lg:h-[calc(100dvh-21rem)] lg:max-h-[860px]">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.14] px-4 py-3">
          <div className="flex items-center gap-3"><Mark className="size-8" /><div><p className="disp text-[13px]">Hoddie</p><p className={labelClass}>Treasury assistant</p></div></div>
          <button type="button" onClick={reset} disabled={empty && !draft} className="mono inline-flex min-h-9 items-center gap-2 border border-white/25 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#c9cbd3] transition hover:border-[#7fa6ff] hover:text-white disabled:opacity-35"><RotateCcw aria-hidden="true" className="size-3.5" />New chat</button>
        </div>

        <div ref={listRef} role="log" aria-label="Conversation" aria-live="polite" tabIndex={0} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {empty && !busy ? (
            <div className="flex min-h-full"><div className="m-auto flex w-full max-w-2xl flex-col items-center py-4 text-center">
              <div className="relative grid size-20 place-items-center"><span aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle,rgba(40,90,255,0.35),rgba(40,90,255,0)_68%)]" /><Image src="/brand/hodd-star.png" alt="" width={320} height={320} className="relative size-16 drop-shadow-[0_0_14px_rgba(40,100,255,0.45)]" /></div>
              <p className="disp mt-4 text-[clamp(1.4rem,3.4vw,2rem)]">Ask about your treasury.</p>
              <p className="mt-3 max-w-md text-sm leading-6 text-white/60">Hoddie answers from your own workspace: balances, bills, runway and policy. It can read, never move funds.</p>
              <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
                {starterPrompts.map((prompt, index) => (
                  <button key={prompt} type="button" onClick={() => void ask(prompt)} className="group flex min-h-[4.5rem] flex-col items-start justify-between border border-white/25 p-3.5 text-left transition duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-[#f4f1e8] hover:shadow-[4px_4px_0_#0a52e8]">
                    <span aria-hidden="true" className="mono text-[10px] text-white/45">{String(index + 1).padStart(2, "0")}</span><span className="mt-2 text-sm">{prompt}</span>
                  </button>
                ))}
              </div>
            </div></div>
          ) : (
            <ol className="mx-auto flex max-w-3xl flex-col gap-6">
              {messages.map((message) => message.role === "user" ? (
                <li key={message.id} className="flex flex-col items-end gap-1.5">
                  <span className={labelClass}>You · {time(message.at)}</span>
                  <p className="max-w-[85%] whitespace-pre-wrap break-words bg-[#f4f1e8] px-4 py-3 text-sm leading-6 text-[#0b0b0d] sm:max-w-[75%]">{message.text}</p>
                </li>
              ) : (
                <li key={message.id} className="flex items-start gap-3">
                  <Mark className="size-8" />
                  <div className="min-w-0 max-w-[92%] flex-1 sm:max-w-[85%]">
                    <span className={labelClass}>Hoddie · {time(message.at)}</span>
                    <div className="mt-1.5 border border-white/[0.14] bg-white/[0.04] px-4 py-3.5">{message.reply && <ReplyBody reply={message.reply} canAsk={!busy} onFollowUp={(question) => void ask(question)} />}</div>
                  </div>
                </li>
              ))}
              {busy && <li><Thinking /></li>}
            </ol>
          )}
        </div>

        <form onSubmit={submit} className="border-t border-white/[0.14] p-3 sm:p-4">
          <div className="mx-auto flex max-w-3xl items-end gap-3">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Message Hoddie</span>
              <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} maxLength={MAX_LENGTH} rows={1} placeholder="Ask about a bill or your runway…" className="block max-h-40 min-h-12 w-full resize-none border border-white/25 bg-[#0b0b0d] px-4 py-3 text-sm leading-6 text-[#f4f1e8] outline-none placeholder:text-white/35 focus:border-[#7fa6ff] [field-sizing:content]" />
            </label>
            <button type="submit" disabled={busy || draft.trim().length === 0} aria-label="Send message" className={clsx(buttonClass.primary, "size-12 shrink-0 px-0")}><ArrowUp aria-hidden="true" className="size-5" /></button>
          </div>
          <p className="mx-auto mt-2 flex max-w-3xl flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] text-white/45"><span>Enter to send · Shift+Enter for a new line</span><span>Hoddie never moves funds. Payments need your wallet signature.</span></p>
        </form>
      </section>

      <aside aria-label="What Hoddie sees" className="space-y-6">
        <SectionCard>
          <SectionHeading index="H.1" title="In view" description={hydrated ? "Read from this workspace" : "Loading the workspace…"} />
          {assessment && operationalWorkspace ? (
            <dl className="divide-y divide-white/10">
              <div className="px-5 py-4"><dt className={labelClass}>Total treasury</dt><dd><MoneyValue money={operationalWorkspace.totalTreasury} className="mt-2 block text-lg" /></dd></div>
              <div className="px-5 py-4"><dt className={labelClass}>Deployable</dt><dd><MoneyValue money={assessment.deployableCapital} className="mt-2 block text-lg text-[#9ec5f4]" /></dd></div>
              <div className="px-5 py-4"><dt className={labelClass}>Next payment</dt><dd className="mt-2 text-sm">{next ? <>{next.title}<span className="mt-1 block text-xs text-white/50">{formatDate(next.dueAt, { year: undefined, month: "short", day: "numeric" })}</span></> : "Nothing due"}</dd></div>
            </dl>
          ) : <p role="status" className="p-5 text-sm leading-6 text-white/60">Figures are paused until the linked Arc Testnet balance is verified.</p>}
        </SectionCard>
        <SectionCard>
          <SectionHeading index="H.2" title="Boundaries" />
          <ul className="divide-y divide-white/10 text-sm">
            <li className="flex items-center justify-between gap-3 px-5 py-3.5"><span>Read balances, bills, policy</span><StatusPill label="Can" tone="success" /></li>
            <li className="flex items-center justify-between gap-3 px-5 py-3.5"><span>Explain why a payment fits</span><StatusPill label="Can" tone="success" /></li>
            <li className="flex items-center justify-between gap-3 px-5 py-3.5"><span>Change obligations or policy</span><StatusPill label="Cannot" tone="neutral" /></li>
            <li className="flex items-center justify-between gap-3 px-5 py-3.5"><span>Move or deploy funds</span><StatusPill label="Cannot" tone="neutral" /></li>
          </ul>
        </SectionCard>
      </aside>
    </div>
  );
}
