import { describe, expect, it } from 'vitest';
import { positionMenu } from '@/src/lib/menu-position';

const menu = { width: 176, height: 220 };
const viewport = { width: 390, height: 640 };

describe('document action menu placement', () => {
  it('opens to the right of the trigger when there is room', () => {
    expect(positionMenu({ top: 120, right: 120, bottom: 164 }, menu, viewport, true)).toEqual({ left: 124, top: 120 });
  });

  it('opens below the trigger when there is room', () => {
    expect(positionMenu({ top: 120, right: 360, bottom: 164 }, menu, viewport)).toEqual({ left: 184, top: 168 });
  });

  it('opens above the last row rather than falling below the viewport', () => {
    expect(positionMenu({ top: 570, right: 360, bottom: 614 }, menu, viewport)).toEqual({ left: 184, top: 346 });
  });

  it('keeps the menu inside the viewport after horizontal scrolling', () => {
    expect(positionMenu({ top: 120, right: 70, bottom: 164 }, menu, viewport)).toEqual({ left: 8, top: 168 });
  });
});
