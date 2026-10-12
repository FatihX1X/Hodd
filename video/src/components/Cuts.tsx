import { AbsoluteFill, useCurrentFrame } from "remotion";
import { scene, type SceneId } from "../timeline";
import { C, EASE_IN, EASE_IN_OUT, EASE_OUT, SPARK_PATH, tween } from "../theme";

type Kind = "wipe" | "rise" | "spark" | "flash";
/** How each scene is entered. Covering transitions end on the next scene's own background, so the cut is invisible. */
const entries: Partial<Record<SceneId, { kind: Kind; color: string }>> = {
  problem: { kind: "rise", color: C.paper },
  reveal: { kind: "flash", color: "#ffffff" },
  overview: { kind: "wipe", color: C.blue },
  engine: { kind: "spark", color: C.blue },
  obligations: { kind: "rise", color: C.ink },
  leadtime: { kind: "wipe", color: C.paper },
  strategies: { kind: "rise", color: C.ink },
  payments: { kind: "wipe", color: C.blue },
  gateway: { kind: "spark", color: C.ink },
  agentBreak: { kind: "rise", color: C.ink },
  autopilot: { kind: "flash", color: "#ffffff" },
  hoddie: { kind: "wipe", color: C.blue },
  claude: { kind: "rise", color: C.paper },
  guardrails: { kind: "wipe", color: C.ink },
  record: { kind: "spark", color: C.ink },
  stack: { kind: "rise", color: C.paper },
  outro: { kind: "flash", color: "#ffffff" },
};

export const Cuts: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Object.entries(entries).map(([id, entry]) => {
        const at = scene(id as SceneId).from;
        if (frame < at - 14 || frame > at + 14) return null;
        return <Cut key={id} at={at} frame={frame} {...entry!} />;
      })}
    </AbsoluteFill>
  );
};

const Cut: React.FC<{ at: number; frame: number; kind: Kind; color: string }> = ({ at, frame, kind, color }) => {
  if (kind === "wipe") {
    const x = frame < at ? tween(frame, at - 11, at, -115, 0, EASE_IN) : tween(frame, at, at + 12, 0, 118, EASE_OUT);
    return (
      <AbsoluteFill style={{ transform: `translateX(${x}%) skewX(-8deg)`, background: color, width: "130%", left: "-15%" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 10, background: color === C.blue ? C.blueSoft : C.blue }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 4, background: color === C.blue ? "#fff" : C.blueSoft, opacity: 0.8 }} />
      </AbsoluteFill>
    );
  }
  if (kind === "rise") {
    if (frame >= at) return null;
    const y = tween(frame, at - 12, at, 105, 0, EASE_IN_OUT);
    return <AbsoluteFill style={{ transform: `translateY(${y}%)`, background: color, borderTop: `6px solid ${C.blue}` }} />;
  }
  if (kind === "spark") {
    if (frame >= at) return null;
    const s = tween(frame, at - 12, at, 0, 22, EASE_IN);
    return (
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 200 200" width={200} height={200} style={{ transform: `scale(${s}) rotate(${s * 9}deg)` }}><path d={SPARK_PATH} fill={color} /></svg>
        <AbsoluteFill style={{ background: color, opacity: tween(frame, at - 3, at, 0, 1) }} />
      </AbsoluteFill>
    );
  }
  const strength = frame < at ? tween(frame, at - 3, at, 0, 0.9) : tween(frame, at, at + 12, 0.9, 0, EASE_OUT);
  return <AbsoluteFill style={{ background: color, opacity: strength }} />;
};
