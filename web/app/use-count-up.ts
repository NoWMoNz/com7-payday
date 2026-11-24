"use client";

import { useEffect, useRef, useState } from "react";

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts up to `target` (and from wherever it is now when `target` changes). Starts at 0, so the first paint is an entrance. */
export function useCountUp(target: number, ms = 900) {
  const [shown, setShown] = useState(0);
  const at = useRef(0);
  useEffect(() => {
    const begin = at.current;
    const t0 = performance.now();
    const dur = reducedMotion() ? 0 : ms;
    let raf = 0;
    const tick = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const value = Math.round(begin + (target - begin) * (1 - Math.pow(1 - k, 3)));
      at.current = value;
      setShown(value);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}
