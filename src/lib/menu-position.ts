type TriggerRect = Pick<DOMRect, 'top' | 'right' | 'bottom'>;
type MenuSize = { width: number; height: number };
type ViewportSize = { width: number; height: number };

/** Keep a floating menu inside the viewport, opening above its trigger when needed. */
export function positionMenu(trigger: TriggerRect, menu: MenuSize, viewport: ViewportSize) {
  const margin = 8;
  const gap = 4;
  const left = Math.max(margin, Math.min(trigger.right - menu.width, viewport.width - menu.width - margin));
  const below = trigger.bottom + gap;
  const above = trigger.top - menu.height - gap;
  const top = below + menu.height <= viewport.height - margin || above < margin
    ? Math.max(margin, Math.min(below, viewport.height - menu.height - margin))
    : above;

  return { left, top };
}
