import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { CSSProperties, ReactNode } from "react";
import { Mark as Logo } from "../components/Mark";
import captions from "./captions.json";
import { D, Header, In, Mark, Rise, Screen, Stage, Tag, bodyText, chromeText, display, mono, tw, useT } from "./kit";

export const DEMO_FPS = 60;
export const DEMO_SECONDS = 140;
/** Sections in seconds, matched to demo/subtitles.json. */
const SECTIONS = [
  { id: "hook", from: 0, to: 12 },
  { id: "treasury", from: 12, to: 29.4 },
  { id: "mandate", from: 29.4, to: 54 },
  { id: "decision", from: 54, to: 85.4 },
  { id: "execution", from: 85.4, to: 105.4 },
  { id: "usyc", from: 105.4, to: 121.6 },
  { id: "ecosystem", from: 121.6, to: 132.4 },
  { id: "outro", from: 132.4, to: 140 },
] as const;

const left: CSSProperties = { position: "absolute", left: 80, width: 470 };
const big: CSSProperties = { ...display, fontSize: 64, color: D.text };
const figure: CSSProperties = { ...mono, fontSize: 52, fontWeight: 600, letterSpacing: "-0.01em", textTransform: "none" };

/** Crossfades between phases inside a section. */
const Phase: React.FC<{ from: number; to: number; children: ReactNode; fade?: number }> = ({ from, to, children, fade = 0.35 }) => {
  const t = useT();
  if (t < from - fade || t > to + fade) return null;
  const opacity = Math.min(tw(t, from - fade, from), 1 - tw(t, to, to + fade));
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

// ── 00:00–00:12 · hook ─────────────────────────────────────────────────────
const Hook: React.FC = () => {
  const t = useT();
  const rows = [["Payroll", "Friday"], ["Rent", "The 1st"], ["Invoice", "Next week"]];
  const lift = tw(t, 8.4, 9.2);
  return (
    <Stage glow={[50, 45]} glowStrength={0.1 + 0.25 * tw(t, 5.2, 6.4)}>
      <AbsoluteFill style={{ opacity: tw(t, 0, 0.8) }}>
        {rows.map(([word, when], i) => (
          <div key={word} style={{ position: "absolute", left: 230, top: 250 + i * 170, display: "flex", alignItems: "baseline", gap: 40 }}>
            <Rise text={word} at={1.2 + i * 1.1} out={4.8} style={{ fontSize: 150 }} chrome />
            <In at={1.5 + i * 1.1} out={4.8} dx={-30} dy={0}><span style={{ ...mono, fontSize: 30, color: D.blueSoft }}>— {when}</span></In>
          </div>
        ))}
        <div style={{ position: "absolute", left: 410, top: 300, transform: `translateY(${-lift * 160}px) scale(${1 - lift * 0.35})`, opacity: tw(t, 4.9, 5.3) * (1 - lift) }}>
          <Logo width={1100} land={5.8 * 30} dark rate={0.5} reveal={tw(t, 4.9, 5.9)} ticks={[9.6 * 30]} />
        </div>
        <In at={6.1} out={8.4} style={{ position: "absolute", left: 0, right: 0, top: 720, textAlign: "center" }}>
          <div style={{ ...display, fontSize: 52, color: D.text }}>A treasury on Arc that keeps money <span style={{ color: D.blueSoft }}>ahead of what it owes.</span></div>
        </In>
        <In at={8.8} dy={60} style={{ position: "absolute", left: 260, top: 230 }}>
          <Screen name="live-landing" url="www.hoddfinance.xyz" width={1400} height={600} cam={[{ at: 8.8, x: 0, y: 0, w: 3200 }, { at: 12, x: 200, y: 120, w: 2800 }]} />
        </In>
        <Tag kind="live" at={9.4} style={{ position: "absolute", left: 260, top: 900 }}>www.hoddfinance.xyz, captured Oct 16, 2026</Tag>
      </AbsoluteFill>
    </Stage>
  );
};

// ── 00:12–00:29 · live treasury ─────────────────────────────────────────────
const Treasury: React.FC = () => {
  const panel = { position: "absolute" as const, left: 600, top: 170 };
  return (
    <Stage>
      <Header index="01" title="LIVE TREASURY" />
      <Phase from={0} to={4.7}>
        <div style={{ ...left, top: 200 }}>
          <Rise text="Live USDC on Arc" at={0.2} style={big} />
          <In at={0.8}><div style={{ ...figure, ...chromeText, fontSize: 64, marginTop: 30 }}>31.56 USDC</div></In>
          <In at={1.1}><p style={{ ...bodyText, marginTop: 14 }}>The owner wallet's balance, read from Arc by Hodd's own server route.</p></In>
        </div>
        <In at={0} style={panel}><Screen name="console-overview-full" url="app.hoddfinance.xyz" width={1240} height={700} cam={[{ at: 0, x: 0, y: 0, w: 3200 }, { at: 1.6, x: 560, y: 1290, w: 2570 }]} /></In>
        <Mark at={2.0} x={1440} y={356} w={450} h={96} label="Verified USDC balance · block 67,489,949" labelSide="bottom" />
        <Tag kind="live" at={1.4} style={{ position: "absolute", left: 80, top: 760 }}>wallet balance, Morpho APY and Gateway</Tag>
        <Tag kind="sample" at={1.8} style={{ position: "absolute", left: 80, top: 820 }}>4 bills entered for this demo</Tag>
      </Phase>
      <Phase from={4.9} to={11.1}>
        <div style={{ ...left, top: 200 }}>
          <Rise text="Bills come first" at={5.0} style={big} />
          <In at={5.6}><p style={{ ...bodyText, marginTop: 24 }}>Every bill inside the lead time is kept liquid. The lead time is the owner's choice: <span style={{ color: D.text }}>3 to 30 days</span>.</p></In>
          <In at={8.4}><p style={{ ...bodyText, marginTop: 10 }}>A later bill stays liquid too when Morpho cannot safely pay it back.</p></In>
        </div>
        <In at={4.9} style={panel}><Screen name="console-obligations-full" url="app.hoddfinance.xyz/obligations" width={1240} height={700} cam={[{ at: 4.9, x: 560, y: 600, w: 2570 }, { at: 7.6, x: 560, y: 1380, w: 2570 }]} /></In>
        <Mark at={8.0} x={676} y={362} w={150} h={30} label="Due within 3 days" />
        <Mark at={9.0} x={762} y={526} w={172} h={30} color={D.amber} label="Vault liquidity too low → kept liquid" labelSide="bottom" />
      </Phase>
      <Phase from={11.3} to={17.6}>
        <div style={{ ...left, top: 200 }}>
          <Rise text="Protected, then deployable" at={11.4} style={big} />
          <In at={12.0}><div style={{ marginTop: 30, ...mono, fontSize: 20, color: D.amber }}>Protected</div><div style={{ ...figure, color: D.amber }}>25.00 USDC</div></In>
          <In at={12.6}><div style={{ marginTop: 18, ...mono, fontSize: 20, color: D.blueSoft }}>Deployable</div><div style={{ ...figure, color: D.blueSoft }}>8.46 USDC</div></In>
        </div>
        <In at={11.3} style={panel}><Screen name="console-overview-full" url="app.hoddfinance.xyz" width={1240} height={700} cam={[{ at: 11.3, x: 560, y: 2990, w: 2570 }, { at: 16, x: 560, y: 3000, w: 2350 }]} /></In>
        <Tag kind="code" at={14.0} style={{ position: "absolute", left: 80, top: 820 }}>Treasury Engine · integer USDC minor units</Tag>
        <Tag kind="code" at={14.4} style={{ position: "absolute", left: 80, top: 880 }}>no language model calculates an amount</Tag>
      </Phase>
    </Stage>
  );
};

// ── 00:29–00:54 · vault, funding and limits ────────────────────────────────
const Node: React.FC<{ title: string; address: string; note: string; at: number; color?: string; style?: CSSProperties }> = ({ title, address, note, at, color = D.blueSoft, style }) => (
  <In at={at} scale style={{ position: "absolute", width: 430, padding: "26px 28px", background: "rgba(12,15,21,0.92)", border: `1px solid ${color}66`, boxShadow: `0 0 50px ${color}22`, ...style }}>
    <div style={{ ...mono, fontSize: 15, color }}>{note}</div>
    <div style={{ ...display, fontSize: 34, color: D.text, marginTop: 14 }}>{title}</div>
    <div style={{ ...mono, fontSize: 19, textTransform: "none", letterSpacing: "0.02em", color: D.dim, marginTop: 12 }}>{address}</div>
  </In>
);
const Link: React.FC<{ at: number; x1: number; x2: number; y: number; label: string; dashed?: boolean }> = ({ at, x1, x2, y, label, dashed }) => {
  const t = useT();
  const p = tw(t, at, at + 0.8);
  return (
    <div style={{ position: "absolute", left: Math.min(x1, x2), top: y, width: Math.abs(x2 - x1) }}>
      <svg width={Math.abs(x2 - x1)} height={20} style={{ display: "block" }}>
        <line x1={x1 < x2 ? 0 : Math.abs(x2 - x1)} y1={10} x2={(x1 < x2 ? 0 : Math.abs(x2 - x1)) + (x2 - x1) * p} y2={10} stroke={D.blueHot} strokeWidth={3} strokeDasharray={dashed ? "10 8" : undefined} />
      </svg>
      <div style={{ textAlign: "center", ...mono, fontSize: 16, color: D.blueSoft, marginTop: 8, opacity: p }}>{label}</div>
    </div>
  );
};
const Destination: React.FC<{ at: number; label: string; detail: string; ok?: boolean }> = ({ at, label, detail, ok = true }) => (
  <In at={at} dx={-30} dy={0} style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 0", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
    <span style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: ok ? D.green : D.red, color: D.black, ...mono, fontSize: 20, fontWeight: 600 }}>{ok ? "✓" : "✕"}</span>
    <div><div style={{ ...display, fontSize: 28, color: ok ? D.text : D.red }}>{label}</div><div style={{ ...mono, fontSize: 15, color: D.dim, textTransform: "none", letterSpacing: "0.02em", marginTop: 4 }}>{detail}</div></div>
  </In>
);

