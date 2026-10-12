import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";
import { Backdrop, Chip, Count, Label, Rise, Shot, Spark, Words } from "../components/kit";
import { Float } from "./Treasury";
import { C, EASE_IN, EASE_IN_OUT, body, display, mono, pop, tween } from "../theme";

const caption: CSSProperties = { position: "absolute", left: 110 };
const paragraph = (dark: boolean): CSSProperties => ({ ...body, fontSize: 30, lineHeight: 1.45, color: dark ? "rgba(244, 241, 232, 0.72)" : "#3b3a36" });

/** Crossfades a sequence of captures at the given frames. */
const Sequence: React.FC<{ names: string[]; at: number[]; width: number; crop?: { y?: number; h?: number }; hard?: string | false; style?: CSSProperties }> = ({ names, at, width, crop, hard = false, style }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "relative", ...style }}>
      {names.map((name, i) => {
        const fadeIn = i === 0 ? 1 : tween(frame, at[i], at[i] + 4);
        const fadeOut = i === names.length - 1 ? 0 : tween(frame, at[i + 1] + 3, at[i + 1] + 6);
        return <Shot key={name} name={name} width={width} crop={crop} hard={i === 0 ? hard : false} style={{ position: i === 0 ? "relative" : "absolute", left: 0, top: 0, opacity: fadeIn * (1 - fadeOut) }} />;
      })}
    </div>
  );
};

