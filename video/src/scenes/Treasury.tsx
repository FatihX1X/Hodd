import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { CSSProperties, ReactNode } from "react";
import { Backdrop, Chip, Count, Label, Rise, Shot, Spark, Window, Words } from "../components/kit";
import { C, EASE_IN, EASE_IN_OUT, EASE_OUT, body, display, mono, pop, tween } from "../theme";

/** A card that springs in at `at`, drifts gently, and leaves at `out`. */
export const Float: React.FC<{ at: number; out?: number; x: number; y: number; children: ReactNode; drift?: number; from?: "below" | "right" | "left"; style?: CSSProperties; tilt?: number }> = ({ at, out, x, y, children, drift = 6, from = "below", style, tilt = 0 }) => {
  const frame = useCurrentFrame();
  const s = pop(frame, at, 150, 17);
  const leave = out === undefined ? 0 : tween(frame, out, out + 14, 0, 1, EASE_IN);
  const dx = from === "right" ? (1 - s) * 260 : from === "left" ? (1 - s) * -260 : 0;
  const dy = from === "below" ? (1 - s) * 140 : 0;
  const bob = Math.sin((frame + at * 3) / 38) * drift;
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: Math.min(1, s * 1.4) * (1 - leave), transform: `translate(${dx}px, ${dy + bob - leave * 60}px) scale(${0.94 + 0.06 * s}) rotateY(${tilt * (1 - s)}deg)`, ...style }}>
      {children}
    </div>
  );
};

const caption: CSSProperties = { position: "absolute", left: 110, color: C.paperStrong };
const paragraph: CSSProperties = { ...body, fontSize: 30, lineHeight: 1.45, color: "rgba(244, 241, 232, 0.72)" };

/** 20–30 s. The live console, then its key cards lifted out of it. */
export const Overview: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = pop(frame, 0, 90, 18);
  const dive = tween(frame, 104, 128, 0, 1, EASE_IN_OUT);
  const highlight = tween(frame, 206, 222);
  return (
    <Backdrop tone="ink" glow={[82, 8]}>
      <AbsoluteFill style={{ perspective: 2600 }}>
        <div style={{ position: "absolute", left: 960, top: 150, transformOrigin: "left center", opacity: 1 - dive,
          transform: `translateX(${(1 - enter) * 600 - dive * 260}px) rotateY(${-26 + enter * 12}deg) rotateX(5deg) scale(${1 - dive * 0.1})` }}>
          <Window width={1080}><Shot name="overview" width={1080} frame={false} crop={{ y: interpolate(frame, [20, 110], [0, 260], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT }), h: 1560 }} /></Window>
        </div>
      </AbsoluteFill>
      <div style={{ ...caption, top: 250, opacity: 1 - dive }}>
        <Label at={2} bullet={C.blueSoft}>01 — Overview</Label>
        <Words lines={["Liquidity", "before yield."]} start={6} style={{ fontSize: 90, marginTop: 30 }} accent={["yield."]} accentColor={C.blueSoft} />
        <Rise at={30}><p style={{ ...paragraph, width: 520, marginTop: 36 }}>Live USDC on Arc and your Morpho position, read from your own wallet. Bills are protected before anything is invested.</p></Rise>
      </div>

      <div style={{ ...caption, top: 96 }}>
        <Words lines={["Every dollar, accounted for."]} start={112} style={{ fontSize: 76 }} accent={["accounted", "for."]} accentColor={C.blueSoft} />
      </div>
      <Float at={118} x={110} y={240}><Shot name="el-total" width={800} hard={C.blue} /></Float>
      <Float at={128} x={950} y={240} from="right"><Shot name="el-next" width={600} /></Float>
      <Float at={140} x={110} y={740} drift={3}><Shot name="el-kpis" width={1700} /></Float>
      <div style={{ position: "absolute", left: 110 + 850, top: 740 + Math.sin((frame + 420) / 38) * 3, width: 425, height: 196, border: `3px solid ${C.blueSoft}`, boxShadow: `0 0 60px rgba(127,166,255,${0.45 * highlight}), inset 0 0 40px rgba(127,166,255,${0.2 * highlight})`, opacity: highlight }} />
      <div style={{ position: "absolute", left: 960, top: 950, opacity: highlight, transform: `translateY(${(1 - highlight) * 16}px)` }}>
        <Chip at={208} tone="blue" dot="#fff">Only this can be invested</Chip>
      </div>
      <div style={{ position: "absolute", left: 1600, top: 250, display: "flex", flexDirection: "column", gap: 14 }}>
        <Chip at={160} dot={C.green}>Coverage 331% · safe</Chip>
        <Chip at={168} dot={C.blueSoft}>Next bill funded</Chip>
        <Chip at={176} dot={C.amber}>Block-verified</Chip>
      </div>
    </Backdrop>
  );
};

