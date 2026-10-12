import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";
import { Backdrop, Chip, Label, Rise, Shot, StarImage, Window, Words } from "../components/kit";
import { Float } from "./Treasury";
import { C, EASE_IN, EASE_IN_OUT, body, display, mono, pop, tween } from "../theme";

const caption: CSSProperties = { position: "absolute", left: 110 };
const paragraph = (dark: boolean): CSSProperties => ({ ...body, fontSize: 30, lineHeight: 1.45, color: dark ? "rgba(244, 241, 232, 0.72)" : "#3b3a36" });

/** 68–72 s, the breakdown before the second drop. */
export const AgentBreak: React.FC = () => {
  const frame = useCurrentFrame();
  const swell = tween(frame, 96, 120, 0, 1, EASE_IN);
  return (
    <Backdrop tone="ink" glow={[50, 50]} glowStrength={0.2 + swell * 0.4} pulse={false}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <StarImage size={560 + swell * 500} rotate={frame * 0.9} glow={0.6 + swell} style={{ opacity: 0.55 + swell * 0.45 }} />
      </AbsoluteFill>
      <Label at={4} color="rgba(244,241,232,0.8)" size={20} style={{ position: "absolute", top: 120, left: 0, right: 0, justifyContent: "center" }}>A separate agent wallet · on a budget you set</Label>
      <Words lines={["Now let it run."]} start={8} exit={56} align="center" style={{ position: "absolute", left: 0, right: 0, top: 470, fontSize: 130, color: C.paperStrong }} />
      <Words lines={["Autopilot."]} start={62} align="center" stagger={0} duration={18} style={{ position: "absolute", left: 0, right: 0, top: 430, fontSize: 230, color: C.paperStrong, transform: `scale(${1 + swell * 0.12})` }} />
      <AbsoluteFill style={{ background: "#fff", opacity: tween(frame, 114, 120, 0, 0.0) }} />
    </Backdrop>
  );
};

const DECISIONS = [
  { kind: "Invest", text: "Bills covered, reserve full: put idle budget into Morpho.", color: C.blueSoft },
  { kind: "Reserve refill", text: "Agent cash below its reserve: withdraw from Morpho.", color: C.bluePale },
  { kind: "Liquidity top-up", text: "Payroll in 3 days and your wallet is short: send USDC back.", color: C.amber },
  { kind: "Return all", text: "You ask: everything comes home in one run.", color: C.green },
  { kind: "No action", text: "Stale data or nothing to do: no move at all.", color: "rgba(244,241,232,0.6)" },
];

