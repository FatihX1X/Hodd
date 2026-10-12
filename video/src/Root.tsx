import { Composition, Still } from "remotion";
import { Film } from "./Film";
import { FPS, TOTAL_FRAMES } from "./timeline";
import { Poster } from "./scenes/Poster";
import "./fonts";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="HoddFilm" component={Film} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
    <Still id="HoddPoster" component={Poster} width={1920} height={1080} />
  </>
);