const Term: React.FC<{ name: string; value: number; at: number; strong?: boolean; width?: number }> = ({ name, value, at, strong = false, width = 330 }) => {
  const frame = useCurrentFrame();
  const s = pop(frame, at, 220, 16);
  return (
    <div style={{ width, padding: "22px 26px", border: `2px solid ${strong ? "#fff" : "rgba(255,255,255,0.45)"}`, background: strong ? "#fff" : "rgba(255,255,255,0.06)", color: strong ? C.blue : "#fff", transform: `scale(${0.8 + 0.2 * s}) translateY(${(1 - s) * 30}px)`, opacity: Math.min(1, s * 1.5) }}>
      <div style={{ ...mono, fontSize: 17, opacity: 0.85 }}>{name}</div>
      <div style={{ ...mono, fontSize: 44, letterSpacing: "-0.01em", marginTop: 10, fontWeight: 600 }}><Count to={value} decimals={2} start={at + 2} duration={24} /></div>
    </div>
  );
};
const Op: React.FC<{ children: string; at: number }> = ({ children, at }) => {
  const frame = useCurrentFrame();
  return <div style={{ ...display, fontSize: 72, color: "#fff", opacity: tween(frame, at, at + 8), width: 70, textAlign: "center" }}>{children}</div>;
};

/** 30–34 s. The engine's two rules as live arithmetic over this treasury's numbers. */
export const Engine: React.FC = () => {
  const frame = useCurrentFrame();
  const bar = tween(frame, 62, 92, 0, 1, EASE_IN_OUT);
  const protectedShare = 11700 / 30420.5;
  return (
    <Backdrop tone="blue" glow={false}>
      <Label color="#fff" size={20} at={0} bullet="#fff" style={{ position: "absolute", left: 110, top: 86 }}>The Treasury Engine · bills before yield</Label>
      <div style={{ position: "absolute", left: 110, top: 220, display: "flex", alignItems: "center", gap: 10 }}>
        <Term name="Protected capital" value={11700} at={4} strong />
        <Op at={10}>=</Op><Term name="Bills due" value={9200} at={12} width={280} />
        <Op at={18}>+</Op><Term name="Safety buffer" value={2500} at={20} width={280} />
        <Op at={26}>+</Op><Term name="Pending" value={0} at={28} width={240} />
      </div>
      <div style={{ position: "absolute", left: 110, top: 480, display: "flex", alignItems: "center", gap: 10 }}>
        <Term name="Deployable capital" value={18720.5} at={36} strong />
        <Op at={42}>=</Op><Term name="Total treasury" value={30420.5} at={44} width={380} />
        <Op at={50}>−</Op><Term name="Protected capital" value={11700} at={52} width={380} />
      </div>
      <div style={{ position: "absolute", left: 110, top: 780, width: 1700 }}>
        <div style={{ display: "flex", height: 92, border: "2px solid #fff", overflow: "hidden" }}>
          <div style={{ width: `${protectedShare * 100 * bar}%`, background: `repeating-linear-gradient(135deg, ${C.ink} 0 14px, #1b2232 14px 28px)`, display: "flex", alignItems: "center", paddingLeft: 24, ...mono, fontSize: 22, color: C.paperStrong, whiteSpace: "nowrap", overflow: "hidden" }}>Protected · kept liquid</div>
          <div style={{ width: `${(1 - protectedShare) * 100 * bar}%`, background: C.paperStrong, display: "flex", alignItems: "center", paddingLeft: 24, ...mono, fontSize: 22, color: C.blue, whiteSpace: "nowrap", overflow: "hidden" }}>Deployable · may earn in Morpho</div>
        </div>
        <div style={{ ...mono, fontSize: 19, color: "rgba(255,255,255,0.85)", marginTop: 22, opacity: tween(frame, 84, 100) }}>Integer USDC minor units · deterministic · no language model ever calculates an amount</div>
      </div>
    </Backdrop>
  );
};