const Mandate: React.FC = () => (
  <Stage glow={[50, 30]}>
    <Header index="02" title="AGENT WALLET · VAULT · LIMITS" />
    <Phase from={0} to={7.2}>
      <Rise text="Owned by you. Operated by the agent." at={0.2} style={{ ...big, position: "absolute", left: 80, top: 170, width: 1760 }} />
      <Node at={0.6} title="Owner wallet" address="0xDEf0…2e7C" note="OWNS" color={D.green} style={{ left: 80, top: 430 }} />
      <Node at={1.2} title="HoddieVault" address="0xA425…D02d" note="THE CONTRACT" color={D.blueHot} style={{ left: 745, top: 430 }} />
      <Node at={2.6} title="Circle agent wallet" address="0xae40…750b" note="OPERATES" color={D.blueSoft} style={{ left: 1410, top: 430 }} />
      <Link at={1.8} x1={510} x2={745} y={500} label="owner()" />
      <Link at={3.2} x1={1410} x2={1175} y={500} label="operator()" dashed />
      <Tag kind="onchain" at={4.0} style={{ position: "absolute", left: 80, top: 720 }}>owner() and operator() read from the vault on Arc</Tag>
    </Phase>
    <Phase from={7.4} to={11.8}>
      <div style={{ ...left, top: 200 }}>
        <Rise text="Funded from the owner's wallet" at={7.5} style={big} />
        <In at={8.2}><div style={{ ...figure, ...chromeText, fontSize: 64, marginTop: 26 }}>30 USDC</div></In>
        <In at={8.6}><p style={{ ...bodyText, marginTop: 12 }}>Signed by the owner's own wallet: owner → Circle agent wallet.</p></In>
      </div>
      <In at={7.4} style={{ position: "absolute", left: 600, top: 170 }}><Screen name="arcscan-funding" url="testnet.arcscan.app" width={1240} height={700} cam={[{ at: 7.4, x: 480, y: 140, w: 2700 }, { at: 11.5, x: 960, y: 640, w: 2200 }]} /></In>
      <Tag kind="onchain" at={8.8} style={{ position: "absolute", left: 80, top: 820 }}>0xc69f…4dcf · block 67,127,988 · Oct 14</Tag>
    </Phase>
    <Phase from={12.0} to={24.6}>
      <div style={{ ...left, top: 200 }}>
        <Rise text="Where money can go" at={12.1} style={big} />
        <div style={{ marginTop: 30 }}>
          <Destination at={12.4} label="Morpho vault" detail="isStrategy · true" />
          <Destination at={13.4} label="Hodd's USYC pool" detail="isStrategy · true" />
          <Destination at={15.3} label="Approved recipient" detail="isRecipient · cap 7 USDC" />
          <Destination at={18.0} label="The owner" detail="transferToOwner · redeemToOwner" />
          <Destination at={19.8} label="Anything else" detail="reverts in the contract" ok={false} />
        </div>
      </div>
      <In at={12.0} style={{ position: "absolute", left: 600, top: 170 }}><Screen name="console-autopilot-full" url="app.hoddfinance.xyz/autopilot" width={1240} height={700} cam={[{ at: 12.0, x: 560, y: 600, w: 2570 }, { at: 17.5, x: 560, y: 600, w: 2570 }, { at: 19.5, x: 560, y: 1660, w: 2570 }]} /></In>
      <Mark at={13.0} out={18.8} x={600 + 870} y={170 + 40 + 60} w={350} h={230} label="Where your agent can send money" />
      <Mark at={20.2} x={620} y={372} w={300} h={56} color={D.green} label="Owner: your wallet · Operator: your agent" />
      <Mark at={21.2} x={622} y={440} w={212} h={40} color={D.green} label="Take everything back yourself" labelSide="bottom" />
      <Tag kind="onchain" at={14.0} style={{ position: "absolute", left: 600, top: 112 }}>isStrategy, isRecipient, recipientCap read at block 67,488,482</Tag>
    </Phase>
  </Stage>
);

