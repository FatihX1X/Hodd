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

`npm run render` expects a Chrome headless shell; set `HEADLESS_SHELL` to its path if it is not the default one in this environment. The capture script uses `CHROMIUM_PATH` the same way.

The film project has its own `package.json` and is excluded from the app's TypeScript and Vitest runs.
