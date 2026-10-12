import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { CSSProperties, ReactNode } from "react";
import { C, EASE_IN, EASE_OUT, SPARK_PATH, display, mono, tween } from "../theme";
import shots from "../shots.json";

type Tone = "ink" | "paper" | "blue" | "stone";
const surface: Record<Tone, { bg: string; line: string }> = {
  ink: { bg: C.ink, line: "rgba(244, 241, 232, 0.055)" },
  paper: { bg: C.paper, line: "rgba(11, 11, 13, 0.075)" },
  stone: { bg: C.stone, line: "rgba(11, 11, 13, 0.075)" },
  blue: { bg: C.blue, line: "rgba(255, 255, 255, 0.14)" },
};

/** The 120px ruled grid of the landing hero and console, drawn line by line from `drawAt`. */
export const Backdrop: React.FC<{ tone?: Tone; grid?: boolean; drawAt?: number; glow?: [number, number] | false; glowStrength?: number; children?: ReactNode; shift?: number; pulse?: boolean }> = ({ tone = "ink", grid = true, drawAt, glow = [88, 12], glowStrength = 0.34, children, shift = 0, pulse = true }) => {
  const frame = useCurrentFrame();
  // Scenes start on bar lines, so frame % 15 is the beat: the glow breathes with the kick.
  const beat = pulse ? Math.exp(-(frame % 15) / 4) : 0;
  glowStrength *= 1 + 0.32 * beat;
  const { bg, line } = surface[tone];
  const drawn = (index: number, vertical: boolean) => drawAt === undefined ? 1 : tween(frame, drawAt + index * (vertical ? 1.5 : 2) + (vertical ? 0 : 6), drawAt + index * (vertical ? 1.5 : 2) + (vertical ? 0 : 6) + 24, 0, 1);
  const offset = (shift * frame) % 120;
  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      {glow && <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 55% at ${glow[0]}% ${glow[1]}%, rgba(40, 90, 255, ${tone === "ink" ? glowStrength : glowStrength * 0.5}), rgba(40, 90, 255, 0) 70%)` }} />}
      {grid && (
        <AbsoluteFill style={{ transform: `translateX(${-offset}px)` }}>
          {Array.from({ length: 18 }, (_, i) => <div key={`v${i}`} style={{ position: "absolute", left: i * 120, top: 0, width: 1, height: "100%", background: line, transformOrigin: "top", transform: `scaleY(${drawn(i, true)})` }} />)}
          {Array.from({ length: 10 }, (_, i) => <div key={`h${i}`} style={{ position: "absolute", top: i * 120, left: 0, height: 1, width: "110%", background: line, transformOrigin: "left", transform: `scaleX(${drawn(i, false)})` }} />)}
        </AbsoluteFill>
      )}
      {children}
    </AbsoluteFill>
  );
};

/** Words rise from their own masks, the landing headline's entrance; `exit` sends them up and out. */
export const Words: React.FC<{ lines: string[]; start: number; stagger?: number; duration?: number; exit?: number; style?: CSSProperties; align?: CSSProperties["textAlign"]; accent?: string[]; accentColor?: string; lineGap?: number }> = ({ lines, start, stagger = 3, duration = 20, exit, style, align = "left", accent = [], accentColor = C.blue, lineGap = 0 }) => {
  const frame = useCurrentFrame();
  let index = 0;
  return (
    <div style={{ ...display, textAlign: align, ...style }}>
      {lines.map((line, row) => (
        <div key={row} style={{ display: "block", marginTop: row ? lineGap : 0 }}>
          {line.split(" ").map((word, column) => {
            const i = index++;
            const enter = tween(frame, start + i * stagger, start + i * stagger + duration, 105, 0);
            const leave = exit === undefined ? 0 : tween(frame, exit + i * 1.5, exit + i * 1.5 + 14, 0, -110, EASE_IN);
            const plain = (text: string) => text.replace(/[.,!?’']/g, "").toLowerCase();
            const highlighted = accent.some((item) => plain(item) === plain(word));
            return (
              <span key={column} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: "0.08em", marginBottom: "-0.08em", marginRight: column < line.split(" ").length - 1 ? "0.24em" : 0 }}>
                <span style={{ display: "inline-block", transform: `translateY(${enter + leave}%)`, color: highlighted ? accentColor : undefined }}>{word}</span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Mono label with an optional square bullet, as used across the console. */
export const Label: React.FC<{ children: ReactNode; color?: string; size?: number; style?: CSSProperties; bullet?: string | false; at?: number }> = ({ children, color = C.blueLabel, size = 18, style, bullet = false, at }) => {
  const frame = useCurrentFrame();
  const shown = at === undefined ? 1 : tween(frame, at, at + 14);
  return (
    <div style={{ ...mono, fontSize: size, color, display: "flex", alignItems: "center", gap: size * 0.7, opacity: shown, transform: `translateY(${(1 - shown) * 12}px)`, ...style }}>
      {bullet && <span style={{ width: size * 0.45, height: size * 0.45, background: bullet, flexShrink: 0 }} />}
      <span>{children}</span>
    </div>
  );
};

export const Spark: React.FC<{ size: number; color?: string; style?: CSSProperties }> = ({ size, color = C.blueSoft, style }) => (
  <svg viewBox="0 0 200 200" width={size} height={size} style={style}><path d={SPARK_PATH} fill={color} /></svg>
);

export const StarImage: React.FC<{ size: number; rotate?: number; glow?: number; style?: CSSProperties; bright?: boolean }> = ({ size, rotate = 0, glow = 0, style, bright = true }) => (
  <div style={{ position: "relative", width: size, height: size, ...style }}>
    {glow > 0 && <div style={{ position: "absolute", inset: "-30%", borderRadius: "50%", background: `radial-gradient(circle, rgba(60, 120, 255, ${0.55 * glow}) 0%, rgba(40, 90, 255, ${0.22 * glow}) 35%, rgba(40, 90, 255, 0) 68%)` }} />}
    <Img src={staticFile(bright ? "brand/hodd-star.png" : "brand/hodd-star-light.png")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: `rotate(${rotate}deg)` }} />
  </div>
);

/** A number that counts up like the landing's CountUp, in tabular mono figures. */
export const Count: React.FC<{ to: number; from?: number; start: number; duration?: number; decimals?: number; prefix?: string; suffix?: string; style?: CSSProperties }> = ({ to, from = 0, start, duration = 30, decimals = 0, prefix = "", suffix = "", style }) => {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [start, start + duration], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{prefix}{value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
};

/** The black ticker band from the landing page, with spark separators. */
export const Ticker: React.FC<{ items: string[]; speed?: number; tone?: "ink" | "paper" | "blue"; size?: number; style?: CSSProperties }> = ({ items, speed = 0.06, tone = "ink", size = 20, style }) => {
  const frame = useCurrentFrame();
  const colors = { ink: [C.ink, C.paperStrong, C.blueSoft], paper: [C.paperStrong, C.ink, C.blue], blue: [C.blue, "#fff", C.bluePale] }[tone];
  const row = (key: string) => (
    <div key={key} style={{ display: "flex", flexShrink: 0 }}>
      {[...items, ...items].map((item, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 22, paddingRight: 22, whiteSpace: "nowrap" }}><span>{item}</span><Spark size={size * 0.55} color={colors[2]} /></span>
      ))}
    </div>
  );
  return (
    <div style={{ background: colors[0], color: colors[1], height: size * 2.4, display: "flex", alignItems: "center", overflow: "hidden", ...mono, fontSize: size, ...style }}>
      <div style={{ display: "flex", transform: `translateX(${-((frame * speed) % 50)}%)` }}>{row("a")}{row("b")}</div>
    </div>
  );
};

type Crop = { x: number; y: number; w: number; h: number };
const shotSize = (name: string) => (shots as Record<string, number[]>)[name] ?? [3200, 2000];

/** A real console capture (public/shots), optionally cropped to a source-pixel window. */
export const Shot: React.FC<{ name: string; width: number; crop?: Partial<Crop>; style?: CSSProperties; frame?: boolean; hard?: string | false; radius?: number; opacity?: number }> = ({ name, width, crop, style, frame = true, hard = false, radius = 0, opacity = 1 }) => {
  const [iw, ih] = shotSize(name);
  const box: Crop = { x: crop?.x ?? 0, y: crop?.y ?? 0, w: crop?.w ?? iw - (crop?.x ?? 0), h: crop?.h ?? ih - (crop?.y ?? 0) };
  const scale = width / box.w;
  return (
    <div style={{ position: "relative", width, height: box.h * scale, overflow: "hidden", borderRadius: radius, opacity,
      border: frame ? `1px solid rgba(244, 241, 232, 0.18)` : undefined,
      boxShadow: [frame ? "0 60px 140px -30px rgba(0, 0, 0, 0.75)" : "", hard ? `14px 14px 0 ${hard}` : ""].filter(Boolean).join(", ") || undefined, ...style }}>
      <Img src={staticFile(`shots/${name}.png`)} style={{ position: "absolute", left: -box.x * scale, top: -box.y * scale, width: iw * scale, height: ih * scale, maxWidth: "none" }} />
    </div>
  );
};

/** A minimal browser window around a full console screen, so the viewer reads it as the live app. */
export const Window: React.FC<{ width: number; url?: string; children: ReactNode; style?: CSSProperties }> = ({ width, url = "app.hoddfinance.xyz", children, style }) => (
  <div style={{ width, background: C.inkSoft, border: "1px solid rgba(244, 241, 232, 0.2)", boxShadow: "0 80px 160px -40px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(0,0,0,0.4)", ...style }}>
    <div style={{ height: 46, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: "1px solid rgba(244, 241, 232, 0.12)" }}>
      {["#3a3d45", "#3a3d45", "#3a3d45"].map((color, i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: color }} />)}
      <div style={{ marginLeft: 18, flex: 1, maxWidth: 520, height: 28, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", background: C.ink, border: "1px solid rgba(244, 241, 232, 0.1)", ...mono, textTransform: "none", letterSpacing: "0.02em", fontSize: 15, color: "rgba(244, 241, 232, 0.7)" }}>
        <span style={{ width: 9, height: 9, borderRadius: 5, background: C.green }} />{url}
      </div>
    </div>
    {children}
  </div>
);

/** A small mono chip: square bullet and text in a hairline box. */
export const Chip: React.FC<{ children: ReactNode; tone?: "ink" | "paper" | "blue"; at?: number; size?: number; style?: CSSProperties; dot?: string }> = ({ children, tone = "ink", at = 0, size = 18, style, dot }) => {
  const frame = useCurrentFrame();
  const shown = tween(frame, at, at + 16);
  const palette = { ink: { bg: "rgba(16, 19, 25, 0.92)", fg: C.paperStrong, border: "rgba(244, 241, 232, 0.2)" }, paper: { bg: C.paperStrong, fg: C.ink, border: C.ink }, blue: { bg: C.blue, fg: "#fff", border: "rgba(255,255,255,0.4)" } }[tone];
  return (
    <div style={{ ...mono, fontSize: size, display: "inline-flex", alignItems: "center", gap: 12, padding: `${size * 0.55}px ${size * 0.9}px`, background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}`, opacity: shown, transform: `translateY(${(1 - shown) * 18}px) scale(${0.94 + shown * 0.06})`, whiteSpace: "nowrap", ...style }}>
      {dot && <span style={{ width: size * 0.45, height: size * 0.45, background: dot }} />}
      {children}
    </div>
  );
};

