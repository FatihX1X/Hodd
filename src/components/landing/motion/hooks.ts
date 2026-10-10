"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * True once the page has hydrated and the visitor has not asked for reduced motion.
 * Everything renders in its finished, static state until then, so the page reads
 * correctly without JavaScript and for anyone who prefers no motion.
 */
export function useArmed() {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Arm only once the animation features are in: exit animations started earlier would never finish.
    let id = 0;
    let live = true;
    void loadFeatures().then(() => { if (live) id = requestAnimationFrame(() => setMounted(true)); });
    return () => { live = false; cancelAnimationFrame(id); };
  }, []);
  return mounted && !reduced;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Pauses looping scenes while the tab is in the background. */
export function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export const EASE_OUT = [0.19, 1, 0.22, 1] as const;

/** LazyMotion's features, fetched after first paint and shared by every scene. */
export const loadFeatures = () => import("./features").then((module) => module.default);
