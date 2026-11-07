import { EwError } from '@earlyweb/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Connection } from '../src/broker/broker.ts';
import { requestClose, startWatchdog } from '../src/host/lifecycle.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Fake = Connection & { request: ReturnType<typeof vi.fn> };
const fakeConn = (request: (...a: unknown[]) => Promise<unknown>): Fake =>
  ({ request: vi.fn(request), emit: vi.fn(), detach: vi.fn(), droppedCount: () => 0 }) as unknown as Fake;

const hang = (timeoutMs: unknown) =>
  new Promise((_, rej) => setTimeout(() => rej(new EwError('ECANCELED', 'timeout')), timeoutMs as number));

test('watchdog reports true once after an unanswered ping, then false when a later ping is answered', async () => {
  let answer = false;
  const conn = fakeConn((_n, _d, t) => (answer ? Promise.resolve(true) : hang(t)));
  const onChange = vi.fn();
  const stop = startWatchdog(conn, onChange, { intervalMs: 1000, timeoutMs: 2500 });
  await vi.advanceTimersByTimeAsync(3400);
  expect(onChange).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith(true);
  await vi.advanceTimersByTimeAsync(5000); // further unanswered pings do not re-report
  expect(onChange).toHaveBeenCalledTimes(1);
  answer = true;
  await vi.advanceTimersByTimeAsync(3000);
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith(false);
  stop();
});

test('watchdog never has overlapping pings', async () => {
  const conn = fakeConn((_n, _d, t) => hang(t));
  const stop = startWatchdog(conn, () => {}, { intervalMs: 1000, timeoutMs: 5000 });
  await vi.advanceTimersByTimeAsync(4900);
  expect(conn.request).toHaveBeenCalledTimes(1);
  expect(conn.request).toHaveBeenCalledWith('ping', undefined, 5000);
  stop();
});

test('the stop function clears the timers and silences reports', async () => {
  const conn = fakeConn((_n, _d, t) => hang(t));
  const onChange = vi.fn();
  const stop = startWatchdog(conn, onChange, { intervalMs: 1000, timeoutMs: 2000 });
  await vi.advanceTimersByTimeAsync(1100);
  stop();
  await vi.advanceTimersByTimeAsync(20000);
  expect(conn.request).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test('requestClose -> close when the app answers true', async () => {
  const conn = fakeConn(async () => true);
  await expect(requestClose(conn)).resolves.toBe('close');
  expect(conn.request).toHaveBeenCalledWith('beforeClose', undefined, 10000);
});

test('requestClose -> cancel when the app answers false', async () => {
  await expect(requestClose(fakeConn(async () => false))).resolves.toBe('cancel');
});

test('requestClose -> timeout when the app never answers', async () => {
  const conn = fakeConn((_n, _d, t) => hang(t));
  const p = requestClose(conn, 10000);
  await vi.advanceTimersByTimeAsync(10000);
  await expect(p).resolves.toBe('timeout');
});