// ── 00:54–01:25 · the decision ─────────────────────────────────────────────
const Card: React.FC<{ at: number; lit: number; dim: number; index: string; title: string; sub: string; children: ReactNode; x: number; color?: string }> = ({ at, lit, dim, index, title, sub, children, x, color = D.blueHot }) => {
  const t = useT();
  const on = tw(t, lit, lit + 0.5), off = tw(t, dim, dim + 0.6);
  return (
    <In at={at} scale style={{ position: "absolute", left: x, top: 210, width: 560, height: 590 }}>
      <div style={{ height: "100%", padding: "28px 30px", background: "rgba(12,15,21,0.94)", border: `1px solid ${on > 0.5 && off < 0.5 ? color : "rgba(255,255,255,0.14)"}`, boxShadow: `0 0 ${70 * on * (1 - off)}px ${color}44`, opacity: 1 - 0.45 * off, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 15, color: D.dim }}><span style={{ color }}>{index}</span><span>{sub}</span></div>
        <div style={{ ...display, fontSize: 40, color: D.text, marginTop: 14 }}>{title}</div>
        <div style={{ marginTop: 22, flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
      </div>
    </In>
  );
};
const Row: React.FC<{ k: string; v: ReactNode; at: number; color?: string }> = ({ k, v, at, color = D.text }) => (
  <In at={at} dy={12}><div style={{ ...mono, fontSize: 14, color: D.dim }}>{k}</div><div style={{ ...mono, fontSize: 24, textTransform: "none", letterSpacing: "0.01em", color, marginTop: 4 }}>{v}</div></In>
);
const Typed: React.FC<{ text: string; at: number; cps?: number; style?: CSSProperties }> = ({ text, at, cps = 34, style }) => {
  const t = useT();
  const n = Math.max(0, Math.min(text.length, Math.floor((t - at) * cps)));
  return <div style={style}>{text.slice(0, n)}<span style={{ opacity: n < text.length && t > at ? 1 : 0, color: D.blueSoft }}>▍</span></div>;
};
const Arrow: React.FC<{ at: number; x: number }> = ({ at, x }) => {
  const t = useT();
  return <div style={{ position: "absolute", left: x, top: 490, width: 50, height: 3, background: D.blueHot, transformOrigin: "left", transform: `scaleX(${tw(t, at, at + 0.4)})`, boxShadow: `0 0 18px ${D.blueHot}` }} />;
};

const RATIONALE = "Follow engine: invest 10.523539 USDC in Morpho (4.20% APY) as it's higher yield and no pending bills.";
const Decision: React.FC = () => (
  <Stage glow={[50, 0]} glowStrength={0.3}>
    <Header index="03" title="DECISION → POLICY → EXECUTION → VERIFICATION" />
    <Phase from={0} to={27.1}>
      <In at={0.1} style={{ position: "absolute", left: 80, top: 128, ...mono, fontSize: 18, color: D.dim }}>Run 4aa31f1d · 2026-10-15 03:07 UTC · trigger: six-hour check · production vault 0xA425…D02d</In>
      <Card at={0.2} lit={0.2} dim={8.8} index="01 · ENGINE" sub="deterministic" title="Proposal" x={80}>
        <Row at={1.2} k="kind" v={<span style={{ ...display, fontSize: 56, color: D.blueSoft }}>INVEST</span>} />
        <Row at={3.6} k="amount" v="10.523539 USDC → Morpho" />
        <Row at={5.6} k="recent yield" v="4.20%" />
        <Row at={6.6} k="kept for bills" v="1.000000 USDC protected" />
      </Card>
      <Arrow at={8.7} x={650} />
      <Card at={8.8} lit={8.9} dim={18.3} index="02 · AI ADVISOR" sub="Groq" title="openai/gpt-oss-120b" x={690}>
        <Row at={9.6} k="sees" v="aggregate figures only" color={D.dim} />
        <Row at={14.0} k="action" v={<span style={{ ...display, fontSize: 56, color: D.green }}>FOLLOW</span>} />
        <Row at={14.6} k="status" v="FOLLOWED" color={D.green} />
        <In at={15.0}><div style={{ ...mono, fontSize: 14, color: D.dim }}>rationale, as recorded</div><Typed at={15.2} text={`"${RATIONALE}"`} style={{ fontFamily: "Archivo", fontSize: 23, lineHeight: 1.4, color: D.text, marginTop: 6 }} /></In>
      </Card>
      <Arrow at={18.2} x={1260} />
      <Card at={18.3} lit={18.4} dim={30} index="03 · POLICY" sub="the envelope" title="Checked, not trusted" x={1300} color={D.green}>
        <In at={18.9}><div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{["FOLLOW", "ALLOCATE", "WAIT", "MOVE"].map((a) => <span key={a} style={{ ...mono, fontSize: 16, padding: "8px 12px", border: `1px solid ${a === "FOLLOW" ? D.green : "rgba(255,255,255,0.22)"}`, color: a === "FOLLOW" ? D.green : D.text }}>{a}</span>)}</div></In>
        <Row at={22.2} k="bills · top-ups · returns" v="engine only, never the model" />
        <Row at={23.8} k="answer outside the envelope" v="discarded · engine decision stands" color={D.amber} />
        <Row at={25.2} k="result" v={<span style={{ color: D.green }}>INVEST 10.523539 USDC approved</span>} />
      </Card>
      <Tag kind="record" at={2.0} style={{ position: "absolute", left: 80, top: 840 }}>agent_runs.decision · run 4aa31f1d</Tag>
      <Tag kind="code" at={19.6} style={{ position: "absolute", left: 1300, top: 840 }}>vault-advisor.ts · vaultAdvisorEnvelope</Tag>
    </Phase>
    <Phase from={27.3} to={31.4}>
      <div style={{ ...left, top: 200 }}>
        <Rise text="Many runs: no action" at={27.4} style={big} />
        <In at={28.0}><p style={{ ...bodyText, marginTop: 20 }}>Every run keeps its trigger, the engine's proposal and the advisor's reason.</p></In>
      </div>
      <In at={27.3} style={{ position: "absolute", left: 600, top: 170 }}><Screen name="console-autopilot-history-full" url="app.hoddfinance.xyz/autopilot · History" width={1240} height={700} cam={[{ at: 27.3, x: 560, y: 2740, w: 2570 }, { at: 31.4, x: 560, y: 3260, w: 2570 }]} /></In>
      <Tag kind="record" at={28.2} style={{ position: "absolute", left: 80, top: 820 }}>latest 20 runs of the production owner</Tag>
    </Phase>
  </Stage>
);

// ── 01:25–01:45 · execution and the receipt ─────────────────────────────────
const RAIL = [["Recheck", 0.3], ["Sign", 4.1], ["Confirm", 9.4], ["Verify", 12.0]] as const;
const Execution: React.FC = () => {
  const t = useT();
  const stamp = tw(t, 15.4, 15.9);
  return (
    <Stage glow={[50, 0]} glowStrength={0.3}>
      <Header index="04" title="AUTHORIZED EXECUTION · ONCHAIN VERIFICATION" />
      <div style={{ position: "absolute", left: 80, right: 80, top: 120, display: "flex", gap: 16 }}>
        {RAIL.map(([label, at], i) => {
          const on = tw(t, at, at + 0.4);
          return (
            <div key={label} style={{ flex: 1, display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", border: `1px solid ${on > 0.5 ? D.green : "rgba(255,255,255,0.14)"}`, background: on > 0.5 ? "rgba(94,224,160,0.08)" : "rgba(12,15,21,0.8)" }}>
              <span style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: on > 0.5 ? D.green : "transparent", border: `1px solid ${on > 0.5 ? D.green : "rgba(255,255,255,0.3)"}`, color: D.black, ...mono, fontSize: 14 }}>{on > 0.5 ? "✓" : i + 1}</span>
              <span style={{ ...display, fontSize: 26, color: on > 0.5 ? D.text : D.dim }}>{label}</span>
            </div>
          );
        })}
      </div>
      <Phase from={0} to={4.0}>
        <div style={{ ...left, top: 250 }}>
          <Rise text="Fresh state first" at={0.3} style={big} />
          <In at={0.9}><p style={{ ...bodyText, marginTop: 20 }}>The runner recomputes the decision on fresh balances and blocks the run if they no longer allow it.</p></In>
        </div>
        <In at={0} style={{ position: "absolute", left: 600, top: 240 }}><Screen name="console-autopilot-history-full" url="app.hoddfinance.xyz/autopilot · History" width={1240} height={640} cam={[{ at: 0, x: 560, y: 4060, w: 2570 }, { at: 4, x: 560, y: 4180, w: 2570 }]} /></In>
      </Phase>
      <Phase from={4.1} to={20.4}>
        <div style={{ ...left, top: 250 }}>
          <In at={4.2}><div style={{ ...mono, fontSize: 18, color: D.blueSoft }}>Circle agent wallet · signs</div><div style={{ ...display, fontSize: 46, color: D.text, marginTop: 10, textTransform: "none", letterSpacing: "-0.02em" }}>depositToStrategy</div></In>
          <In at={9.5}><div style={{ ...mono, fontSize: 18, color: D.green, marginTop: 34 }}>Arc · confirms</div><div style={{ ...figure, ...chromeText, fontSize: 50 }}>67,263,362</div><div style={{ ...mono, fontSize: 15, color: D.dim, textTransform: "none", marginTop: 6 }}>Oct 15 2026 03:07:18 UTC · Success</div></In>
          <In at={12.1}><div style={{ ...mono, fontSize: 18, color: D.green, marginTop: 34 }}>Hodd · verifies</div><p style={{ ...bodyText, fontSize: 24, marginTop: 8 }}>From the vault's own events, before the run is marked complete.</p></In>
        </div>
        <In at={4.1} style={{ position: "absolute", left: 600, top: 240 }}>
          <Screen name="arcscan-agent-invest" url="testnet.arcscan.app/tx/0xe52f…c29f" width={1240} height={640} cam={[{ at: 4.1, x: 520, y: 220, w: 2700 }, { at: 9.0, x: 520, y: 220, w: 2700 }, { at: 11.0, x: 520, y: 700, w: 2700 }, { at: 14.6, x: 520, y: 700, w: 2700 }]} />
        </In>
        <Mark at={5.0} out={9.2} x={610} y={343} w={575} h={34} label="0xae…750b called depositToStrategy on 0xA4…D02d" labelSide="bottom" />
        <Mark at={11.4} out={15.2} x={832} y={340} w={100} h={28} color={D.green} label="Success" />
        <Mark at={11.8} out={15.2} x={832} y={380} w={110} h={28} color={D.green} label="Block 67263362" labelSide="bottom" />
        <Mark at={12.4} out={15.2} x={832} y={578} w={530} h={84} color={D.blueHot} label="10.523539 USDC → Morpho" labelSide="bottom" />
        <AbsoluteFill style={{ opacity: tw(t, 15.0, 15.4) }}>
          <div style={{ position: "absolute", left: 600, top: 240 }}><Screen name="console-autopilot-history-full" url="app.hoddfinance.xyz/autopilot · History" width={1240} height={640} cam={[{ at: 15, x: 560, y: 4120, w: 2570 }]} /></div>
          <div style={{ position: "absolute", left: 1290, top: 560, transform: `rotate(-6deg) scale(${1.6 - 0.6 * stamp})`, opacity: stamp, padding: "8px 26px", border: `6px solid ${D.green}`, color: D.green, ...display, fontSize: 70, background: "rgba(5,6,8,0.75)" }}>Completed</div>
        </AbsoluteFill>
        <Tag kind="onchain" at={6.0} style={{ position: "absolute", left: 80, top: 860 }}>0xe52f…c29f · agent → vault 0xA425…D02d</Tag>
      </Phase>
    </Stage>
  );
};

// ── 01:45–02:02 · USYC ──────────────────────────────────────────────────────
const Usyc: React.FC = () => (
  <Stage glow={[20, 10]}>
    <Header index="05" title="LIQUIDITY · HODD'S USYC POOL" />
    <Phase from={0} to={5.2}>
      <div style={{ ...left, top: 200 }}>
        <Rise text="Hodd's USYC pool" at={0.2} style={big} />
        <In at={0.8}><p style={{ ...bodyText, marginTop: 20 }}>HoddUSYCVault holds the USYC. Circle allowlisted this one contract; users deposit and withdraw USDC.</p></In>
      </div>
      <In at={0} style={{ position: "absolute", left: 600, top: 170 }}><Screen name="arcscan-usyc-deposit" url="testnet.arcscan.app" width={1240} height={700} cam={[{ at: 0, x: 520, y: 220, w: 2700 }, { at: 5, x: 520, y: 520, w: 2600 }]} /></In>
      <Tag kind="onchain" at={1.4} style={{ position: "absolute", left: 80, top: 820 }}>deposit 1 USDC · 0x1781…760c · Oct 13</Tag>
    </Phase>
    <Phase from={5.4} to={9.8}>
      <div style={{ ...left, top: 200 }}>
        <Rise text="Round trip" at={5.5} style={big} />
        <In at={6.0}><div style={{ ...figure, ...chromeText, fontSize: 58, marginTop: 26 }}>0.999895</div><div style={{ ...mono, fontSize: 18, color: D.dim }}>USDC back from 1 USDC</div></In>
      </div>
      <In at={5.4} style={{ position: "absolute", left: 600, top: 170 }}><Screen name="arcscan-usyc-withdraw" url="testnet.arcscan.app" width={1240} height={700} cam={[{ at: 5.4, x: 520, y: 520, w: 2600 }]} /></In>
      <Mark at={6.4} x={842} y={600} w={560} h={80} color={D.green} label="0.999895 USDC to the same wallet" labelSide="bottom" />
      <Tag kind="onchain" at={6.6} style={{ position: "absolute", left: 80, top: 760 }}>withdraw · 0x9e92…9312 · Oct 13</Tag>
      <Tag kind="note" at={7.0} style={{ position: "absolute", left: 80, top: 820 }}>dev test signer · the app's own quote and verify code</Tag>
    </Phase>
    <Phase from={10.0} to={16.2}>
      <div style={{ ...left, top: 200 }}>
        <Rise text="Autopilot and USYC" at={10.1} style={big} />
        <In at={10.6}><p style={{ ...bodyText, marginTop: 20 }}>The agent's deposit and redeem were verified on a test vault. The production vault allows USYC; its runs have used Morpho so far.</p></In>
      </div>
      <In at={10.0} style={{ position: "absolute", left: 600, top: 170 }}><Screen name="arcscan-vault-usyc-deposit" url="testnet.arcscan.app" width={1240} height={700} cam={[{ at: 10, x: 520, y: 220, w: 2700 }, { at: 16, x: 520, y: 420, w: 2700 }]} /></In>
      <Tag kind="onchain" at={11.0} style={{ position: "absolute", left: 80, top: 760 }}>test vault 0xc7eF…333F · 0x0dfd…054d</Tag>
      <Tag kind="note" at={12.0} style={{ position: "absolute", left: 80, top: 820 }}>production runs: Morpho only</Tag>
    </Phase>
  </Stage>
);

// ── 02:02–02:12 · Hoddie, Claude, Gateway ───────────────────────────────────
const Ecosystem: React.FC = () => {
  const cols = [
    { at: 0.1, title: "Hoddie", name: "console-hoddie-bills", cam: { x: 560, y: 120, w: 1900 }, tag: ["live", "answer from the engine's numbers"] },
    { at: 2.6, title: "Claude · MCP", name: "console-connections", cam: { x: 560, y: 560, w: 1900 }, tag: ["code", "every change needs your approval"] },
    { at: 5.8, title: "Circle Gateway", name: "console-overview-full", cam: { x: 560, y: 1960, w: 1900 }, tag: ["live", "12 testnets as one balance"] },
  ] as const;
  return (
    <Stage glow={[50, 100]}>
      <Header index="06" title="HODDIE · CLAUDE MCP · CIRCLE GATEWAY" />
      {cols.map((col, i) => (
        <div key={col.title} style={{ position: "absolute", left: 80 + i * 600, top: 170, width: 560 }}>
          <Rise text={col.title} at={col.at} style={{ ...display, fontSize: 40, color: D.text }} />
          <In at={col.at + 0.2} style={{ marginTop: 22 }}><Screen name={col.name} width={560} height={560} cam={[{ at: col.at, ...col.cam }, { at: col.at + 5, ...col.cam, w: col.cam.w * 0.9 }]} /></In>
          <Tag kind={col.tag[0]} at={col.at + 0.7} style={{ marginTop: 20 }}>{col.tag[1]}</Tag>
        </div>
      ))}
    </Stage>
  );
};

// ── 02:12–02:20 · outro ─────────────────────────────────────────────────────
const Outro: React.FC = () => {
  const t = useT();
  return (
    <Stage glow={[50, 45]} glowStrength={0.4}>
      <div style={{ position: "absolute", left: 410, top: 230 }}><Logo width={1100} land={0.9 * 30} dark rate={0.5} reveal={tw(t, 0.2, 1.0)} /></div>
      <In at={1.2} style={{ position: "absolute", left: 0, right: 0, top: 640, textAlign: "center" }}><div style={{ ...display, fontSize: 60, ...chromeText }}>Money should know when it will be needed.</div></In>
      <In at={2.0} style={{ position: "absolute", left: 0, right: 0, top: 760, textAlign: "center", ...mono, fontSize: 30, color: D.blueSoft, textTransform: "none", letterSpacing: "0.04em" }}>app.hoddfinance.xyz</In>
      <AbsoluteFill style={{ background: "#000", opacity: tw(t, 7.0, 7.6) }} />
    </Stage>
  );
};

// ── overlays ────────────────────────────────────────────────────────────────
const TAPE = ["ARC TESTNET · 5042002", "VAULT 0xA425…D02d · 30.486784 USDC IN MORPHO", "MORPHO RECENT YIELD 4.20%", "RUN 4aa31f1d · INVEST 10.523539 USDC · ADVISOR FOLLOWED", "BLOCK 67,263,362 · depositToStrategy · SUCCESS", "BILL PAID BY AUTOPILOT · 7 USDC · BLOCK 67,213,918", "USYC ROUND TRIP · 0.999895 USDC BACK"];
const Tape: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const shown = Math.min(tw(t, 12, 12.6), 1 - tw(t, 131.8, 132.4));
  const row = (k: string) => <div key={k} style={{ display: "flex", flexShrink: 0 }}>{[...TAPE, ...TAPE].map((item, i) => <span key={i} style={{ paddingRight: 46, whiteSpace: "nowrap" }}><span style={{ color: D.blueSoft }}>◆</span>&nbsp;&nbsp;{item}</span>)}</div>;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 34, overflow: "hidden", background: "rgba(5,6,8,0.9)", borderBottom: "1px solid rgba(255,255,255,0.1)", opacity: shown, ...mono, fontSize: 14, color: D.dim, display: "flex", alignItems: "center" }}>
      <div style={{ display: "flex", transform: `translateX(${-((t * 0.9) % 50)}%)` }}>{row("a")}{row("b")}</div>
    </div>
  );
};

