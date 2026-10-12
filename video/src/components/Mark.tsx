import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";
import { EASE_IN_OUT, EASE_OUT, tween } from "../theme";

// Geometry from src/components/landing/landing.module.css, measured on hodd-lockup-light.png (1912×608):
// the lockup's own star is clipped away and hodd-star-light.png sits in its place on a square stage.
const ASPECT = 608 / 1912;
const CLIP = "polygon(0 0, 81.6% 0, 81.6% 31.6%, 79.55% 31.6%, 79.55% 100%, 0 100%)";
const notches = Array.from({ length: 24 }, (_, index) => index).filter((index) => index !== 18).map((index) => {
  const angle = (index * 15 * Math.PI) / 180, cardinal = index % 6 === 0, inner = cardinal ? 48.5 : 50.5, outer = cardinal ? 54.5 : 53.5;
  return { index, cardinal, x1: 50 + inner * Math.sin(angle), y1: 50 - inner * Math.cos(angle), x2: 50 + outer * Math.sin(angle), y2: 50 - outer * Math.cos(angle) };
});

/**
 * The HODD lockup with its star as a separate layer, after the landing hero: the star glides in from the upper right,
 * lands at `land` with a flash, rays, halo and notches, then glints; `ticks` turn it a quarter with an overshoot.
 * `dark` renders the wordmark in paper colour for ink backgrounds.
 */