/** 34–42 s. The obligation ledger, a new bill, and what it does to the next 13 weeks. */
export const Obligations: React.FC = () => {
  const frame = useCurrentFrame();
  const swap = tween(frame, 150, 168, 0, 1, EASE_IN_OUT);
  const enter = pop(frame, 0, 100, 18);
  return (
    <Backdrop tone="ink" glow={[15, 10]}>
      <div style={{ ...caption, top: 130 }}>
        <Label at={2} bullet={C.blueSoft}>02 — Obligations</Label>
        <Words lines={["Know what", "is due."]} start={4} exit={146} style={{ fontSize: 96, marginTop: 30 }} accent={["due."]} accentColor={C.blueSoft} />
        <Words lines={["See the", "weeks ahead."]} start={154} style={{ fontSize: 96, marginTop: -177 }} accent={["ahead."]} accentColor={C.blueSoft} />
        <Rise at={24} out={146}><p style={{ ...paragraph, width: 560, marginTop: 34 }}>Payroll, rent, vendors, subscriptions, taxes. Every bill with a due date, a recipient and a priority.</p></Rise>
      </div>
      <AbsoluteFill style={{ perspective: 2400 }}>
        <div style={{ position: "absolute", left: 930, top: 110, transformOrigin: "left center", opacity: 1 - swap, transform: `translateX(${(1 - enter) * 520}px) rotateY(${-18 + enter * 8}deg) translateY(${-swap * 80}px)` }}>
          <Shot name="el-calendar" width={960} crop={{ h: 1984 - interpolate(frame, [0, 150], [700, 380], { extrapolateRight: "clamp" }), y: interpolate(frame, [10, 150], [0, 320], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT }) }} />
        </div>
      </AbsoluteFill>
      <Float at={64} out={146} x={1330} y={190} from="right"><Shot name="el-new-bill" width={480} crop={{ h: 1560 }} hard={C.blue} /></Float>
      <Float at={72} out={146} x={1190} y={880} from="right"><Chip at={72} tone="blue" dot="#fff">Saving recalculates the engine</Chip></Float>
      <Float at={160} x={110} y={560}><Shot name="el-outflows" width={1060} /></Float>
      <Float at={170} x={1210} y={300} from="right"><Shot name="el-runway" width={600} /></Float>
      <Float at={186} x={1210} y={760} from="right"><Chip at={186} dot={C.green}>Above the safety buffer for the full plan</Chip></Float>
    </Backdrop>
  );
};

const FORM_SHOTS = [3, 7, 14, 21, 30];

