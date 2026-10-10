"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import clsx from "clsx";
import { AnimatePresence, LazyMotion, useInView } from "motion/react";
import * as m from "motion/react-m";
import { EASE_OUT, loadFeatures, useArmed, usePageVisible } from "./hooks";

const label = "mono text-[11px] uppercase leading-[1.6] tracking-[0.09em]";

type Line = Readonly<{ from: "you" | "hoddie"; text: string; card?: Readonly<{ title: string; action: string }> }>;

/** An example conversation. Hoddie prepares the move; the person signs it in Hodd. */
const conversation: readonly Line[] = [
  { from: "you", text: "Can we pay October payroll and keep the buffer?" },
  { from: "hoddie", text: "Yes. Payroll is 5,600 USDC, due Oct 30. To keep the 1,000 USDC buffer, 600 USDC needs to come back from Morpho first." },
  { from: "you", text: "Prepare it." },
  { from: "hoddie", text: "Ready. Review the fresh quote in Hodd and sign with your wallet.", card: { title: "Withdraw 600 USDC from Morpho", action: "Review and sign" } },
];

type Verdict = "INVEST" | "TOP UP" | "REFILL" | "RETURN" | "HOLD";
type Decision = Readonly<{ verdict: Verdict; what: string; amount: string; why: string }>;

/**
 * Autopilot's own decision kinds (INVEST, LIQUIDITY_TOP_UP, RESERVE_REFILL, RETURN_ALL, NO_ACTION),
 * with illustrative amounts. The agent wallet can only use the allowlisted Morpho vault or send USDC
 * back to your verified wallet.
 */
const decisions: readonly Decision[] = [
  { verdict: "INVEST", what: "Deposit to Morpho", amount: "1,200", why: "Budget cash after fees and the 300 USDC reserve, inside both Morpho caps." },
  { verdict: "HOLD", what: "No action", amount: "—", why: "Balances are older than a minute. Nothing moves until they are fresh." },
  { verdict: "TOP UP", what: "Send to your wallet", amount: "600", why: "Your liquid USDC is below payroll plus the buffer. Sends only the shortfall." },
  { verdict: "REFILL", what: "Withdraw from Morpho", amount: "150", why: "Agent cash fell below its reserve. Refills it from the position." },
  { verdict: "HOLD", what: "No action", amount: "—", why: "Protected capital and Morpho caps leave no budget to invest." },
  { verdict: "RETURN", what: "Return all to your wallet", amount: "2,050", why: "You asked for everything back. Redeems the position, then returns the cash." },
];

const verdictStyle: Record<Verdict, { text: string; dot: string }> = {
  INVEST: { text: "text-[#7fe3a8]", dot: "rounded-full bg-[#2fcf2f]" },
  "TOP UP": { text: "text-[#9ec5f4]", dot: "rounded-full bg-[#6da7ec]" },
  REFILL: { text: "text-[#ffd27f]", dot: "rounded-full border border-[#fab219] bg-[linear-gradient(90deg,#fab219_50%,transparent_50%)]" },
  RETURN: { text: "text-[#9ec5f4]", dot: "rounded-[1px] border border-[#6da7ec]" },
  HOLD: { text: "text-[#c9cbd3]", dot: "rounded-full border border-[#a5a8b3]" },
};

const VISIBLE_ROWS = 4;
const ROW = 92; // px, fixed so rows can move with transforms only

function Words({ text, play }: { text: string; play: boolean }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, index) => (
        <m.span key={index} className="inline-block whitespace-pre" initial={play ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: index * 0.045, ease: EASE_OUT }}>
          {word}{index < words.length - 1 ? " " : ""}
        </m.span>
      ))}
    </>
  );
}

