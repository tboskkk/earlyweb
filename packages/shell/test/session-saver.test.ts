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

test('idle() resolves immediately when nothing is pending', async () => {
  const s = createSessionSaver({ save: vi.fn(), debounceMs: 500 });
  s.enable();
  await expect(s.idle()).resolves.toBeUndefined();
});

test('idle() resolves only after the in-flight save settles', async () => {
  let done!: () => void;
  const save = vi.fn(() => new Promise<void>((r) => (done = r)));
  const s = createSessionSaver({ save, debounceMs: 500 });
  s.enable();
  s.flushNow();
  let resolved = false;
  const p = s.idle().then(() => {
    resolved = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(resolved).toBe(false);
  done();
  await p;
  expect(resolved).toBe(true);
});

test('idle() flushes a pending debounce, then waits for it', async () => {
  const save = vi.fn(async () => {});
  const s = createSessionSaver({ save, debounceMs: 500 });
  s.enable();
  s.schedule();
  await s.idle();
  expect(save).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(save).toHaveBeenCalledTimes(1);
});

test('a failing save is reported via onError and idle() still resolves', async () => {
  const onError = vi.fn();
  const s = createSessionSaver({ save: () => Promise.reject(new Error('x')), debounceMs: 500, onError });
  s.enable();
  s.flushNow();
  await s.idle();
  expect(onError).toHaveBeenCalledTimes(1);
});
