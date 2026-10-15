"use client";

import { useRef } from "react";
import clsx from "clsx";
import { AnimatePresence, LazyMotion, useInView } from "motion/react";
import * as m from "motion/react-m";
import { ChatScene, useChatTimeline, type ChatLine } from "./chat-scene";
import { EASE_OUT, loadFeatures, useArmed, usePageVisible } from "./hooks";

const label = "mono text-[11px] uppercase leading-[1.6] tracking-[0.09em]";

/**
 * An example conversation in Claude with the Hodd connector. The tool names are the connector's real ones: reads change
 * nothing, and the one write only creates a request that waits in Hodd for the owner's wallet.
 */
const conversation: readonly ChatLine[] = [
  { from: "you", text: "Can we pay October rent on Friday and keep the 1,000 USDC buffer?" },
  { from: "assistant", tools: [{ name: "hodd_check_payment" }], text: "Yes. Rent is 1,800 USDC, due Oct 31. After paying it, 1,300 USDC stays liquid, above your buffer." },
  { from: "you", text: "Send it to Hodd for Friday." },
  { from: "assistant", tools: [{ name: "hodd_prepare_change" }, { name: "hodd_request_payment", write: true }], text: "Done. It’s waiting in Hodd. Nothing moves until you sign with your wallet." },
];

const claude = {
  name: "Claude",
  avatar: <span className="mono grid size-8 shrink-0 place-items-center border border-white/20 bg-[#0b0b0d] text-xs font-semibold text-[#f4f1e8]">C</span>,
};

type Step = Readonly<{ no: string; title: string; body: string }>;

/** Which step the conversation is on: the question, Claude reading Hodd, or the request landing in Hodd. */
function phaseOf(shown: number, typing: boolean) {
  if (shown >= conversation.length) return 2;
  return shown >= 2 || typing ? 1 : 0;
}

/**
 * "Use Hodd from Claude": the three steps on one side, the conversation on the other, and the request that lands in
 * Hodd's queue when Claude is done. Complete and still before hydration and for reduced motion.
 */
export function ClaudePreview({ steps, children }: { steps: readonly Step[]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const armed = useArmed();
  const inView = useInView(ref, { amount: 0.3 });
  const visible = usePageVisible();
  const running = armed && inView && visible;
  const chat = useChatTimeline(conversation, running, armed);
  const phase = phaseOf(chat.shown, chat.typing);
  const landed = phase === 2;

  return (
    <LazyMotion features={loadFeatures} strict>
      <div ref={ref} className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          {children}
          <ol className="m-0 mt-10 list-none p-0">
            {steps.map((step, index) => (
              <li key={step.no} data-active={armed ? index === phase : undefined} className="relative border-t border-[#0b0b0d] pb-6 pt-4 last:border-b">
                {armed && (
                  <m.span aria-hidden="true" className="absolute inset-x-0 -top-[2px] h-[3px] origin-left bg-[#0a52e8]" initial={false} animate={{ scaleX: index === phase ? 1 : 0 }} transition={{ duration: 0.7, ease: EASE_OUT }} />
                )}
                <m.div initial={false} animate={{ opacity: armed && index !== phase ? 0.8 : 1 }} transition={{ duration: 0.45, ease: EASE_OUT }}>
                  <div className={clsx(label, "text-[#0a52e8]")}>Step {step.no}</div>
                  <h3 className="disp mb-2 mt-2 text-[clamp(1.35rem,2.2vw,1.75rem)]">{step.title}</h3>
                  <p className="m-0 max-w-[46ch] text-base leading-[1.55] text-[#3b3a36]">{step.body}</p>
                </m.div>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="Example conversation in Claude with the Hodd connector" className="flex min-w-0 flex-col overflow-hidden border border-[#0b0b0d] bg-[#0b0b0d] text-[#f4f1e8]">
            <div className="flex items-center justify-between gap-4 border-b border-white/15 px-[clamp(16px,2.4vw,28px)] py-3">
              <span className={label}>Claude</span>
              <span className={clsx(label, "inline-flex items-center gap-2 text-[#7fe3a8]")}><span aria-hidden="true" className="size-2 rounded-full bg-[#2fcf2f]" />Hodd connected</span>
            </div>
            <ChatScene lines={conversation} assistant={claude} armed={armed} {...chat} />
          </section>

          <m.section
            aria-label="Requests waiting in Hodd"
            className="border border-[#0b0b0d] bg-[#f4f1e8]"
            initial={false}
            animate={{ boxShadow: landed || !armed ? "8px 8px 0 #0a52e8" : "0px 0px 0 #0a52e8" }}
            transition={{ duration: armed ? 0.5 : 0, ease: EASE_OUT }}
          >
            {/* The card loops with the conversation; screen readers get its end state once. */}
            <p className="sr-only">One request waits in Hodd: pay October rent, 1,800 USDC, requested from Claude and due Oct 31. Review and sign it with your wallet.</p>
            <div aria-hidden="true" className="flex items-center justify-between gap-4 border-b border-[#0b0b0d]/15 px-[clamp(16px,2.4vw,28px)] py-3">
              <span className={label}>Requests in Hodd</span>
              <span className={clsx(label, "inline-flex min-h-6 items-center border px-2 transition-colors duration-300", landed || !armed ? "border-[#0a52e8] bg-[#0a52e8] text-white" : "border-[#0b0b0d]/30 text-[#5a5953]")}>{landed || !armed ? "1 open" : "0 open"}</span>
            </div>
            <div aria-hidden="true" className="relative min-h-[76px] px-[clamp(16px,2.4vw,28px)] py-4">
              <AnimatePresence initial={false} mode="wait">
                {landed || !armed ? (
                  <m.div key="request" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3" initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: armed ? 0.5 : 0, ease: EASE_OUT }}>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold">Pay October rent</span>
                      <span className="mt-0.5 block text-sm text-[#5a5953]">Requested from Claude, due Oct 31</span>
                    </span>
                    <span className="flex items-center gap-4">
                      <span className="mono text-sm tabular-nums">1,800 USDC</span>
                      <span className="mono inline-flex min-h-8 items-center border border-[#0b0b0d] bg-[#0b0b0d] px-3 text-[10px] font-medium uppercase tracking-[0.09em] text-[#f4f1e8]">Review and sign</span>
                    </span>
                  </m.div>
                ) : (
                  <m.p key="empty" className="m-0 py-2 text-sm text-[#5a5953]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>Nothing is waiting for you.</m.p>
                )}
              </AnimatePresence>
            </div>
          </m.section>
          <p className="m-0 max-w-[60ch] text-sm leading-[1.55] text-[#3b3a36]">Illustrative amounts. Claude never signs and never moves money. A request opens Hodd’s usual flow: a fresh check, then your wallet signature.</p>
        </div>
      </div>
    </LazyMotion>
  );
}