const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  // The outro sets its own lines as titles, so they are not repeated as subtitles.
  const cue = captions.find((c) => c.segment !== "outro" && t >= c.start - 0.05 && t <= c.end + 0.25);
  if (!cue) return null;
  const opacity = Math.min(tw(t, cue.start - 0.05, cue.start + 0.1), 1 - tw(t, cue.end + 0.1, cue.end + 0.25));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 46, display: "flex", justifyContent: "center", opacity }}>
      <div style={{ maxWidth: 1480, padding: "12px 26px", background: "rgba(0,0,0,0.72)", borderLeft: `3px solid ${D.blueHot}`, fontFamily: "Archivo", fontWeight: 500, fontSize: 34, lineHeight: 1.3, color: "#fff", textAlign: "center" }}>{cue.text}</div>
    </div>
  );
};

/** A thin electric-blue sweep across each section change. */
const Sweeps: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <>
      {SECTIONS.slice(1).map(({ from }) => {
        const p = interpolate(t, [from - 0.22, from + 0.22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        if (p <= 0 || p >= 1) return null;
        return (
          <AbsoluteFill key={from} style={{ pointerEvents: "none" }}>
            <AbsoluteFill style={{ background: "#000", opacity: 1 - Math.abs(p - 0.5) * 2 }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${p * 110 - 5}%`, width: 6, background: D.blueHot, boxShadow: `0 0 40px 10px ${D.blueHot}` }} />
          </AbsoluteFill>
        );
      })}
    </>
  );
};

const SCENES: Record<(typeof SECTIONS)[number]["id"], React.FC> = { hook: Hook, treasury: Treasury, mandate: Mandate, decision: Decision, execution: Execution, usyc: Usyc, ecosystem: Ecosystem, outro: Outro };

/** The Hodd demo: 140 s at 60 fps, subtitled over an original score, every figure traced in demo/EVIDENCE.md. */
export const Demo: React.FC = () => (
  <AbsoluteFill style={{ background: D.black }}>
    {SECTIONS.map(({ id, from, to }) => {
      const Scene = SCENES[id];
      return <Sequence key={id} from={Math.round(from * DEMO_FPS)} durationInFrames={Math.round((to - from) * DEMO_FPS)} name={id}><Scene /></Sequence>;
    })}
    <Sweeps />
    <Tape />
    <Captions />
    <Audio src={staticFile("audio/hodd-demo-score.mp3")} />
  </AbsoluteFill>
);