function Chat({ running, armed }: { running: boolean; armed: boolean }) {
  // Server, no-JS and reduced-motion readers see the whole conversation.
  const [shown, setShown] = useState(conversation.length);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = requestAnimationFrame(() => setShown(0));
    return () => cancelAnimationFrame(id);
  }, [armed]);

  useEffect(() => {
    if (!running) return;
    if (shown >= conversation.length) {
      const restart = window.setTimeout(() => setShown(0), 6000);
      return () => window.clearTimeout(restart);
    }
    const next = conversation[shown];
    if (next.from === "hoddie") {
      const think = window.setTimeout(() => setTyping(true), 300);
      const answer = window.setTimeout(() => { setTyping(false); setShown(shown + 1); }, 1500);
      return () => { window.clearTimeout(think); window.clearTimeout(answer); };
    }
    const read = window.setTimeout(() => setShown(shown + 1), shown === 0 ? 600 : 2600);
    return () => window.clearTimeout(read);
  }, [running, shown]);

  return (
    <>
    <ol className="sr-only">{conversation.map((line, index) => <li key={index}>{line.from === "you" ? "You" : "Hoddie"}: {line.text}{line.card ? ` (${line.card.title}: ${line.card.action})` : ""}</li>)}</ol>
    <div aria-hidden="true" className="flex min-h-[460px] flex-col gap-4 p-[clamp(16px,2.4vw,28px)]">
      <AnimatePresence initial={false}>
        {conversation.slice(0, shown).map((line, index) => line.from === "you" ? (
          <m.p key={`you-${index}`} className="m-0 max-w-[85%] self-end bg-[#f4f1e8] px-4 py-3 text-[15px] leading-[1.5] text-[#0b0b0d]" initial={armed ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
            {line.text}
          </m.p>
        ) : (
          <m.div key={`hoddie-${index}`} className="flex max-w-[92%] items-start gap-3" initial={false} exit={{ opacity: 0 }}>
            <span className="grid size-8 shrink-0 place-items-center border border-white/20 bg-[#0b0b0d]"><Image src="/brand/hodd-star.png" alt="" width={64} height={64} className="size-5" /></span>
            <div className="min-w-0 border border-white/15 bg-white/[0.05] px-4 py-3 text-[15px] leading-[1.5] text-[#e6e8ee]">
              <Words text={line.text} play={armed} />
              {line.card && (
                <m.div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-[#7fa6ff]/45 bg-[#0b0b0d] px-3.5 py-3" initial={armed ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: armed ? 0.7 : 0, ease: EASE_OUT }}>
                  <span className="mono text-xs text-[#e6e8ee]">{line.card.title}</span>
                  <span className="mono inline-flex min-h-8 items-center border border-[#f4f1e8] bg-[#f4f1e8] px-3 text-[10px] font-medium uppercase tracking-[0.09em] text-[#0b0b0d]">{line.card.action}</span>
                </m.div>
              )}
            </div>
          </m.div>
        ))}
      </AnimatePresence>
      {typing && (
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center border border-white/20 bg-[#0b0b0d]"><Image src="/brand/hodd-star.png" alt="" width={64} height={64} className="size-5" /></span>
          <span className="flex h-8 items-center gap-1.5 border border-white/15 bg-white/[0.05] px-3.5">
            {[0, 1, 2].map((dot) => <m.span key={dot} className="size-1.5 bg-[#8fb0ff]" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 0.9, repeat: Infinity, delay: dot * 0.15 }} />)}
          </span>
        </div>
      )}
    </div>
    </>
  );
}

