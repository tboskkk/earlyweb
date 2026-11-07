// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { startDrag } from '../src/ui/drag.ts';

function ptr(type: string, x: number, y: number, target: EventTarget = window): PointerEvent {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent;
  Object.defineProperty(e, 'pointerId', { value: 1 });
  if (target !== window) Object.defineProperty(e, 'target', { value: target });
  return e;
}

describe('startDrag', () => {
  it('captures the pointer, reports cumulative deltas, toggles ew-dragging, and ends once', () => {
    const el = document.createElement('div');
    const capture = vi.fn();
    (el as unknown as { setPointerCapture: typeof capture }).setPointerCapture = capture;
    document.body.append(el);
    const moves: Array<[number, number]> = [];
    const onEnd = vi.fn();

    startDrag(ptr('pointerdown', 100, 100, el), (dx, dy) => moves.push([dx, dy]), onEnd);
    expect(capture).toHaveBeenCalledWith(1);
    expect(document.body.classList.contains('ew-dragging')).toBe(true);

    el.dispatchEvent(ptr('pointermove', 110, 95));
    el.dispatchEvent(ptr('pointermove', 130, 120));
    expect(moves).toEqual([
      [10, -5],
      [30, 20],
    ]);

    el.dispatchEvent(ptr('pointerup', 130, 120));
    expect(document.body.classList.contains('ew-dragging')).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);

    el.dispatchEvent(ptr('pointermove', 200, 200));
    el.dispatchEvent(ptr('pointerup', 200, 200));
    expect(moves).toHaveLength(2);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('also ends on pointercancel', () => {
    const el = document.createElement('div');
    (el as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    const onEnd = vi.fn();
    startDrag(ptr('pointerdown', 0, 0, el), () => {}, onEnd);
    el.dispatchEvent(ptr('pointercancel', 0, 0));
    expect(document.body.classList.contains('ew-dragging')).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
