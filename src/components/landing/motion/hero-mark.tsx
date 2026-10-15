"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import styles from "../landing.module.css";

/** Notches around the landed star (no outer ring): 24 every 15°, the four cardinal ones longer. */
// The 9 o’clock notch is left out: it would sit inside the D’s counter, where the letter belongs in front of the dial.
const notches = Array.from({ length: 24 }, (_, index) => index).filter((index) => index !== 18).map((index) => {
  const angle = (index * 15 * Math.PI) / 180, cardinal = index % 6 === 0, inner = cardinal ? 48.5 : 50.5, outer = cardinal ? 54.5 : 53.5;
  // Rounded so the server's and the browser's trigonometry print the same attributes (no hydration mismatch).
  const at = (value: number) => Math.round(value * 1000) / 1000;
  return { index, cardinal, x1: at(50 + inner * Math.sin(angle)), y1: at(50 - inner * Math.cos(angle)), x2: at(50 + outer * Math.sin(angle)), y2: at(50 - outer * Math.cos(angle)) };
});
const EASE = "cubic-bezier(.2,.75,.15,1)";
const FLIGHT = "cubic-bezier(.3,.55,.2,1)";
const TICK_EVERY = 3200;

/**
 * The hero lockup with its star as a separate layer. The lockup's own star is clipped away and the same artwork
 * (hodd-star-light.png, measured to the pixel) sits in its place, so the resting mark is unchanged. On a first visit
 * the star glides in from the upper right, lands with a flash, rays, halo and notches, then glints and ticks 90°.
 * Behind the wordmark: halo, rays, notches (the letters stay in front). Transform, opacity and stroke-dashoffset only.
 */
