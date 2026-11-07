/**
 * Pointer-captured drag. Reports cumulative dx/dy from the initial pointerdown.
 * Adds `ew-dragging` to <body> for the duration so iframes stop eating events.
 */
export function startDrag(
  e: PointerEvent,
  onMove: (dx: number, dy: number) => void,
  onEnd?: () => void,
): void {
  const target = e.target as Element;
  const startX = e.clientX;
  const startY = e.clientY;
  target.setPointerCapture(e.pointerId);
  document.body.classList.add('ew-dragging');

  const move = (ev: PointerEvent) => onMove(ev.clientX - startX, ev.clientY - startY);
  const end = () => {
    target.removeEventListener('pointermove', move as EventListener);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    document.body.classList.remove('ew-dragging');
    onEnd?.();
  };
  target.addEventListener('pointermove', move as EventListener);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
