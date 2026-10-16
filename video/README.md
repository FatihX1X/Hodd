# Hodd Finance launch film

A two-minute motion-design film for Hodd Finance, written in code with [Remotion](https://www.remotion.dev/) and cut to an original 120 BPM score that is also generated in code.

- 1920×1080, 30 fps, 122 seconds (61 bars at 120 BPM; a bar is 60 frames).
- Every console shot is a real capture of this repository's app (`public/shots`), rendered by the production build.
- Brand assets, fonts and colours come from the app itself: `public/brand`, Archivo and IBM Plex Mono, ink `#0b0b0d`, paper `#ece8dd`, blue `#0a52e8`.
- The protection lead time is shown as the owner's choice of 3 to 30 days, as the Policy page allows.

## Structure

| Path | What it is |
| --- | --- |
| `src/timeline.json` | The single timeline: every scene's length in bars and its musical section. The film and the score both read it. |
| `src/Film.tsx` | The composition: eighteen scenes as sequences, the cut transitions and the score. |
| `src/scenes/*` | Opening (intro, problem, reveal), Treasury (overview, engine, obligations, lead time), Money (strategies, payments, Gateway), Agents (Autopilot, Hoddie, Claude), Trust (guardrails, activity, stack, outro). |
| `src/components/kit.tsx` | Backdrop grid, word-mask reveals, labels, chips, counters, ticker, framed captures. |
| `src/components/Mark.tsx` | The HODD mark with the star landing, after the landing page hero (same measured geometry). |
| `scripts/capture-app.mjs` | Captures the console screens with Playwright, using the e2e tests' browser-side session and data interception. Nothing hosted is read or changed. |
| `scripts/compose_music.py` | Synthesizes the score (drums, bass, supersaw pads, arpeggio, lead, risers, impacts) from scratch and writes `public/audio/hodd-score.mp3`. |
| `scripts/stills.mjs` | Renders single frames for review, e.g. `node scripts/stills.mjs overview+90 hoddie+200`. |

## Rebuild

```bash
# 1. Real console screens (from the repo root: build and serve the app first)
pnpm build && pnpm exec next start -p 3107 &
node video/scripts/capture-app.mjs          # all scenes, or name some: overview earn hoddie

# 2. Score (Python 3 with numpy and scipy, plus ffmpeg)
cd video
python3 scripts/compose_music.py

# 3. Film
npm install
npm run studio                              # preview and scrub in the browser
npm run render                              # out/hodd-finance-film.mp4
```

## The demo (`HoddDemo`)

A 140-second voiced and subtitled product demo, 1920×1080 at 60 fps. Its sections are hook, live treasury, agent wallet and limits, the AI advisor decision, execution with its Arcscan receipt, USYC, Hoddie/Claude/Gateway, and the outro. Every figure on screen is traced in [`demo/EVIDENCE.md`](demo/EVIDENCE.md). The timed voiceover is [`demo/SCRIPT.md`](demo/SCRIPT.md), and the subtitles are also in [`demo/hodd-demo.srt`](demo/hodd-demo.srt).

| Path | What it is |
| --- | --- |
| `src/demo/Demo.tsx`, `src/demo/kit.tsx` | The composition: scenes, the camera over real captures, highlight marks, source tags, ticker and burned-in captions. |
| `demo/voiceover.json` | The narration. `caption` is what the subtitles show; `say` is the same line spelled for the speech model. |
| `demo/evidence/*.json` | Arc receipts and state reads, plus the production Autopilot records the film quotes. |
| `scripts/verify-evidence.mjs`, `read-balances.mjs`, `read-vault-config.mjs` | Read-only chain checks that write `demo/evidence/*.json`. They send no transactions. |
| `scripts/capture-demo.mjs` | Captures hoddfinance.xyz, the Arcscan pages and the console into `public/demo/shots`. Nothing is signed. |
| `scripts/voiceover.py` | Kokoro TTS (Apache-2.0, local) → `public/demo/voiceover.wav` and `src/demo/captions.json`. |
| `scripts/mix_demo.py` | Bed music ducked under the voice → `public/demo/soundtrack.mp3`. |
| `scripts/write_script.py` | `demo/SCRIPT.md` and `demo/hodd-demo.srt` from the captions. |

```bash
# from video/
node scripts/verify-evidence.mjs && node scripts/read-balances.mjs && node scripts/read-vault-config.mjs
(cd .. && node video/scripts/capture-demo.mjs)       # with the app served on :3107 as above
python3 scripts/compose_music.py --bed --timeline src/demo/music-timeline.json --out hodd-demo-bed
pip install kokoro-onnx soundfile scipy               # plus kokoro-v1.0.onnx and voices-v1.0.bin in KOKORO_DIR
python3 scripts/voiceover.py "$KOKORO_DIR"
python3 scripts/mix_demo.py && python3 scripts/write_script.py
npm run render:demo                                  # out/hodd-demo.mp4
```

`npm run render` expects a Chrome headless shell; set `HEADLESS_SHELL` to its path if it is not the default one in this environment. The capture script uses `CHROMIUM_PATH` the same way.

The film project has its own `package.json` and is excluded from the app's TypeScript and Vitest runs.
