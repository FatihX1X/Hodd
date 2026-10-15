"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import clsx from "clsx";
import { AnimatePresence, LazyMotion, useInView } from "motion/react";
import * as m from "motion/react-m";
import { ChatScene, useChatTimeline, type ChatLine } from "./chat-scene";
import { EASE_OUT, loadFeatures, useArmed, usePageVisible } from "./hooks";

const label = "mono text-[11px] uppercase leading-[1.6] tracking-[0.09em]";

/** An example conversation. Hoddie prepares the move; the person signs it in Hodd. */
const conversation: readonly ChatLine[] = [
  { from: "you", text: "Can we pay October payroll and keep the buffer?" },
  { from: "assistant", text: "Yes. Payroll is 5,600 USDC, due Oct 30. To keep the 1,000 USDC buffer, 600 USDC needs to come back from Morpho first." },
  { from: "you", text: "Prepare it." },
  { from: "assistant", text: "Ready. Review the fresh quote in Hodd and sign with your wallet.", card: { title: "Withdraw 600 USDC from Morpho", action: "Review and sign" } },
];

const hoddie = {
  name: "Hoddie",
  avatar: <span className="grid size-8 shrink-0 place-items-center border border-white/20 bg-[#0b0b0d]"><Image src="/brand/hodd-star.png" alt="" width={64} height={64} className="size-5" /></span>,
};

type Verdict = "INVEST" | "PAY" | "TOP UP" | "REFILL" | "RETURN" | "HOLD";
type Decision = Readonly<{ verdict: Verdict; what: string; amount: string; why: string }>;

/**
 * Autopilot's decision kinds, with illustrative amounts. It runs from the owner's vault, which only lets
 * the agent send money to Morpho, Hodd's USYC pool, bills the owner approved and the owner's own wallet.
 */
const decisions: readonly Decision[] = [
  { verdict: "INVEST", what: "Split between Morpho and USYC", amount: "1,200", why: "700 to Morpho, 500 to USYC by their recent yields. Bills due soon stay covered." },
  { verdict: "PAY", what: "Pay an approved bill", amount: "600", why: "It is the bill’s payment day. Paid from your vault, redeeming from Morpho or USYC first if cash is short." },
  { verdict: "HOLD", what: "No action", amount: "—", why: "Balances are older than a minute. Nothing moves until they are fresh." },
  { verdict: "TOP UP", what: "Send to your wallet", amount: "600", why: "Your liquid USDC is below payroll plus the buffer. Sends only the shortfall." },
  { verdict: "REFILL", what: "Bring cash back from USYC", amount: "800", why: "A bill enters its protection window. Redeems enough to have it ready as cash." },
  { verdict: "HOLD", what: "No action", amount: "—", why: "Protected capital leaves nothing deployable. Bills come first." },
  { verdict: "RETURN", what: "Return all to your wallet", amount: "2,050", why: "You asked for everything back. Redeems the positions, then returns the cash." },
];

const verdictStyle: Record<Verdict, { text: string; dot: string }> = {
  INVEST: { text: "text-[#7fe3a8]", dot: "rounded-full bg-[#2fcf2f]" },
  PAY: { text: "text-[#7fe3a8]", dot: "rounded-[1px] bg-[#2fcf2f]" },
  "TOP UP": { text: "text-[#9ec5f4]", dot: "rounded-full bg-[#6da7ec]" },
  REFILL: { text: "text-[#ffd27f]", dot: "rounded-full border border-[#fab219] bg-[linear-gradient(90deg,#fab219_50%,transparent_50%)]" },
  RETURN: { text: "text-[#9ec5f4]", dot: "rounded-[1px] border border-[#6da7ec]" },
  HOLD: { text: "text-[#c9cbd3]", dot: "rounded-full border border-[#a5a8b3]" },
};

const VISIBLE_ROWS = 4;
const ROW = 92; // px, fixed so rows can move with transforms only

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
  const chat = useChatTimeline(conversation, running, armed);
  const panel = "flex min-w-0 flex-col overflow-hidden border border-white/20 bg-gradient-to-br from-white/[0.08] to-white/[0.02]";

  return (
    <LazyMotion features={loadFeatures} strict>
      <div ref={ref} className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Example conversation with Hoddie" className={panel}>
          <div className="flex items-center justify-between gap-4 border-b border-white/15 px-[clamp(16px,2.4vw,28px)] py-3">
            <span className={clsx(label, "text-[#f4f1e8]")}>Hoddie</span>
            <span className={clsx(label, "inline-flex items-center gap-2 text-[#7fe3a8]")}><span aria-hidden="true" className="size-2 rounded-full bg-[#2fcf2f]" />Available now</span>
          </div>
          <ChatScene lines={conversation} assistant={hoddie} armed={armed} {...chat} className="min-h-[460px]" />
        </section>

        <section aria-label="Autopilot decision log, illustrative" className={panel}>
          <div className="flex items-center justify-between gap-4 border-b border-white/15 px-[clamp(16px,2.4vw,28px)] py-3">
            <span className={clsx(label, "text-[#f4f1e8]")}>Autopilot decision log</span>
            <span className={clsx(label, "inline-flex items-center gap-2 text-[#9ec5f4]")}><span aria-hidden="true" className="size-2 rounded-full border-[1.5px] border-[#6da7ec]" />Arc Testnet</span>
          </div>
          <DecisionLog running={running} armed={armed} />
          <p className="m-0 mt-auto border-t border-white/15 px-[clamp(16px,2.4vw,28px)] py-4 text-[13px] leading-[1.5] text-[#a5a8b3]">Illustrative amounts. Autopilot runs from your own vault: your wallet owns it and the agent is only its operator. It can only send money to Morpho, Hodd’s USYC pool, bills you approved and your own wallet. You can pause it or take everything back at any time.</p>
        </section>
      </div>
    </LazyMotion>
  );
}
