import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, Chip, Crosshair, Label, Rise, Spark, Ticker, Words } from "../components/kit";
import { Mark } from "../components/Mark";
import { C, EASE_IN, EASE_IN_OUT, display, mono, pop, tween } from "../theme";

const cornerLabel: React.CSSProperties = { ...mono, fontSize: 17, lineHeight: 1.6, color: "rgba(244, 241, 232, 0.72)", position: "absolute" };

/** 0–8 s. The grid draws, the star lands on the HODD mark (bar 1, with the score's first impact). */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const push = tween(frame, 206, 240, 0, 1, EASE_IN);
  const corner = (at: number) => ({ opacity: tween(frame, at, at + 20) * (1 - push), transform: `translateY(${(1 - tween(frame, at, at + 20)) * 14}px)` });
  return (
    <Backdrop tone="ink" drawAt={0} glow={[50, 46]} glowStrength={0.12 + 0.3 * tween(frame, 60, 90)} pulse={false}>
      <AbsoluteFill style={{ transform: `scale(${1 + push * 0.5})`, opacity: 1 - push * 0.6, filter: `blur(${push * 6}px)` }}>
        <div style={{ ...cornerLabel, left: 96, top: 84, ...corner(14) }}>Policy-bound<br />Treasury<br />Systems</div>
        <div style={{ ...cornerLabel, right: 96, top: 84, textAlign: "right", ...corner(20) }}>On Arc<br />For a brighter tomorrow</div>
        <div style={{ ...cornerLabel, left: 96, bottom: 84, ...corner(26) }}>Capital<br />Liquidity<br />Obligations<br />Ahead of time</div>
        <div style={{ ...cornerLabel, right: 96, bottom: 84, textAlign: "right", ...corner(32) }}>Money<br />should know<br />what’s next.</div>
        <Crosshair x={960} y={110} at={24} />
        <Crosshair x={960} y={970} at={30} />
        <div style={{ position: "absolute", left: 330, top: 330 }}>
          <Mark width={1260} land={60} dark reveal={tween(frame, 34, 70, 0, 1, EASE_IN_OUT)} ticks={[150]} />
        </div>
        <Rise at={100} style={{ position: "absolute", left: 0, right: 0, top: 790, textAlign: "center" }}>
          <div style={{ ...mono, fontSize: 24, letterSpacing: "0.32em", color: C.paperStrong }}>Treasury that plans ahead</div>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

const problemLine: React.CSSProperties = { position: "absolute", left: 120, top: 300, fontSize: 168, color: C.ink };

/** 8–16 s, the build. Four short lines on the beat, on paper. */
export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const bills = [
    { title: "October payroll", amount: "6,800.00 USDC", due: "Oct 15", tag: "Critical" },
    { title: "Studio rent", amount: "2,400.00 USDC", due: "Oct 18", tag: "High" },
    { title: "Contractor invoice #218", amount: "3,250.00 USDC", due: "Oct 31", tag: "Normal" },
  ];
  const questions = ["Pay it?", "Invest it?", "Hold it?", "Move it?", "Pay it?", "Invest it?", "Hold it?", "Move it?"];
  const flicker = questions[Math.floor(Math.max(0, frame - 128) / 7.5) % questions.length];
  return (
    <Backdrop tone="paper" glow={false}>
      <Label color={C.blue} size={20} style={{ position: "absolute", left: 120, top: 120 }} at={2} bullet={C.blue}>Every small business</Label>
      <Words lines={["Bills", "come due."]} start={2} exit={56} style={problemLine} />
      {bills.map((bill, i) => {
        const at = 14 + i * 15;
        const s = pop(frame, at);
        const leave = tween(frame, 56 + i * 2, 70 + i * 2, 0, 1, EASE_IN);
        return (
          <div key={bill.title} style={{ position: "absolute", right: 140 + i * 36, top: 270 + i * 150, width: 720, padding: "26px 32px", background: C.ink, color: C.paperStrong, border: `1px solid ${C.ink}`, boxShadow: `10px 10px 0 ${C.blue}`, transform: `translateY(${(1 - s) * 120 - leave * 900}px) rotate(${(1 - s) * -6 + i * 0.6}deg)`, opacity: Math.min(1, s * 1.5) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "Archivo", fontSize: 34, fontWeight: 600 }}>{bill.title}</span>
              <span style={{ ...mono, fontSize: 16, color: i === 0 ? "#ff8a7e" : C.amber }}>■ {bill.tag}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, ...mono, fontSize: 26, letterSpacing: "0.02em" }}>
              <span>{bill.amount}</span><span style={{ color: "rgba(244,241,232,0.6)" }}>Due {bill.due}</span>
            </div>
          </div>
        );
      })}

      <Words lines={["Cash", "sits idle."]} start={62} exit={116} style={problemLine} />
      <Rise at={70} out={112} style={{ position: "absolute", right: 140, top: 330, width: 720, textAlign: "right" }}>
        <div style={{ ...mono, fontSize: 22, color: C.muted }}>Wallet balance</div>
        <div style={{ ...mono, fontSize: 92, letterSpacing: "-0.02em", color: C.ink, marginTop: 10 }}>18,420.50</div>
        <div style={{ height: 2, background: C.ink, marginTop: 30, transformOrigin: "right", transform: `scaleX(${tween(frame, 78, 104)})` }} />
        <div style={{ ...mono, fontSize: 22, color: C.danger, marginTop: 18 }}>Earning 0.00%</div>
      </Rise>

      <Words lines={["A decision,", "every day."]} start={122} exit={176} style={problemLine} />
      <div style={{ position: "absolute", left: 120, top: 690, ...display, fontSize: 116, color: C.blue, opacity: frame >= 128 && frame < 178 ? 1 : 0 }}>{flicker}</div>

      <Words lines={["What if money", "knew what’s next?"]} start={182} style={{ ...problemLine, top: 330, fontSize: 116 }} accent={["next?"]} />
      <AbsoluteFill style={{ background: C.ink, opacity: tween(frame, 230, 240, 0, 1, EASE_IN) }} />
    </Backdrop>
  );
};

