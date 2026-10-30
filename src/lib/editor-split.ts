// Geometry for the split editor divider. The preview pane sits on the left, so its width is the
// ratio the divider controls. Clamped so neither pane can be dragged away entirely.
export const SPLIT_RATIO_MIN = 0.25;
export const SPLIT_RATIO_MAX = 0.75;
export const SPLIT_RATIO_DEFAULT = 0.5;
export const SPLIT_KEYBOARD_STEP = 0.02;

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value));
}

export function splitRatioAtPointer(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return SPLIT_RATIO_DEFAULT;
  return clampSplitRatio((clientX - rect.left) / rect.width);
}

/** Arrow keys nudge the divider; Home and End put it at the edges. Unknown keys return null. */
export function splitRatioFromKeyboard(current: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampSplitRatio(current - SPLIT_KEYBOARD_STEP);
    case 'ArrowRight':
      return clampSplitRatio(current + SPLIT_KEYBOARD_STEP);
    case 'Home':
      return SPLIT_RATIO_MIN;
    case 'End':
      return SPLIT_RATIO_MAX;
    default:
      return null;
  }
}