/** 72–82 s. The agent wallet, its mandate, a one-click Invest run, and the five decisions it can make. */
export const Autopilot: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = pop(frame, 0, 100, 18);
  const p1 = tween(frame, 92, 108, 0, 1, EASE_IN_OUT);
  const p2 = tween(frame, 194, 208, 0, 1, EASE_IN_OUT);
  const railAt = [100, 128, 150, 172];
  const railIndex = railAt.filter((at) => frame >= at).length - 1;
  return (
    <Backdrop tone="ink" glow={[80, 12]} glowStrength={0.42}>
      <AbsoluteFill style={{ perspective: 2600, opacity: 1 - p1 }}>
        <div style={{ position: "absolute", left: 970, top: 160, transformOrigin: "left center", transform: `translateX(${(1 - enter) * 600}px) rotateY(${-24 + enter * 10}deg) rotateX(4deg)` }}>
          <Window width={1020}><Shot name="autopilot" width={1020} frame={false} crop={{ y: 120, h: 1720 }} /></Window>
        </div>
      </AbsoluteFill>
      <div style={{ ...caption, top: 170, color: C.paperStrong, opacity: 1 - p1 }}>
        <Label at={2} bullet={C.blueSoft}>07 — Autopilot</Label>
        <Words lines={["Your agent.", "Your limits."]} start={4} style={{ fontSize: 88, marginTop: 30 }} accent={["limits."]} accentColor={C.blueSoft} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 44, alignItems: "flex-start" }}>
          <Chip at={24} dot={C.blueSoft}>Budget · 1,000 USDC</Chip>
          <Chip at={30} dot={C.blueSoft}>Cash reserve · 150 USDC</Chip>
          <Chip at={36} dot={C.blueSoft}>Max per run · 400 USDC</Chip>
          <Chip at={42} dot={C.blueSoft}>Morpho share · ≤ 60%</Chip>
        </div>
      </div>

      <AbsoluteFill style={{ opacity: p1 * (1 - p2) }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 130, textAlign: "center" }}>
          <Label at={98} bullet={C.blueSoft} style={{ justifyContent: "center" }}>Agent wallet · bounded server signing</Label>
          <Words lines={["One click: Invest."]} start={100} align="center" style={{ fontSize: 110, marginTop: 26, color: C.paperStrong }} accent={["Invest."]} accentColor={C.blueSoft} />
        </div>
        <Float at={104} x={210} y={420} drift={2}><Shot name="ap-run-3" width={1500} crop={{ x: 576, y: 488, w: 2544, h: 294 }} /></Float>
        <Float at={110} x={210} y={640} drift={2}>
          <div style={{ position: "relative", width: 1500 }}>
            {[0, 1, 2, 3].map((i) => <Shot key={i} name={`el-ap-rail-${i}`} width={1500} style={{ position: i === 0 ? "relative" : "absolute", left: 0, top: 0, opacity: i === railIndex || (railIndex < 0 && i === 0) ? 1 : 0 }} />)}
          </div>
        </Float>
        <div style={{ position: "absolute", left: 0, right: 0, top: 980, display: "flex", justifyContent: "center", gap: 14 }}>
          <Chip at={176} tone="blue" dot="#fff">One click: Return everything</Chip>
          <Chip at={182} dot={C.green}>Every step verified on Arc</Chip>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ opacity: p2 }}>
        <div style={{ position: "absolute", left: 110, top: 110 }}>
          <Label at={196} bullet={C.blueSoft}>Each run reads live balances and bills, then makes one decision</Label>
          <Words lines={["One run. One decision."]} start={198} style={{ fontSize: 92, marginTop: 26, color: C.paperStrong }} accent={["decision."]} accentColor={C.blueSoft} />
        </div>
        <div style={{ position: "absolute", left: 110, top: 380, display: "flex", gap: 22 }}>
          {DECISIONS.map((decision, i) => {
            const s = pop(frame, 206 + i * 7);
            return (
              <div key={decision.kind} style={{ width: 322, height: 430, padding: 30, background: C.inkSoft, border: `1px solid rgba(244,241,232,0.18)`, borderTop: `6px solid ${decision.color}`, transform: `translateY(${(1 - s) * 160}px) rotate(${(1 - s) * 4}deg)`, opacity: Math.min(1, s * 1.5), display: "flex", flexDirection: "column" }}>
                <div style={{ ...mono, fontSize: 16, color: "rgba(244,241,232,0.5)" }}>0{i + 1}</div>
                <div style={{ ...display, fontSize: 40, color: decision.color, marginTop: 22, lineHeight: 1 }}>{decision.kind}</div>
                <div style={{ ...body, fontSize: 25, lineHeight: 1.45, color: "rgba(244,241,232,0.8)", marginTop: "auto" }}>{decision.text}</div>
              </div>
            );
          })}
        </div>
        <Rise at={250} style={{ position: "absolute", left: 110, top: 880 }}>
          <div style={{ ...mono, fontSize: 20, color: "rgba(244,241,232,0.75)" }}>Every run keeps its inputs, decision, Circle transaction and server-verified receipt.</div>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