export const Mark: React.FC<{ width: number; land: number; dark?: boolean; reveal?: number; ticks?: number[]; style?: CSSProperties; dial?: boolean }> = ({ width, land, dark = false, reveal, ticks = [], style, dial = true }) => {
  const frame = useCurrentFrame();
  const t = frame - land;
  const flight = 36;
  const p = tween(frame, land - flight, land, 0, 1, EASE_IN_OUT);
  const x = interpolate(p, [0, 0.35, 0.78, 0.9, 1], [78, 46, 12, 0, 0]);
  const y = interpolate(p, [0, 0.35, 0.78, 0.9, 1], [-92, -50, -12, 0, 0]);
  const s = interpolate(p, [0, 0.35, 0.78, 0.9, 1], [0.22, 0.48, 0.86, 1.06, 1]);
  const spinIn = interpolate(p, [0, 1], [-200, 0]);
  const tickTurn = ticks.reduce((turn, at) => turn + 90 * Math.min(1.06, Math.max(0, springish(frame - at))), 0);
  const flash = t < 0 ? 0 : interpolate(t, [0, 5, 22], [0, 1, 0], { extrapolateRight: "clamp" });
  const rays = t < 0 ? 0 : interpolate(t, [0, 7, 26], [0, 0.85, 0], { extrapolateRight: "clamp" });
  const halo = t < 0 ? 0 : tween(frame, land, land + 20, 0, 0.6);
  const notchDraw = t < 0 ? 0 : tween(frame, land + 2, land + 30);
  const glint = (offset: number) => tween(frame, offset, offset + 30, -60, 60, EASE_IN_OUT);
  const glints = [land + 8, ...ticks.map((at) => at + 6)];
  const lastGlint = glints.filter((at) => frame >= at).at(-1) ?? land + 8;
  const letters = reveal === undefined ? 1 : reveal;
  const trail = t < 0 ? interpolate(p, [0, 0.3, 0.85, 1], [0, 0.9, 0.6, 0]) : 0;
  const wordFilter = dark ? "invert(1) sepia(0.14) brightness(0.97)" : undefined;
  const notchColor = dark ? "rgba(244, 241, 232, 0.4)" : "rgba(11, 11, 13, 0.32)";
  const notchMain = dark ? "rgba(244, 241, 232, 0.7)" : "rgba(11, 11, 13, 0.55)";

  return (
    <div style={{ position: "relative", width, height: width * ASPECT, ...style }}>
      <div style={{ position: "absolute", inset: 0, filter: wordFilter, clipPath: `inset(-5% ${(1 - letters) * 100}% -5% 0)` }}>
        <Img src={staticFile("brand/hodd-lockup-light.png")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", clipPath: CLIP }} />
        <span style={{ position: "absolute", left: "76.83%", top: "44.57%", width: "2.72%", height: "3.62%", background: "#0b0b0a" }} />
      </div>
      <div style={{ position: "absolute", left: "74.741%", top: "5.765%", width: "25.936%", aspectRatio: "1" }}>
        <span style={{ position: "absolute", inset: "-14%", borderRadius: "50%", opacity: halo * (dark ? 1.4 : 1), background: "radial-gradient(circle, rgba(10, 82, 232, 0.3) 0%, rgba(127, 166, 255, 0.16) 36%, rgba(127, 166, 255, 0) 66%)" }} />
        <span style={{ position: "absolute", inset: 0, opacity: rays }}>
          <span style={{ position: "absolute", left: "50%", top: "50%", width: "124%", height: 3, transform: "translate(-50%, -50%)", background: "linear-gradient(90deg, rgba(10,82,232,0), rgba(10,82,232,.85) 38%, #fff 50%, rgba(10,82,232,.85) 62%, rgba(10,82,232,0))" }} />
          <span style={{ position: "absolute", left: "50%", top: "50%", width: 3, height: "124%", transform: "translate(-50%, -50%)", background: "linear-gradient(180deg, rgba(10,82,232,0), rgba(10,82,232,.85) 38%, #fff 50%, rgba(10,82,232,.85) 62%, rgba(10,82,232,0))" }} />
        </span>
        {dial && (
          <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
            {notches.map(({ index, cardinal, ...line }) => <line key={index} {...line} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - notchDraw} stroke={cardinal ? notchMain : notchColor} strokeWidth={cardinal ? 0.55 : 0.35} />)}
          </svg>
        )}
        <div style={{ position: "absolute", inset: 0, transform: `translate(${x}%, ${y}%) scale(${s})` }}>
          <span style={{ position: "absolute", left: "50%", top: "50%", width: "120%", height: 3, transformOrigin: "0 50%", transform: "rotate(-49deg)", borderRadius: 2, opacity: trail, background: "linear-gradient(90deg, rgba(255,255,255,.95), rgba(10,82,232,.6) 12%, rgba(10,82,232,.2) 45%, rgba(10,82,232,0))" }} />
          <div style={{ position: "absolute", inset: 0, transform: `rotate(${spinIn + tickTurn}deg)` }}>
            {/* On ink the bright artwork (hodd-star.png) replaces the paper one, scaled to the same arm span. */}
            {dark
              ? <Img src={staticFile("brand/hodd-star.png")} style={{ position: "absolute", left: "-11.33%", top: "-12.48%", width: "121.4%", height: "121.4%" }} />
              : <Img src={staticFile("brand/hodd-star-light.png")} style={{ position: "absolute", left: "-0.629%", top: "-1.775%", width: "100%", height: "100%" }} />}
            <span style={{ position: "absolute", left: "-0.629%", top: "-1.775%", width: "100%", height: "100%", overflow: "hidden", WebkitMaskImage: `url(${staticFile("brand/hodd-star-light.png")})`, WebkitMaskSize: "100% 100%", maskImage: `url(${staticFile("brand/hodd-star-light.png")})`, maskSize: "100% 100%" }}>
              <span style={{ position: "absolute", inset: 0, transform: `translateX(${glint(lastGlint)}%)`, background: "linear-gradient(118deg, rgba(255,255,255,0) 40%, rgba(255,255,255,.95) 50%, rgba(255,255,255,0) 60%)" }} />
            </span>
          </div>
        </div>
        <span style={{ position: "absolute", left: "43%", top: "43%", width: "14%", aspectRatio: "1", borderRadius: "50%", opacity: flash, transform: `scale(${1 + flash * 1.6})`, mixBlendMode: "screen", background: "radial-gradient(circle, #fff 0%, rgba(255,255,255,.95) 20%, rgba(127,166,255,.65) 45%, rgba(127,166,255,0) 70%)" }} />
      </div>
    </div>
  );
};

/** 0 → 1 with a small overshoot, like the hero's quarter-turn transition (cubic-bezier .32,1.42,.48,1 over .75 s). */
function springish(t: number) {
  if (t <= 0) return 0;
  const p = Math.min(1, t / 22);
  return interpolate(p, [0, 0.55, 0.8, 1], [0, 1.08, 0.99, 1], { easing: EASE_OUT });
}
