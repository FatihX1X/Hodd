import { continueRender, delayRender, staticFile } from "remotion";

/** Hodd's own faces (SIL Open Font License), self-hosted like the app: Archivo for display, IBM Plex Mono for labels. */
const faces = [
  new FontFace("Archivo", `url(${staticFile("fonts/Archivo-var-latin.woff2")}) format("woff2")`, { weight: "100 900", stretch: "62% 125%" }),
  new FontFace("Plex Mono", `url(${staticFile("fonts/IBMPlexMono-400-latin.woff2")}) format("woff2")`, { weight: "400" }),
  new FontFace("Plex Mono", `url(${staticFile("fonts/IBMPlexMono-500-latin.woff2")}) format("woff2")`, { weight: "500" }),
  new FontFace("Plex Mono", `url(${staticFile("fonts/IBMPlexMono-600-latin.woff2")}) format("woff2")`, { weight: "600" }),
];

const handle = delayRender("Loading Hodd fonts");
Promise.all(faces.map((face) => face.load()))
  .then((loaded) => { loaded.forEach((face) => document.fonts.add(face)); continueRender(handle); })
  .catch((error) => { console.error(error); continueRender(handle); });
