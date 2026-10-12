import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { BAR, SCENES, scene, type SceneId } from "./timeline";
import { Cuts } from "./components/Cuts";
import { Intro, Problem, Reveal } from "./scenes/Opening";
import { Engine, LeadTime, Obligations, Overview } from "./scenes/Treasury";
import { Gateway, Payments, Strategies } from "./scenes/Money";
import { AgentBreak, Autopilot, Claude, Hoddie } from "./scenes/Agents";
import { Guardrails, Outro, Record, Stack } from "./scenes/Trust";

const components: Record<SceneId, React.FC> = {
  intro: Intro, problem: Problem, reveal: Reveal, overview: Overview, engine: Engine, obligations: Obligations, leadtime: LeadTime,
  strategies: Strategies, payments: Payments, gateway: Gateway, agentBreak: AgentBreak, autopilot: Autopilot, hoddie: Hoddie,
  claude: Claude, guardrails: Guardrails, record: Record, stack: Stack, outro: Outro,
};

// The score's three impacts: both drops and the final chord.
const IMPACTS = [scene("reveal").from, scene("autopilot").from, scene("outro").from, scene("outro").from + 2 * BAR];

/** A short decaying camera shake on each impact. */
function shake(frame: number) {
  const t = Math.min(...IMPACTS.map((at) => (frame >= at ? frame - at : Infinity)));
  if (t > 16) return "none";
  const amplitude = 9 * Math.exp(-t / 4);
  return `translate(${Math.sin(t * 2.7) * amplitude}px, ${Math.cos(t * 3.4) * amplitude}px) scale(${1 + amplitude / 600})`;
}

/** The Hodd Finance film: eighteen scenes cut on the bar lines of an original 120 BPM score. */
export const Film: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#0b0b0d" }}>
      <AbsoluteFill style={{ transform: shake(frame) }}>
        {SCENES.map(({ id, from, duration }) => {
          const Scene = components[id];
          return <Sequence key={id} from={from} durationInFrames={duration} name={id}><Scene /></Sequence>;
        })}
      </AbsoluteFill>
      <Cuts />
      <Audio src={staticFile("audio/hodd-score.mp3")} />
    </AbsoluteFill>
  );
};
