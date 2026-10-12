import data from "./timeline.json";

/** The film and its score share one timeline: 120 BPM at 30 fps, so a beat is 15 frames and a bar is 60. */
export const FPS = data.fps;
export const BAR = data.framesPerBar;
export const BEAT = BAR / 4;

export type SceneId = (typeof data.scenes)[number]["id"];
export type Scene = { id: SceneId; from: number; duration: number };

export const SCENES: Scene[] = (() => {
  let from = 0;
  return data.scenes.map((scene) => {
    const item = { id: scene.id as SceneId, from, duration: scene.bars * BAR };
    from += item.duration;
    return item;
  });
})();

export const TOTAL_FRAMES = SCENES.reduce((sum, scene) => sum + scene.duration, 0);
export const scene = (id: SceneId) => SCENES.find((item) => item.id === id)!;
