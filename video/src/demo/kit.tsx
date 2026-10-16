import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { CSSProperties, ReactNode } from "react";
import { body, display, mono } from "../theme";
import shots from "./shots.json";

/** Demo palette: black, electric blue, chrome. */
export const D = {
  black: "#050608", panel: "#0c0f15", line: "rgba(255,255,255,0.10)", text: "#eef1f6", dim: "rgba(238,241,246,0.62)",
  blue: "#1f5bff", blueHot: "#3d7bff", blueSoft: "#8fb0ff", green: "#5ee0a0", amber: "#ffcf6e", red: "#ff7a7a",
  chrome: "linear-gradient(180deg, #ffffff 0%, #dfe5ee 38%, #8b95a3 52%, #c9d1dc 64%, #ffffff 100%)",
} as const;

export const OUT = Easing.bezier(0.19, 1, 0.22, 1);
export const INOUT = Easing.bezier(0.65, 0, 0.35, 1);

/** Seconds since the start of the current sequence. */
export function useT() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
}
export const tw = (t: number, a: number, b: number, from = 0, to = 1, easing = OUT) => interpolate(t, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

export const chromeText: CSSProperties = { backgroundImage: D.chrome, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", filter: "drop-shadow(0 2px 0 rgba(0,0,0,0.6))" };

/** Black stage with the 120px ruled grid, a blue glow and a vignette. */
export const Stage: React.FC<{ children?: ReactNode; glow?: [number, number]; glowStrength?: number; grid?: boolean }> = ({ children, glow = [80, 10], glowStrength = 0.28, grid = true }) => {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: D.black, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 55% at ${glow[0]}% ${glow[1]}%, rgba(31,91,255,${glowStrength}), rgba(31,91,255,0) 70%)` }} />
      {grid && <AbsoluteFill style={{ backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)", backgroundSize: "120px 120px", backgroundPosition: `${-(t * 6) % 120}px 0` }} />}
      {children}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 80% at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

/** Fades and lifts children in at `at` seconds and out at `out`. */
export const In: React.FC<{ at: number; out?: number; children: ReactNode; dy?: number; dx?: number; style?: CSSProperties; dur?: number; scale?: boolean }> = ({ at, out, children, dy = 30, dx = 0, style, dur = 0.6, scale = false }) => {
  const t = useT();
  const a = tw(t, at, at + dur);
  const b = out === undefined ? 0 : tw(t, out, out + 0.35, 0, 1, Easing.in(Easing.cubic));
  return <div style={{ opacity: a * (1 - b), transform: `translate(${(1 - a) * dx}px, ${(1 - a) * dy - b * 20}px) scale(${scale ? 0.94 + 0.06 * a : 1})`, ...style }}>{children}</div>;
};

/** Headline words rising from masks. */
export const Rise: React.FC<{ text: string; at: number; style?: CSSProperties; stagger?: number; chrome?: boolean; out?: number }> = ({ text, at, style, stagger = 0.05, chrome = false, out }) => {
  const t = useT();
  const leave = out === undefined ? 0 : tw(t, out, out + 0.4, 0, 1, Easing.in(Easing.cubic));
  return (
    <div style={{ ...display, ...style, opacity: 1 - leave }}>
      {text.split(" ").map((word, i) => (
        <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: "0.1em", marginBottom: "-0.1em", marginRight: "0.24em" }}>
          <span style={{ display: "inline-block", transform: `translateY(${tw(t, at + i * stagger, at + i * stagger + 0.55, 105, 0)}%)`, ...(chrome ? chromeText : {}) }}>{word}</span>
        </span>
      ))}
    </div>
  );
};

type Box = { x: number; y: number; w: number };
const size = (name: string) => (shots as Record<string, number[]>)[name] ?? [3200, 1800];

/**
 * A real capture seen through a moving camera: `cam` keyframes give the source window (x, y, width in source pixels);
 * the window's aspect is the frame's, so the camera pans and zooms without distorting.
 */
export const Screen: React.FC<{ name: string; width: number; height: number; cam: (Box & { at: number })[]; style?: CSSProperties; frame?: boolean; url?: string }> = ({ name, width, height, cam, style, frame = true, url }) => {
  const t = useT();
  const [iw, ih] = size(name);
  const times = cam.map((k) => k.at);
  const pick = (key: keyof Box) => cam.length === 1 ? cam[0][key] : interpolate(t, times, cam.map((k) => k[key]), { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: INOUT });
  const w = pick("w"), x = pick("x"), y = pick("y");
  const scale = width / w;
  const bar = url ? 40 : 0;
  return (
    <div style={{ width, height: height + bar, background: D.panel, border: frame ? "1px solid rgba(255,255,255,0.16)" : undefined, boxShadow: frame ? "0 50px 120px -30px rgba(0,0,0,0.85), 0 0 0 1px rgba(0,0,0,0.5)" : undefined, overflow: "hidden", position: "relative", ...style }}>
      {url && (
        <div style={{ height: bar, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: "1px solid rgba(255,255,255,0.1)", background: "#0a0c11" }}>
          {[0, 1, 2].map((i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 5, background: "#30343c" }} />)}
          <span style={{ marginLeft: 12, ...mono, textTransform: "none", letterSpacing: "0.02em", fontSize: 14, color: "rgba(238,241,246,0.7)", display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: D.green }} />{url}</span>
        </div>
      )}
      <div style={{ position: "relative", width, height, overflow: "hidden" }}>
        <Img src={staticFile(`demo/shots/${name}.png`)} style={{ position: "absolute", left: -x * scale, top: -y * scale, width: iw * scale, height: ih * scale, maxWidth: "none" }} />
      </div>
    </div>
  );
};

/** Mono tag marking where a picture comes from. */
export const Tag: React.FC<{ kind: "onchain" | "record" | "live" | "sample" | "code" | "note"; children: ReactNode; at?: number; style?: CSSProperties }> = ({ kind, children, at = 0, style }) => {
  const color = { onchain: D.green, record: D.blueSoft, live: D.green, sample: D.amber, code: D.blueSoft, note: D.dim }[kind];
  const word = { onchain: "VERIFIED ONCHAIN", record: "PRODUCTION RECORD", live: "LIVE READ", sample: "SAMPLE DATA", code: "FROM THE CODE", note: "NOTE" }[kind];
  return (
    <In at={at} dy={10} style={style}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "9px 14px", background: "rgba(5,6,8,0.86)", border: `1px solid ${color}55`, ...mono, fontSize: 15, color: D.text }}>
        <span style={{ width: 8, height: 8, background: color, boxShadow: `0 0 12px ${color}` }} />
        <span style={{ color }}>{word}</span>
        <span style={{ color: D.dim }}>·</span>
        <span style={{ textTransform: "none", letterSpacing: "0.01em" }}>{children}</span>
      </div>
    </In>
  );
};

/** Section index and title, top left, with the network on the right. */
export const Header: React.FC<{ index: string; title: string }> = ({ index, title }) => (
  <In at={0.1} dy={-10} style={{ position: "absolute", left: 80, right: 80, top: 62, display: "flex", justifyContent: "space-between", ...mono, fontSize: 16, color: D.dim }}>
    <span><span style={{ color: D.blueSoft }}>[ {index} ]</span>&nbsp;&nbsp;{title}</span>
    <span>ARC TESTNET · CHAIN 5042002</span>
  </In>
);

/** A highlight frame drawn over part of a screen. */
export const Mark: React.FC<{ at: number; out?: number; x: number; y: number; w: number; h: number; color?: string; label?: string; labelSide?: "top" | "bottom" }> = ({ at, out, x, y, w, h, color = D.blueHot, label, labelSide = "top" }) => {
  const t = useT();
  const a = tw(t, at, at + 0.5), b = out === undefined ? 0 : tw(t, out, out + 0.3);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: a * (1 - b), border: `2.5px solid ${color}`, boxShadow: `0 0 0 6px ${color}22, 0 0 40px ${color}55`, transform: `scale(${1.04 - 0.04 * a})` }}>
      {label && <div style={{ position: "absolute", left: -2.5, [labelSide === "top" ? "bottom" : "top"]: "100%", marginBottom: 8, marginTop: 8, padding: "6px 10px", background: color, color: "#fff", ...mono, fontSize: 14, whiteSpace: "nowrap" }}>{label}</div>}
    </div>
  );
};

export const bodyText: CSSProperties = { ...body, color: D.dim, fontSize: 28, lineHeight: 1.45 };
export { display, mono };
