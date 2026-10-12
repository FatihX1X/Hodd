import { Easing, interpolate, spring } from "remotion";
import type { CSSProperties } from "react";

/** Hodd design language: paper and ink, one blue, chrome used sparingly (src/app/globals.css). */
export const C = {
  ink: "#0b0b0d",
  inkSoft: "#101319",
  paper: "#ece8dd",
  paperStrong: "#f4f1e8",
  stone: "#e3dfd2",
  muted: "#5a5953",
  blue: "#0a52e8",
  blueSoft: "#7fa6ff",
  bluePale: "#b9ccff",
  blueLabel: "#8fb0ff",
  green: "#7fe3a8",
  greenText: "#8fe388",
  amber: "#ffd27f",
  danger: "#dc7d71",
  lineDark: "rgba(244, 241, 232, 0.14)",
  lineLight: "rgba(11, 11, 13, 0.15)",
} as const;

export const display: CSSProperties = {
  fontFamily: "Archivo, sans-serif",
  fontStretch: "125%",
  fontWeight: 800,
  letterSpacing: "-0.035em",
  lineHeight: 0.92,
  textTransform: "uppercase",
};

export const mono: CSSProperties = {
  fontFamily: "'Plex Mono', monospace",
  fontVariantNumeric: "tabular-nums",
  textTransform: "uppercase",
  letterSpacing: "0.09em",
  fontWeight: 500,
};

export const body: CSSProperties = { fontFamily: "Archivo, sans-serif", fontStretch: "100%", fontWeight: 400 };

/** The app's own curves: expo-out for arrivals (progress rail), a firm in-out for camera moves. */
export const EASE_OUT = Easing.bezier(0.19, 1, 0.22, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const EASE_IN = Easing.bezier(0.55, 0, 0.9, 0.3);

export function tween(frame: number, start: number, end: number, from = 0, to = 1, easing = EASE_OUT) {
  return interpolate(frame, [start, end], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}

export function pop(frame: number, delay = 0, stiff = 170, damping = 15) {
  return spring({ frame: frame - delay, fps: 30, config: { stiffness: stiff, damping, mass: 0.7 } });
}

export const SPARK_PATH = "M100 0Q110 90 200 100Q110 110 100 200Q90 110 0 100Q90 90 100 0Z";
