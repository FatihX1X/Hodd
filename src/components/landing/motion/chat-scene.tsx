"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import * as m from "motion/react-m";
import { EASE_OUT } from "./hooks";

export type ChatTool = Readonly<{ name: string; write?: boolean }>;
export type ChatLine = Readonly<{ from: "you" | "assistant"; text: string; tools?: readonly ChatTool[]; card?: Readonly<{ title: string; action: string }> }>;

/**
 * Plays a conversation line by line: a question is read, the assistant "types" (calling its tools first), then answers.
 * Starts complete (server, no JavaScript, reduced motion); empties once armed and loops while running.
 */
export function useChatTimeline(lines: readonly ChatLine[], running: boolean, armed: boolean) {
  const [shown, setShown] = useState(lines.length);
  const [typing, setTyping] = useState(false);
  // Each loop gets a new round, so the words of a line replay when it appears again.
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!armed) return;
    const id = requestAnimationFrame(() => setShown(0));
    return () => cancelAnimationFrame(id);
  }, [armed]);

  useEffect(() => {
    if (!running) return;
    if (shown >= lines.length) {
      const restart = window.setTimeout(() => { setShown(0); setRound((value) => value + 1); }, 6000);
      return () => window.clearTimeout(restart);
    }
    const next = lines[shown];
    if (next.from === "assistant") {
      const calls = next.tools?.length ?? 0;
      const think = window.setTimeout(() => setTyping(true), 300);
      const answer = window.setTimeout(() => { setTyping(false); setShown(shown + 1); }, 1500 + Math.max(0, calls - 1) * 700);
      return () => { window.clearTimeout(think); window.clearTimeout(answer); };
    }
    const read = window.setTimeout(() => setShown(shown + 1), shown === 0 ? 600 : 2600);
    return () => window.clearTimeout(read);
  }, [running, shown, lines]);

  // A pause while the assistant is typing leaves no dots behind.
  return { shown, typing: typing && running, round };
}

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

function Tools({ tools }: { tools: readonly ChatTool[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {tools.map((tool) => (
        <span key={tool.name} className={clsx("mono inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap border px-2 text-[11px] leading-none", tool.write ? "border-[#7fe3a8]/50 text-[#7fe3a8]" : "border-[#8fb0ff]/45 text-[#b9ccff]")}>
          {tool.name}{tool.write && <span className="text-[10px] uppercase tracking-[0.09em] text-[#c9cbd3]">you allowed</span>}
        </span>
      ))}
    </span>
  );
}

type SceneProps = {
  lines: readonly ChatLine[];
  assistant: Readonly<{ name: string; avatar: React.ReactNode }>;
  shown: number;
  typing: boolean;
  round: number;
  armed: boolean;
  className?: string;
};

/**
 * The conversation itself. Every line keeps its place from the start, so the panel never grows while it plays;
 * screen readers get the whole conversation as a list.
 */
export function ChatScene({ lines, assistant, shown, typing, round, armed, className }: SceneProps) {
  return (
    <>
      <ol className="sr-only">
        {lines.map((line, index) => (
          <li key={index}>
            {line.from === "you" ? "You" : assistant.name}: {line.tools?.length ? `(uses ${line.tools.map((tool) => tool.name).join(", ")}) ` : ""}{line.text}{line.card ? ` (${line.card.title}: ${line.card.action})` : ""}
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className={clsx("flex flex-col gap-4 p-[clamp(16px,2.4vw,28px)]", className)}>
        {lines.map((line, index) => {
          const visible = index < shown;
          // Remounting on appearance replays the word-by-word reveal.
          const play = armed && visible;
          const key = visible ? `on-${round}` : "off";
          const thinking = typing && index === shown;
          return (
            <div key={index} className={clsx("relative", line.from === "you" ? "max-w-[85%] self-end" : "max-w-[92%]")}>
              <m.div
                initial={false}
                animate={visible ? { opacity: 1, y: 0, visibility: "visible" } : { opacity: 0, y: line.from === "you" ? 10 : 0, transitionEnd: { visibility: "hidden" } }}
                transition={{ duration: armed ? (visible ? 0.35 : 0.3) : 0, ease: EASE_OUT }}
              >
                {line.from === "you" ? (
                  <p className="m-0 bg-[#f4f1e8] px-4 py-3 text-[15px] leading-[1.5] text-[#0b0b0d]">{line.text}</p>
                ) : (
                  <div className="flex items-start gap-3">
                    {assistant.avatar}
                    <div className="min-w-0 border border-white/15 bg-white/[0.05] px-4 py-3 text-[15px] leading-[1.5] text-[#e6e8ee]">
                      {line.tools?.length ? <div className="mb-2.5"><Tools tools={line.tools} /></div> : null}
                      <span key={`words-${key}`}><Words text={line.text} play={play} /></span>
                      {line.card && (
                        <m.div key={`card-${key}`} className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-[#7fa6ff]/45 bg-[#0b0b0d] px-3.5 py-3" initial={play ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: play ? 0.7 : 0, ease: EASE_OUT }}>
                          <span className="mono text-xs text-[#e6e8ee]">{line.card.title}</span>
                          <span className="mono inline-flex min-h-8 items-center border border-[#f4f1e8] bg-[#f4f1e8] px-3 text-[10px] font-medium uppercase tracking-[0.09em] text-[#0b0b0d]">{line.card.action}</span>
                        </m.div>
                      )}
                    </div>
                  </div>
                )}
              </m.div>
              {thinking && (
                <div className="absolute left-0 top-0 flex items-center gap-3">
                  {assistant.avatar}
                  <span className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1.5 border border-white/15 bg-white/[0.05] px-3.5 py-1">
                    <span className="flex items-center gap-1.5">
                      {[0, 1, 2].map((dot) => <m.span key={dot} className="size-1.5 bg-[#8fb0ff]" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 0.9, repeat: Infinity, delay: dot * 0.15 }} />)}
                    </span>
                    {line.tools?.length ? <Tools tools={line.tools} /> : null}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
