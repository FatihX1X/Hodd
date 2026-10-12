import { Backdrop, Crosshair, Label } from "../components/kit";
import { Mark } from "../components/Mark";
import { C, display, mono } from "../theme";

/** A still for thumbnails and the video cover: the landed mark and the promise. */
export const Poster: React.FC = () => (
  <Backdrop tone="ink" glow={[50, 44]} glowStrength={0.5}>
    <Crosshair x={960} y={120} at={-100} />
    <Label size={20} color="rgba(244,241,232,0.72)" style={{ position: "absolute", left: 96, top: 84 }}>Treasury that plans ahead</Label>
    <Label size={20} color="rgba(244,241,232,0.72)" style={{ position: "absolute", right: 96, top: 84 }}>On Arc</Label>
    <div style={{ position: "absolute", left: 360, top: 290 }}><Mark width={1200} land={-200} dark /></div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 720, textAlign: "center", ...display, fontSize: 64, color: C.paperStrong }}>Your capital, <span style={{ color: C.blueSoft }}>ahead of time.</span></div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 830, textAlign: "center", ...mono, fontSize: 26, color: C.paperStrong }}>hoddfinance.xyz</div>
  </Backdrop>
);
