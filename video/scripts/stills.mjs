// Renders single frames for review: node scripts/stills.mjs 120 600 900 ...  (frames, or scene ids like overview+90)
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browserExecutable = process.env.HEADLESS_SHELL || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const timeline = JSON.parse(readFileSync(join(root, "src", "timeline.json"), "utf8"));
const starts = {}; let cursor = 0;
for (const scene of timeline.scenes) { starts[scene.id] = cursor; cursor += scene.bars * timeline.framesPerBar; }
const frames = process.argv.slice(2).map((arg) => { const [id, offset = "0"] = arg.split("+"); return id in starts ? starts[id] + Number(offset) : Number(arg); });

const out = join(root, "out", "stills");
mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: join(root, "src", "index.ts") });
const composition = await selectComposition({ serveUrl, id: "HoddFilm", browserExecutable });
for (const frame of frames) {
  await renderStill({ composition, serveUrl, frame, output: join(out, `${String(frame).padStart(4, "0")}.jpg`), imageFormat: "jpeg", jpegQuality: 85, scale: 0.5, browserExecutable });
  console.log("still", frame);
}
