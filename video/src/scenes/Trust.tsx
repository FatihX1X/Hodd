import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";
import { Backdrop, Chip, Crosshair, Label, Rise, Shot, Spark, Ticker, Words } from "../components/kit";
import { Mark } from "../components/Mark";
import { Float } from "./Treasury";
import { C, EASE_IN, EASE_IN_OUT, body, display, mono, pop, tween } from "../theme";

const caption: CSSProperties = { position: "absolute", left: 110 };

const LIMITS = [
  { title: "Two destinations", text: "The agent can only use the allowlisted Morpho vault, or send USDC to your proven wallet." },
  { title: "Your mandate", text: "Budget, cash reserve, per-run cap and Morpho share. Pause it or recall everything." },
  { title: "Bills first", text: "Protected capital is never invested. A shortfall is covered before anything else." },
  { title: "No guessing", text: "Integer USDC math from the engine. Stale balances mean no action." },
  { title: "Full record", text: "Inputs, decision, transaction hash and verified receipt for every run." },
  { title: "Kill switches", text: "One switch pauses all execution, or just Earn, payments, Autopilot or a provider." },
];

/** 96–104 s. Where the agent's authority stops: six limits that live outside the model and the browser. */
export const Guardrails: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Backdrop tone="ink" glow={[88, 90]} glowStrength={0.3}>
      <div style={{ ...caption, top: 96, color: C.paperStrong }}>
        <Label at={2} bullet={C.blueSoft}>10 — Where the agent’s authority stops</Label>
        <Words lines={["Proactive. Never unaccountable."]} start={4} style={{ fontSize: 86, marginTop: 26 }} accent={["Never", "unaccountable."]} accentColor={C.blueSoft} />
      </div>
      <div style={{ position: "absolute", left: 110, top: 372, width: 1700, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 26 }}>
        {LIMITS.map((limit, i) => {
          const at = 18 + i * 15;
          const s = pop(frame, at, 190, 15);
          const lit = tween(frame, at, at + 10);
          return (
            <div key={limit.title} style={{ height: 286, padding: "28px 34px", background: C.inkSoft, border: `1px solid rgba(244,241,232,${0.12 + lit * 0.12})`, boxShadow: `${10 * s}px ${10 * s}px 0 ${C.blue}`, transform: `translateY(${(1 - s) * 80}px) scale(${0.96 + 0.04 * s})`, opacity: Math.min(1, s * 1.6), display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ ...mono, fontSize: 18, color: C.blueLabel }}>0{i + 1}</span>
                <Spark size={22} color={C.blueSoft} style={{ transform: `rotate(${s * 90}deg)` }} />
              </div>
              <div style={{ ...display, fontSize: 36, color: C.paperStrong, marginTop: 22, whiteSpace: "nowrap" }}>{limit.title}</div>
              <div style={{ ...body, fontSize: 24, lineHeight: 1.45, color: "rgba(244,241,232,0.75)", marginTop: "auto" }}>{limit.text}</div>
            </div>
          );
        })}
      </div>
    </Backdrop>
  );
};

/** 104–108 s. The decision ledger. */
export const Record: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = pop(frame, 0, 110, 18);
  return (
    <Backdrop tone="ink" glow={[15, 85]}>
      <div style={{ ...caption, top: 200, color: C.paperStrong }}>
        <Label at={2} bullet={C.blueSoft}>11 — Activity</Label>
        <Words lines={["Every decision", "leaves a trace."]} start={4} style={{ fontSize: 70, marginTop: 30 }} accent={["trace."]} accentColor={C.blueSoft} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 50, alignItems: "flex-start" }}>
          <Chip at={30} dot={C.blueSoft}>Human · Agent · System</Chip>
          <Chip at={38} dot={C.green}>Onchain receipts, labeled apart</Chip>
        </div>
      </div>
      <AbsoluteFill style={{ perspective: 2400 }}>
        <div style={{ position: "absolute", left: 960, top: 130, transformOrigin: "left center", transform: `translateX(${(1 - enter) * 500}px) rotateY(${-16 + enter * 8}deg)` }}>
          <Shot name="el-ledger-open" width={880} crop={{ h: 1750 }} />
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