function DecisionLog({ running, armed }: { running: boolean; armed: boolean }) {
  // `count` only grows: each new decision gets a unique key, so the newest slides in on top.
  const [count, setCount] = useState(VISIBLE_ROWS);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setCount((value) => value + 1), 2600);
    return () => window.clearInterval(timer);
  }, [running]);
  const rows = Array.from({ length: VISIBLE_ROWS }, (_, slot) => {
    const serial = count - 1 - slot;
    return { serial, slot, decision: decisions[((serial % decisions.length) + decisions.length) % decisions.length] };
  });

  return (
    <>
    <ul className="sr-only">{decisions.map((decision, index) => <li key={index}>{decision.verdict}: {decision.what}{decision.amount === "—" ? "" : `, ${decision.amount} USDC`}. {decision.why}</li>)}</ul>
    <ol aria-hidden="true" className="relative m-0 list-none overflow-hidden p-0" style={{ height: VISIBLE_ROWS * ROW }}>
      <AnimatePresence initial={false}>
        {rows.map(({ serial, slot, decision }) => {
          const style = verdictStyle[decision.verdict];
          return (
            <m.li
              key={serial}
              className="absolute inset-x-0 top-0 grid grid-cols-[96px_minmax(0,1fr)_auto] items-start gap-x-4 border-b border-white/10 px-[clamp(16px,2.4vw,28px)] py-4 max-sm:grid-cols-[88px_minmax(0,1fr)]"
              style={{ height: ROW }}
              initial={armed ? { opacity: 0, y: -ROW * 0.6 } : false}
              animate={{ opacity: 1, y: slot * ROW }}
              exit={{ opacity: 0, y: VISIBLE_ROWS * ROW }}
              transition={{ duration: armed ? 0.6 : 0, ease: EASE_OUT }}
            >
              <span className={clsx(label, "mt-0.5 inline-flex items-center gap-2 font-semibold", style.text)}><span aria-hidden="true" className={clsx("size-2 shrink-0", style.dot)} />{decision.verdict}</span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] text-[#f4f1e8]">{decision.what}</span>
                <span className="mt-1 line-clamp-2 block text-[13px] leading-[1.45] text-[#a5a8b3]">{decision.why}</span>
              </span>
              <span className="mono text-sm tabular-nums text-[#e6e8ee] max-sm:hidden">{decision.amount}</span>
            </m.li>
          );
        })}
      </AnimatePresence>
    </ol>
    </>
  );
}

/** Hoddie today (a conversation that prepares a move) next to Autopilot's decision log (preview). */
export function HoddiePreview() {
  const ref = useRef<HTMLDivElement>(null);
  const armed = useArmed();
  const inView = useInView(ref, { amount: 0.3 });
  const visible = usePageVisible();
  const running = armed && inView && visible;
  const panel = "flex min-w-0 flex-col overflow-hidden border border-white/20 bg-gradient-to-br from-white/[0.08] to-white/[0.02]";

  return (
    <LazyMotion features={loadFeatures} strict>
      <div ref={ref} className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Example conversation with Hoddie" className={panel}>
          <div className="flex items-center justify-between gap-4 border-b border-white/15 px-[clamp(16px,2.4vw,28px)] py-3">
            <span className={clsx(label, "text-[#f4f1e8]")}>Hoddie</span>
            <span className={clsx(label, "inline-flex items-center gap-2 text-[#7fe3a8]")}><span aria-hidden="true" className="size-2 rounded-full bg-[#2fcf2f]" />Available now</span>
          </div>
          <Chat running={running} armed={armed} />
        </section>

        <section aria-label="Autopilot decision log, illustrative" className={panel}>
          <div className="flex items-center justify-between gap-4 border-b border-white/15 px-[clamp(16px,2.4vw,28px)] py-3">
            <span className={clsx(label, "text-[#f4f1e8]")}>Autopilot decision log</span>
            <span className={clsx(label, "inline-flex items-center gap-2 text-[#9ec5f4]")}><span aria-hidden="true" className="size-2 rounded-full border-[1.5px] border-[#6da7ec]" />Arc Testnet</span>
          </div>
          <DecisionLog running={running} armed={armed} />
          <p className="m-0 mt-auto border-t border-white/15 px-[clamp(16px,2.4vw,28px)] py-4 text-[13px] leading-[1.5] text-[#a5a8b3]">Illustrative amounts. Autopilot uses its own agent wallet and the budget you fund. It can only invest in the allowlisted Morpho vault or return USDC to your verified wallet, and you can pause it at any time.</p>
        </section>
      </div>
    </LazyMotion>
  );
}