export function HeroMark() {
  const flyer = useRef<HTMLDivElement>(null), heading = useRef<HTMLDivElement>(null), spin = useRef<HTMLDivElement>(null), trail = useRef<HTMLSpanElement>(null), beam = useRef<HTMLSpanElement>(null);
  const halo = useRef<HTMLSpanElement>(null), rays = useRef<HTMLSpanElement>(null), core = useRef<HTMLSpanElement>(null), dial = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const host = document.getElementById("top");
    if (!host || !flyer.current || !heading.current || !spin.current || !trail.current || !beam.current || !halo.current || !rays.current || !core.current || !dial.current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const playing: Animation[] = []; const timers: number[] = [];
    const run = (element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => { const animation = element.animate(keyframes, { fill: "both", ...options }); playing.push(animation); return animation; };
    const ticks = [...dial.current.querySelectorAll("line")];
    const glint = (delay: number) => run(beam.current!, [{ transform: "translateX(-60%)" }, { transform: "translateX(60%)" }], { duration: 1050, delay, easing: "cubic-bezier(.5,0,.3,1)", fill: "none" });

    // The idle tick: the star turns a quarter with a slight overshoot, the centre pulses, the rays breathe, a glint passes.
    let turn = 0, loop = 0;
    const tick = () => {
      turn += 90; spin.current!.style.transform = `rotate(${turn}deg)`;
      run(core.current!, [{ opacity: 0, transform: "scale(.6)" }, { opacity: 0.85, transform: "scale(1.5)", offset: 0.3 }, { opacity: 0, transform: "scale(1)" }], { duration: 700, easing: "ease-out", fill: "none" });
      run(rays.current!, [{ opacity: 0, transform: "scale(.9)" }, { opacity: 0.6, transform: "scale(1.08)", offset: 0.35 }, { opacity: 0, transform: "scale(1)" }], { duration: 800, easing: "ease-out", fill: "none" });
      glint(240);
    };
    // Tick only while the hero is on screen and the tab is visible.
    let visible = true;
    const start = () => { if (!loop && visible && document.visibilityState === "visible") loop = window.setInterval(tick, TICK_EVERY); };
    const stop = () => { window.clearInterval(loop); loop = 0; };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start(); else stop(); });
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());

    if (host.dataset.intro === "play") {
      // The score is written from navigation start (flight at 150 ms). If scripts arrive later, the whole score shifts
      // together so the landing marks still meet the star; the CSS headline never waits for any of it.
      const start = Math.max(0, 150 - performance.now());
      const at = (ms: number) => start + ms - 150;
      run(flyer.current, [
        { opacity: 0, transform: "translate(78%,-92%) scale(.22)" },
        { opacity: 1, transform: "translate(46%,-50%) scale(.48)", offset: 0.35 },
        { opacity: 1, transform: "translate(12%,-12%) scale(.86)", offset: 0.78 },
        { opacity: 1, transform: "translate(0,0) scale(1.06)", offset: 0.9 },
        { opacity: 1, transform: "translate(0,0) scale(1)" },
      ], { duration: 1250, delay: at(150), easing: FLIGHT });
      run(heading.current, [{ transform: "rotate(-150deg)" }, { transform: "rotate(-95deg)", offset: 0.35 }, { transform: "rotate(-25deg)", offset: 0.78 }, { transform: "rotate(6deg)", offset: 0.9 }, { transform: "rotate(0deg)" }], { duration: 1250, delay: at(150), easing: FLIGHT });
      run(trail.current, [{ opacity: 0, transform: "rotate(-49deg) scaleX(.2)" }, { opacity: 0.95, transform: "rotate(-49deg) scaleX(1)", offset: 0.3 }, { opacity: 0.6, transform: "rotate(-49deg) scaleX(.7)", offset: 0.75 }, { opacity: 0, transform: "rotate(-49deg) scaleX(0)" }], { duration: 1250, delay: at(150), easing: "ease-out" });
      // Landing: centre flash, rays, halo, notches drawn in.
      run(core.current, [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(2.6)", offset: 0.35 }, { opacity: 0, transform: "scale(1)" }], { duration: 900, delay: at(1200), easing: "ease-out" });
      run(rays.current, [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1.2)", offset: 0.4 }, { opacity: 0, transform: "scale(1)" }], { duration: 1100, delay: at(1220), easing: "cubic-bezier(.2,.8,.2,1)" });
      run(halo.current, [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1.04)", offset: 0.45 }, { opacity: 0.55, transform: "scale(1)" }], { duration: 1400, delay: at(1180), easing: EASE });
      ticks.forEach((line, index) => run(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 320, delay: at(1350 + index * 30), easing: "cubic-bezier(.3,0,.2,1)" }));
      glint(at(1500));
      timers.push(window.setTimeout(() => { observer.observe(host); document.addEventListener("visibilitychange", onVisibility); }, at(2600)));
    } else {
      timers.push(window.setTimeout(() => { observer.observe(host); document.addEventListener("visibilitychange", onVisibility); }, 1200));
    }
    const spinning = spin.current;
    return () => { playing.forEach((animation) => animation.cancel()); timers.forEach((timer) => window.clearTimeout(timer)); stop(); observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); spinning.style.transform = ""; };
  }, []);

  return (
    <div className="relative -ml-[2%] w-full max-w-[1240px]">
      {/* Behind the wordmark, centred on the star: halo, rays, notches. */}
      <div aria-hidden="true" className={styles.markStage}>
        <span ref={halo} className={styles.markHalo} />
        <span ref={rays} className={styles.markRays}><span /><span /></span>
        <svg ref={dial} viewBox="0 0 100 100" className={styles.markDial}>
          {notches.map(({ index, cardinal, ...line }) => <line key={index} {...line} pathLength={1} className={cardinal ? styles.notchMain : undefined} />)}
        </svg>
      </div>
      <Image src="/brand/hodd-lockup-light.png" alt="Hodd Finance" width={1912} height={608} loading="eager" fetchPriority="high" sizes="(min-width: 1360px) 1240px, 100vw" className={`${styles.markWordmark} relative block h-auto w-full`} />
      {/* The lockup's star arm overlaps the D; this covers the stub so only the star layer draws it. */}
      <span aria-hidden="true" className={styles.markPatch} />
      <div aria-hidden="true" className={styles.markStage}>
        <div ref={flyer} className={styles.markFlyer}>
          <span ref={trail} className={styles.markTrail} />
          <div ref={heading} className={styles.markLayer}>
            <div ref={spin} className={styles.markSpin}>
              {/* Unoptimized: the glint mask uses this same file, so it downloads once. */}
              <Image src="/brand/hodd-star-light.png" alt="" width={480} height={480} loading="eager" unoptimized className={styles.markStar} />
              <span className={styles.markShine}><span ref={beam} /></span>
            </div>
          </div>
        </div>
        {/* The landing flash sits over the star (screen blend), so it brightens the star instead of hiding behind it. */}
        <span ref={core} className={styles.markCore} />
      </div>
    </div>
  );
}