/** Reveals a capture from the top, like a message arriving. */
const Reveal: React.FC<{ name: string; width: number; at: number; full: number; first?: number; style?: CSSProperties; hard?: string | false }> = ({ name, width, at, full, first = 420, style, hard = false }) => {
  const frame = useCurrentFrame();
  const h = interpolate(frame, [at, at + 6, at + 14, at + 30], [first * 0.7, first, first, full], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  return <Shot name={name} width={width} crop={{ h }} style={style} hard={hard} />;
};

/** 82–92 s. Hoddie answers from the engine's own numbers, in English and Turkish, and drafts changes for approval. */
export const Hoddie: React.FC = () => {
  const frame = useCurrentFrame();
  const a = tween(frame, 96, 104), b = tween(frame, 166, 174), c = tween(frame, 236, 240);
  const swap = tween(frame, 160, 176, 0, 1, EASE_IN_OUT);
  return (
    <Backdrop tone="ink" glow={[10, 8]} glowStrength={0.38}>
      <div style={{ ...caption, top: 190, color: C.paperStrong }}>
        <Label at={2} bullet={C.blueSoft}>08 — Hoddie · treasury assistant</Label>
        <div style={{ position: "relative", width: 680, height: 200, marginTop: 30 }}>
          <Words lines={["Ask first.", "Automate", "later."]} start={4} exit={158} style={{ fontSize: 70, position: "absolute", whiteSpace: "nowrap" }} accent={["later."]} accentColor={C.blueSoft} />
          <Words lines={["It drafts.", "You approve."]} start={166} style={{ fontSize: 70, position: "absolute", whiteSpace: "nowrap" }} accent={["approve."]} accentColor={C.blueSoft} />
        </div>
        <Rise at={24} out={156}><p style={{ ...paragraph(true), width: 600, marginTop: 30, fontSize: 27 }}>Answers come from the Treasury Engine, not from guesses. Hoddie can propose a change; it can never move money.</p></Rise>
        <div style={{ position: "absolute", top: 500, display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start", opacity: 1 - swap }}>
          <Chip at={40} dot={C.green}>Answers in English</Chip>
          <Chip at={104} dot={C.amber}>· ve Türkçe</Chip>
        </div>
        <div style={{ position: "absolute", top: 260, display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start", opacity: swap }}>
          <Chip at={180} tone="blue" dot="#fff">Before → after, shown first</Chip>
          <Chip at={244} dot={C.green}>Applied only on your click</Chip>
        </div>
      </div>
      <div style={{ position: "absolute", left: 820, top: 90 }}>
        <div style={{ position: "absolute", opacity: 1 - a }}><Float at={2} x={0} y={0} from="right" drift={3}><Reveal name="el-hoddie-1" width={1000} at={14} full={1220} first={430} hard={C.blue} /></Float></div>
        <div style={{ position: "absolute", opacity: a * (1 - b) }}><Reveal name="el-hoddie-3" width={1000} at={100} full={1220} first={430} hard={C.blue} /></div>
        <div style={{ position: "absolute", opacity: b * (1 - c) }}><Reveal name="el-hoddie-4" width={1000} at={170} full={1260} first={430} hard={C.blue} /></div>
        <div style={{ position: "absolute", opacity: c }}><Shot name="el-hoddie-5" width={1000} crop={{ h: 1360 }} hard={C.blue} /></div>
      </div>
      <Quote at={30} out={92} question="Can I pay this week’s bills?" answer="Yes. October payroll is covered after earlier obligations and the safety buffer are set aside." tone={C.green} tag="Safe" />
      <Quote at={116} out={162} question="Hesabımı özetle" answer="Hazinenizde 30,420.50 USDC var. Bunun 18,420.50 USDC tutarı likit USDC." tone={C.amber} tag="Türkçe" />
      <Quote at={190} question="Add a 500 USDC software bill due tomorrow" answer="Deployable 18,720.50 → 18,220.50 USDC · Protected 11,700 → 12,200 USDC" tone={C.blueSoft} tag="Your approval required" />
    </Backdrop>
  );
};

/** The answer, set large under the real capture so it reads at a glance. */
const Quote: React.FC<{ at: number; out?: number; question: string; answer: string; tone: string; tag: string }> = ({ at, out, question, answer, tone, tag }) => {
  const frame = useCurrentFrame();
  const s = pop(frame, at, 170, 16);
  const leave = out === undefined ? 0 : tween(frame, out, out + 10, 0, 1, EASE_IN);
  return (
    <div style={{ position: "absolute", left: 870, top: 740, width: 940, padding: "26px 32px", background: C.paperStrong, color: C.ink, boxShadow: `10px 10px 0 ${C.blue}`, opacity: Math.min(1, s * 1.5) * (1 - leave), transform: `translateY(${(1 - s) * 50 + leave * 30}px)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...mono, fontSize: 17, color: C.muted }}>
        <span>“{question}”</span>
        <span style={{ color: C.ink, display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 10, height: 10, background: tone === C.blueSoft ? C.blue : tone === C.amber ? "#d39a1c" : "#2fa865" }} />{tag}</span>
      </div>
      <div style={{ ...body, fontSize: 34, lineHeight: 1.3, marginTop: 14, fontWeight: 500 }}>{answer}</div>
    </div>
  );
};

/** 92–96 s. The Claude connector: reads freely, writes only with approval, never moves money. */
export const Claude: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Backdrop tone="paper" glow={false}>
      <div style={{ ...caption, top: 110, color: C.ink }}>
        <Label at={2} color={C.blue} bullet={C.blue}>09 — Claude connector · MCP</Label>
        <Words lines={["Run Hodd from Claude."]} start={4} style={{ fontSize: 96, marginTop: 28 }} accent={["Claude."]} />
      </div>
      <Float at={10} x={110} y={360} drift={3}><Shot name="el-claude" width={1700} hard={C.ink} style={{ border: `1.5px solid ${C.ink}` }} /></Float>
      <div style={{ position: "absolute", left: 110, top: 930, display: "flex", gap: 14, opacity: tween(frame, 0, 1) }}>
        <Chip at={40} tone="paper" dot={C.green}>Reads run freely</Chip>
        <Chip at={48} tone="paper" dot={C.amber}>Every change: preview, then your approval</Chip>
        <Chip at={56} tone="paper" dot={C.blue}>Money never moves from Claude</Chip>
      </div>
    </Backdrop>
  );
};

