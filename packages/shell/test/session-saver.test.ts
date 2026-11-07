import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createSessionSaver } from '../src/state/session-saver.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('nothing is saved before enable()', () => {
  const save = vi.fn();
  const s = createSessionSaver({ save, debounceMs: 500 });
  s.schedule();
  s.flushNow();
  vi.advanceTimersByTime(1000);
  expect(save).not.toHaveBeenCalled();
});

test('schedule debounces; reschedule resets the timer', () => {
  const save = vi.fn();
  const s = createSessionSaver({ save, debounceMs: 500 });
  s.enable();
  s.schedule();
  vi.advanceTimersByTime(400);
  s.schedule();
  vi.advanceTimersByTime(400);
  expect(save).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  expect(save).toHaveBeenCalledTimes(1);
});

test('flushNow saves immediately and cancels a pending timer', () => {
  const save = vi.fn();
  const s = createSessionSaver({ save, debounceMs: 500 });
  s.enable();
  s.schedule();
  s.flushNow();
  expect(save).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(save).toHaveBeenCalledTimes(1);
});

test('pending schedule before enable is dropped', () => {
  const save = vi.fn();
  const s = createSessionSaver({ save, debounceMs: 500 });
  s.schedule();
  s.enable();
  vi.advanceTimersByTime(1000);
  expect(save).not.toHaveBeenCalled();
});
