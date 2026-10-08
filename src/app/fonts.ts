import localFont from "next/font/local";

/** Display and body face. The variable font carries weight 100–900 and width 62–125%. */
export const archivo = localFont({
  src: "./fonts/Archivo-var-latin.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

/** Labels, figures and ticker copy. */
export const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexMono-600-latin.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});