/** 42–48 s. The protection lead time is the owner's choice: anywhere from 3 to 30 days. */
export const LeadTime: React.FC = () => {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [14, 60, 92, 118, 146, 170], [3, 30, 30, 14, 14, 7], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const days = Math.round(value);
  const nearest = FORM_SHOTS.reduce((best, item) => Math.abs(item - value) < Math.abs(best - value) ? item : best, 3);
  const track = { left: 110, width: 1000, top: 800 };
  const knob = track.left + ((value - 3) / 27) * track.width;
  const shown = tween(frame, 6, 24);
  return (
    <Backdrop tone="paper" glow={false}>
      <Label at={0} color={C.blue} bullet={C.blue} style={{ position: "absolute", left: 110, top: 100 }}>03 — Policy · protection lead time</Label>
      <Words lines={["Bills protected", "3 to 30 days ahead."]} start={2} style={{ position: "absolute", left: 110, top: 170, fontSize: 72, color: C.ink }} accent={["3", "30"]} />
      <div style={{ position: "absolute", left: 104, top: 430, display: "flex", alignItems: "baseline", gap: 26, opacity: shown }}>
        <span style={{ ...display, fontSize: 250, color: C.blue, fontVariantNumeric: "tabular-nums", minWidth: 330, textAlign: "right" }}>{days}</span>
        <span style={{ ...display, fontSize: 92, color: C.ink }}>days</span>
      </div>
      <div style={{ position: "absolute", left: track.left, top: track.top - 92, width: track.width, display: "flex", gap: 6, opacity: shown }}>
        {Array.from({ length: 30 }, (_, i) => {
          const day = i + 1;
          const on = day <= value;
          return <div key={day} style={{ flex: 1, height: 50, background: on ? C.blue : "transparent", border: `1.5px solid ${on ? C.blue : "rgba(11,11,13,0.35)"}`, transition: "none" }} />;
        })}
      </div>
      <div style={{ position: "absolute", left: track.left, top: track.top, width: track.width, height: 4, background: C.ink, opacity: shown }} />
      <div style={{ position: "absolute", left: track.left, top: track.top, width: knob - track.left, height: 4, background: C.blue }} />
      {[3, 7, 14, 21, 30].map((tick) => (
        <div key={tick} style={{ position: "absolute", left: track.left + ((tick - 3) / 27) * track.width - 30, width: 60, top: track.top + 26, textAlign: "center", ...mono, fontSize: 20, color: C.muted, opacity: shown }}>{tick}d</div>
      ))}
      <div style={{ position: "absolute", left: knob - 24, top: track.top - 22, width: 48, height: 48, background: C.paperStrong, border: `3px solid ${C.ink}`, boxShadow: `6px 6px 0 ${C.blue}`, opacity: shown, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spark size={22} color={C.blue} />
      </div>
      <div style={{ position: "absolute", left: track.left, top: track.top + 82, display: "flex", gap: 28, ...mono, fontSize: 18, color: C.ink, opacity: tween(frame, 30, 46) }}>
        <span><span style={{ display: "inline-block", width: 14, height: 14, background: C.blue, marginRight: 10 }} />Kept liquid</span>
        <span><span style={{ display: "inline-block", width: 14, height: 14, border: `1.5px solid ${C.ink}`, marginRight: 10 }} />Planned ahead</span>
      </div>

      <Float at={8} x={1250} y={170} from="right" drift={4}>
        <div style={{ position: "relative" }}>
          {FORM_SHOTS.map((item) => <Shot key={item} name={`el-policy-lead-${item}`} width={560} style={{ position: item === 3 ? "relative" : "absolute", left: 0, top: 0, opacity: item === nearest ? 1 : 0, border: `1.5px solid ${C.ink}` }} frame={false} hard={item === 3 ? C.ink : false} />)}
          <div style={{ position: "absolute", left: 14, top: 393, width: 532, height: 54, border: `3px solid ${C.blue}`, boxShadow: `0 0 0 6px rgba(10,82,232,0.18)` }} />
        </div>
      </Float>
      <div style={{ position: "absolute", left: 1250, top: 930, display: "flex", gap: 12, flexWrap: "wrap", width: 600 }}>
        <Chip at={96} tone="paper" size={16} dot={C.blue}>Automatic: 3 d with Autopilot · 7 d otherwise</Chip>
        <Chip at={104} tone="paper" size={16} dot={C.ink}>Unsafe to fund from Morpho? Kept liquid anyway</Chip>
      </div>
      <AbsoluteFill style={{ background: C.ink, opacity: tween(frame, 172, 180, 0, 0, EASE_OUT) }} />
    </Backdrop>
  );
};
