/** Touch-first device (phone / tablet). Touchscreen laptops with a mouse stay in keyboard mode. */
export const IS_TOUCH =
  typeof window !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) &&
  !!window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Keep the horizontal field of view sensible on tall (portrait) screens:
 * a vertical FOV tuned for 16:9 would show only a sliver of road on a phone held upright.
 */
export function fovForAspect(fovDeg: number, aspect: number) {
  if (aspect >= 1.2) return fovDeg;
  const k = Math.pow(Math.max(aspect, 0.35) / 1.2, 0.62);
  const t = Math.tan((fovDeg * Math.PI) / 360) / k;
  return Math.min(100, (Math.atan(t) * 360) / Math.PI);
}

/** Drawing-buffer height in pixels (kept current by the game), for screen-sized point sprites. */
export const VIEW = { h: 800 };
