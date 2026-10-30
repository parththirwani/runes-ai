import { describe, expect, it } from 'vitest';
import {
  SPLIT_KEYBOARD_STEP,
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  clampSplitRatio,
  splitRatioAtPointer,
  splitRatioFromKeyboard,
} from '@/src/lib/editor-split';

describe('split editor geometry', () => {
  it('clamps the divider so neither pane collapses', () => {
    expect(clampSplitRatio(0)).toBe(SPLIT_RATIO_MIN);
    expect(clampSplitRatio(1)).toBe(SPLIT_RATIO_MAX);
    expect(clampSplitRatio(Number.NaN)).toBe(SPLIT_RATIO_DEFAULT);
    expect(clampSplitRatio(0.4)).toBe(0.4);
  });

  it('maps a pointer position inside the split container to the preview width', () => {
    const rect = { left: 100, width: 800 };
    expect(splitRatioAtPointer(500, rect)).toBe(0.5);
    expect(splitRatioAtPointer(100, rect)).toBe(SPLIT_RATIO_MIN);
    expect(splitRatioAtPointer(900, rect)).toBe(SPLIT_RATIO_MAX);
    expect(splitRatioAtPointer(120, { left: 0, width: 0 })).toBe(SPLIT_RATIO_DEFAULT);
  });

  it('nudges the divider with the keyboard and stops at the edges', () => {
    expect(splitRatioFromKeyboard(0.5, 'ArrowLeft')).toBeCloseTo(0.5 - SPLIT_KEYBOARD_STEP);
    expect(splitRatioFromKeyboard(0.5, 'ArrowRight')).toBeCloseTo(0.5 + SPLIT_KEYBOARD_STEP);
    expect(splitRatioFromKeyboard(SPLIT_RATIO_MIN, 'ArrowLeft')).toBe(SPLIT_RATIO_MIN);
    expect(splitRatioFromKeyboard(SPLIT_RATIO_MAX, 'ArrowRight')).toBe(SPLIT_RATIO_MAX);
    expect(splitRatioFromKeyboard(0.5, 'Home')).toBe(SPLIT_RATIO_MIN);
    expect(splitRatioFromKeyboard(0.5, 'End')).toBe(SPLIT_RATIO_MAX);
    expect(splitRatioFromKeyboard(0.5, 'Enter')).toBeNull();
  });
});