const Step: React.FC<{ index: string; text: string; on: number; dark?: boolean }> = ({ index, text, on, dark = true }) => {
  const frame = useCurrentFrame();
  const lit = tween(frame, on, on + 8);
  const shown = tween(frame, on - 10, on);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "20px 0", borderTop: `1px solid ${dark ? "rgba(244,241,232,0.14)" : "rgba(11,11,13,0.2)"}`, opacity: 0.35 + 0.65 * shown }}>
      <div style={{ width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${lit > 0.5 ? C.green : "rgba(244,241,232,0.35)"}`, background: lit > 0.5 ? C.green : "transparent", color: C.ink, ...mono, fontSize: 22, transform: `scale(${1 + 0.25 * Math.sin(Math.PI * lit)})` }}>{lit > 0.5 ? "✓" : ""}</div>
      <span style={{ ...mono, fontSize: 18, color: C.blueLabel, width: 40 }}>{index}</span>
      <span style={{ ...body, fontSize: 30, color: dark ? C.paperStrong : C.ink }}>{text}</span>
    </div>
  );
};

/** 48–56 s. Verified Morpho vault, then a one-click deposit moving along the app's own progress rail. */
export const Strategies: React.FC = () => {
  const frame = useCurrentFrame();
  const phase = tween(frame, 92, 110, 0, 1, EASE_IN_OUT);
  return (
    <Backdrop tone="ink" glow={[85, 15]}>
      <div style={{ ...caption, top: 150, color: C.paperStrong, opacity: 1 - phase }}>
        <Label at={2} bullet={C.blueSoft}>04 — Strategies</Label>
        <Words lines={["Idle cash,", "put to work."]} start={4} style={{ fontSize: 86, marginTop: 30 }} accent={["work."]} accentColor={C.blueSoft} />
        <Rise at={26}><p style={{ ...paragraph(true), width: 540, marginTop: 34 }}>Only deployable capital can enter an allowlisted Morpho vault, through Circle App Kit.</p></Rise>
      </div>
      <Float at={6} out={92} x={1000} y={170} from="right"><Shot name="el-vaults" width={820} hard={C.blue} /></Float>
      <Float at={18} out={92} x={1000} y={520} from="right"><Shot name="el-strategies" width={820} /></Float>
      <div style={{ position: "absolute", left: 1000, top: 830, display: "flex", gap: 12, opacity: 1 - phase }}>
        <Chip at={36} tone="blue" dot="#fff">4.87% APY</Chip>
        <Chip at={42} dot={C.green}>Circle-verified vault</Chip>
      </div>

      <div style={{ ...caption, top: 140, opacity: phase, width: 900 }}>
        <Label at={100} bullet={C.blueSoft}>One click · deposit 2,500 USDC</Label>
        <Words lines={["Quote. Sign.", "Verified."]} start={104} style={{ fontSize: 100, marginTop: 28, color: C.paperStrong }} accent={["Verified."]} accentColor={C.green} />
        <div style={{ marginTop: 50, width: 860 }}>
          <Step index="01" text="Fresh Circle App Kit quote" on={112} />
          <Step index="02" text="Policy check: cap, buffer, bills" on={124} />
          <Step index="03" text="Approve and deposit in your wallet" on={156} />
          <Step index="04" text="Receipt verified on Arc" on={188} />
        </div>
      </div>
      <Float at={98} x={1180} y={110} from="right" drift={4}>
        <Sequence names={["el-earn-0", "el-earn-1", "el-earn-3", "el-earn-4", "el-earn-5", "el-earn-done"]} at={[0, 116, 136, 152, 168, 186]} width={620} crop={{ h: 1500 }} hard={C.blue} />
      </Float>
    </Backdrop>
  );
};

/** 56–62 s. A bill paid from the owner's wallet; PAID only after the receipt is verified. */
export const Payments: React.FC = () => {
  const frame = useCurrentFrame();
  const stamp = pop(frame, 112, 260, 14);
  return (
    <Backdrop tone="paper" glow={false}>
      <div style={{ ...caption, top: 150, color: C.ink }}>
        <Label at={2} color={C.blue} bullet={C.blue}>05 — Payments</Label>
        <Words lines={["Pay bills from", "your own wallet."]} start={4} style={{ fontSize: 80, marginTop: 30 }} accent={["own"]} />
        <Rise at={26}><p style={{ ...paragraph(false), width: 640, marginTop: 34 }}>Hodd reviews each payment against fresh balances and fees. You confirm, your wallet signs, the server verifies the USDC transfer on Arc.</p></Rise>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", width: 860, marginTop: 40 }}>
          <Chip at={40} tone="paper" dot={C.blue}>Earlier bills stay protected</Chip>
          <Chip at={48} tone="paper" dot={C.blue}>Single-use proposal</Chip>
          <Chip at={56} tone="paper" dot={C.blue}>Canonical USDC receipt</Chip>
        </div>
      </div>
      <Float at={4} x={1250} y={100} from="right" drift={4}>
        <Sequence names={["el-pay-start", "el-pay-review", "el-pay-done"]} at={[0, 44, 96]} width={600} crop={{ h: 1160 }} hard={C.ink} style={{ border: `1.5px solid ${C.ink}` }} />
      </Float>
      <div style={{ position: "absolute", left: 1000, top: 640, transform: `rotate(-9deg) scale(${2.4 - 1.4 * stamp})`, opacity: Math.min(1, stamp * 2), transformOrigin: "center" }}>
        <div style={{ ...display, fontSize: 190, color: C.blue, border: `10px solid ${C.blue}`, padding: "10px 40px 0", background: "rgba(236,232,221,0.82)", letterSpacing: "0.02em" }}>Paid</div>
        <div style={{ ...mono, fontSize: 18, color: C.blue, marginTop: 14, textAlign: "center" }}>Verified onchain · Arc Testnet</div>
      </div>
    </Backdrop>
  );
};

const CHAINS = ["Arc Testnet", "Base Sepolia", "Ethereum Sepolia", "Arbitrum Sepolia", "OP Sepolia", "Avalanche Fuji", "Polygon Amoy", "Unichain Sepolia", "World Chain Sepolia", "Sonic Testnet", "Sei Testnet", "HyperEVM Testnet"];

/** 62–68 s. Circle Gateway: USDC on twelve testnets read as one balance, and brought to Arc. */
export const Gateway: React.FC = () => {
  const frame = useCurrentFrame();
  const center = { x: 1400, y: 560 };
  const ring = tween(frame, 92, 112, 0, 1, EASE_IN);
  return (
    <Backdrop tone="ink" glow={[70, 50]} glowStrength={0.28}>
      <div style={{ ...caption, top: 170, color: C.paperStrong, opacity: 1 - ring }}>
        <Label at={2} bullet={C.blueSoft}>06 — Circle Gateway</Label>
        <Words lines={["Every chain.", "One balance."]} start={4} style={{ fontSize: 80, marginTop: 30 }} accent={["One", "balance."]} accentColor={C.blueSoft} />
        <Rise at={24}><p style={{ ...paragraph(true), width: 520, marginTop: 34 }}>Your USDC across 12 testnets as one number. Bring it to Arc, or pay a bill straight from another chain.</p></Rise>
      </div>
      <AbsoluteFill style={{ opacity: 1 - ring, transform: `scale(${1 - ring * 0.2})`, transformOrigin: `${center.x}px ${center.y}px` }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {CHAINS.map((chain, i) => {
            const angle = (i / CHAINS.length) * Math.PI * 2 - Math.PI / 2;
            const x = center.x + Math.cos(angle) * 360, y = center.y + Math.sin(angle) * 330;
            const draw = tween(frame, 26 + i * 1.5, 46 + i * 1.5);
            return <line key={chain} x1={x} y1={y} x2={x + (center.x - x) * draw} y2={y + (center.y - y) * draw} stroke={i === 0 ? C.blueSoft : "rgba(127,166,255,0.45)"} strokeWidth={i === 0 ? 3 : 1.5} strokeDasharray={i === 0 ? undefined : "6 8"} strokeDashoffset={-frame * 2} />;
          })}
        </svg>
        {CHAINS.map((chain, i) => {
          const angle = (i / CHAINS.length) * Math.PI * 2 - Math.PI / 2;
          const x = center.x + Math.cos(angle) * 360, y = center.y + Math.sin(angle) * 330;
          const s = pop(frame, 6 + i * 2);
          return <div key={chain} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${s})`, ...mono, fontSize: 16, padding: "10px 14px", background: i === 0 ? C.blue : C.inkSoft, color: C.paperStrong, border: `1px solid ${i === 0 ? C.blueSoft : "rgba(244,241,232,0.2)"}`, whiteSpace: "nowrap" }}>{chain}</div>;
        })}
        <div style={{ position: "absolute", left: center.x, top: center.y, transform: `translate(-50%, -50%) scale(${pop(frame, 40)})`, textAlign: "center", padding: "30px 40px", background: C.paperStrong, color: C.ink, boxShadow: `10px 10px 0 ${C.blue}` }}>
          <div style={{ ...mono, fontSize: 16, color: C.muted }}>All chains</div>
          <div style={{ ...mono, fontSize: 52, fontWeight: 600, marginTop: 8 }}><Count to={27700.5} decimals={2} start={44} duration={36} /></div>
          <div style={{ ...mono, fontSize: 16, marginTop: 6, color: C.blue }}>USDC</div>
        </div>
        <Spark size={36} color={C.blueSoft} style={{ position: "absolute", left: center.x + 150, top: center.y - 110, transform: `rotate(${frame * 3}deg)`, opacity: tween(frame, 50, 60) }} />
      </AbsoluteFill>
      <Label at={98} bullet={C.blueSoft} style={{ position: "absolute", left: 110, top: 120 }}>Circle Gateway · one balance, every chain</Label>
      <Float at={100} x={110} y={200} from="below"><Shot name="el-chains-all" width={960} crop={{ h: 1400 }} /></Float>
      <Float at={110} x={1120} y={170} from="right"><Shot name="el-gateway-move" width={340} crop={{ h: 960 }} hard={C.blue} /></Float>
      <Float at={122} x={1490} y={170} from="right"><Shot name="el-pay-other" width={340} crop={{ h: 860 }} /></Float>
      <div style={{ position: "absolute", left: 110, top: 800, display: "flex", gap: 14 }}>
        <Chip at={130} tone="blue" dot="#fff">Bring USDC to Arc in seconds</Chip>
        <Chip at={136} dot={C.green}>Pay a bill from another chain</Chip>
        <Chip at={142} dot={C.blueSoft}>Arc wallet and Morpho untouched</Chip>
      </div>
    </Backdrop>
  );
};