/** Corner registration marks (the landing hero's crosshair) to frame a composition. */
export const Crosshair: React.FC<{ x: number; y: number; size?: number; color?: string; at?: number }> = ({ x, y, size = 34, color = "rgba(244,241,232,0.5)", at = 0 }) => {
  const frame = useCurrentFrame();
  const s = tween(frame, at, at + 18);
  return (
    <div style={{ position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size, opacity: s, transform: `rotate(${(1 - s) * 90}deg) scale(${s})` }}>
      <div style={{ position: "absolute", left: size / 2, top: 0, width: 1, height: size, background: color }} />
      <div style={{ position: "absolute", top: size / 2, left: 0, height: 1, width: size, background: color }} />
      <div style={{ position: "absolute", inset: size * 0.22, border: `1px solid ${color}`, borderRadius: "50%" }} />
    </div>
  );
};

/** Fades and lifts a block in at `at`, and out at `out`. */
export const Rise: React.FC<{ at: number; out?: number; children: ReactNode; distance?: number; style?: CSSProperties; duration?: number }> = ({ at, out, children, distance = 40, style, duration = 22 }) => {
  const frame = useCurrentFrame();
  const enter = tween(frame, at, at + duration);
  const leave = out === undefined ? 0 : tween(frame, out, out + 14, 0, 1, EASE_IN);
  return <div style={{ opacity: enter * (1 - leave), transform: `translateY(${(1 - enter) * distance - leave * distance}px)`, ...style }}>{children}</div>;
};