/** 108–114 s. User-owned wallets, and the Circle and Arc stack underneath. */
export const Stack: React.FC = () => {
  const frame = useCurrentFrame();
  const leave = tween(frame, 160, 180, 0, 1, EASE_IN);
  const stack = ["Arc · USDC as gas", "Circle Wallets", "Circle App Kit · Earn", "Circle Gateway", "Gas Station paymaster", "Morpho vault"];
  return (
    <Backdrop tone="paper" glow={false}>
      <AbsoluteFill style={{ transform: `scale(${1 + leave * 0.08})`, opacity: 1 - leave * 0.5 }}>
        <div style={{ ...caption, top: 110, color: C.ink }}>
          <Label at={2} color={C.blue} bullet={C.blue}>12 — Your keys</Label>
          <Words lines={["Your wallet.", "Your signature."]} start={4} style={{ fontSize: 96, marginTop: 28 }} accent={["signature."]} />
        </div>
        <Float at={14} x={110} y={470} drift={3}><Shot name="el-wallet-chooser" width={1040} hard={C.ink} style={{ border: `1.5px solid ${C.ink}` }} /></Float>
        <div style={{ position: "absolute", left: 1270, top: 140, width: 540 }}>
          <Label at={30} color={C.muted} size={18}>Built on</Label>
          <div style={{ marginTop: 22, borderTop: `1.5px solid ${C.ink}` }}>
            {stack.map((item, i) => {
              const s = tween(frame, 34 + i * 7.5, 50 + i * 7.5);
              return (
                <div key={item} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 0", borderBottom: `1.5px solid ${C.ink}`, opacity: s, transform: `translateX(${(1 - s) * 60}px)` }}>
                  <span style={{ ...display, fontSize: 36, color: C.ink, fontStretch: "110%" }}>{item}</span>
                  <Spark size={20} color={C.blue} />
                </div>
              );
            })}
          </div>
          <Rise at={90}><div style={{ ...mono, fontSize: 18, color: C.muted, marginTop: 26, lineHeight: 1.6 }}>Circle Passkey · Circle Embedded<br />MetaMask · Rabby</div></Rise>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

/** 114–122 s. The call to action on blue, then the mark lands one last time on the final chord. */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const end = tween(frame, 80, 92, 0, 1, EASE_IN_OUT);
  const fade = tween(frame, 222, 240, 0, 1);
  return (
    <AbsoluteFill>
      <Backdrop tone="blue" glow={false}>
        <AbsoluteFill style={{ transform: `scale(${1 + end * 0.15})`, opacity: 1 - end }}>
          <div style={{ ...caption, top: 210, color: "#fff" }}>
            <Label at={0} color="#d6e4ff" size={20}>Get started</Label>
            <Words lines={["Money should", "know what’s", "next."]} start={2} style={{ fontSize: 140, marginTop: 30 }} />
          </div>
          <div style={{ position: "absolute", left: 110, top: 800, display: "flex", gap: 20 }}>
            <Chip at={30} tone="paper" size={24}>Launch app ↗ app.hoddfinance.xyz</Chip>
            <Chip at={38} tone="blue" size={24} dot="#fff">Live on Arc Testnet</Chip>
          </div>
          <Spark size={220} color="#fff" style={{ position: "absolute", right: 170, top: 600, transform: `rotate(${frame * 1.5}deg) scale(${pop(frame, 8)})`, opacity: 0.95 }} />
        </AbsoluteFill>
      </Backdrop>
      <AbsoluteFill style={{ clipPath: `inset(${(1 - end) * 50}% 0 ${(1 - end) * 50}% 0)` }}>
        <Backdrop tone="ink" glow={[50, 44]} glowStrength={0.3 + 0.25 * tween(frame, 120, 150)}>
          <Crosshair x={960} y={120} at={92} />
          <div style={{ position: "absolute", left: 360, top: 300 }}>
            <Mark width={1200} land={120} dark reveal={tween(frame, 96, 122, 0, 1, EASE_IN_OUT)} ticks={[186]} />
          </div>
          <Words lines={["Your capital, ahead of time."]} start={128} align="center" accent={["ahead", "of", "time."]} accentColor={C.blueSoft} style={{ position: "absolute", left: 0, right: 0, top: 720, fontSize: 64, color: C.paperStrong }} />
          <Rise at={146} style={{ position: "absolute", left: 0, right: 0, top: 830, display: "flex", justifyContent: "center", gap: 46 }}>
            <span style={{ ...mono, fontSize: 26, color: C.paperStrong }}>hoddfinance.xyz</span>
            <span style={{ ...mono, fontSize: 26, color: C.blueSoft }}>app.hoddfinance.xyz</span>
          </Rise>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, opacity: tween(frame, 150, 170) }}>
            <Ticker tone="ink" size={18} speed={0.05} items={["Hodd Finance®", "Treasury that plans ahead", "Bills before yield", "Approved by you", "Settled in USDC on Arc", "Money should know what’s next"]} style={{ borderTop: "1px solid rgba(244,241,232,0.2)" }} />
          </div>
        </Backdrop>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#000", opacity: fade }} />
    </AbsoluteFill>
  );
};