/** 16–20 s, the first drop: the mark slams in over a ticker, with the promise underneath. */
export const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const slam = pop(frame, 0, 210, 13);
  const push = tween(frame, 104, 120, 0, 1, EASE_IN);
  return (
    <Backdrop tone="ink" glow={[50, 40]} glowStrength={0.55} shift={0.6}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 120, textAlign: "center", ...display, fontSize: 520, fontWeight: 900, lineHeight: 0.8, color: "transparent", WebkitTextStroke: "1.5px rgba(127, 166, 255, 0.22)", transform: `translateX(${interpolate(frame, [0, 120], [80, -80])}px)`, whiteSpace: "nowrap" }}>HODD</div>
      <AbsoluteFill style={{ transform: `scale(${1 + push * 0.35})`, opacity: 1 - push }}>
        <div style={{ position: "absolute", left: 360, top: 250, transform: `scale(${1.35 - 0.35 * slam})`, transformOrigin: "50% 50%" }}>
          <Mark width={1200} land={-100} dark ticks={[4, 64]} dial />
        </div>
        <Words lines={["Your capital, ahead of time."]} start={14} stagger={3} align="center" accent={["ahead", "of", "time."]} accentColor={C.blueSoft} style={{ position: "absolute", left: 0, right: 0, top: 690, fontSize: 84, color: C.paperStrong }} />
        <Rise at={34} style={{ position: "absolute", left: 0, right: 0, top: 812, textAlign: "center" }}>
          <div style={{ ...mono, fontSize: 21, color: "rgba(244,241,232,0.7)", letterSpacing: "0.2em" }}>An AI-run treasury for small businesses · settled in USDC on Arc</div>
        </Rise>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, transform: `translateY(${(1 - tween(frame, 6, 26)) * 80}px)` }}>
        <Ticker tone="blue" size={20} speed={0.09} items={["Hodd Finance®", "Treasury that plans ahead", "Capital", "Liquidity", "Obligations", "Approved by you", "On Arc", "Money should know what’s next"]} />
      </div>
      <Spark size={40} color={C.blueSoft} style={{ position: "absolute", left: 120, top: 120, opacity: tween(frame, 20, 34), transform: `rotate(${frame * 2}deg)` }} />
      <Spark size={28} color={C.paperStrong} style={{ position: "absolute", right: 150, top: 200, opacity: tween(frame, 26, 40), transform: `rotate(${-frame * 3}deg)` }} />
    </Backdrop>
  );
};

export const ChipRow: React.FC<{ items: string[]; at: number; gap?: number; tone?: "ink" | "paper" | "blue"; size?: number; style?: React.CSSProperties; dot?: string }> = ({ items, at, gap = 6, tone = "ink", size = 18, style, dot }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, ...style }}>
    {items.map((item, i) => <Chip key={item} at={at + i * gap} tone={tone} size={size} dot={dot}>{item}</Chip>)}
  </div>
);
