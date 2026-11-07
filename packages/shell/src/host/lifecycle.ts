import type { Connection } from '../broker/broker.ts';

export function startWatchdog(
  conn: Connection,
  onChange: (notResponding: boolean) => void,
  opts = { intervalMs: 3000, timeoutMs: 5000 },
): () => void {
  let stopped = false;
  let inFlight = false;
  let notResponding = false;

  const set = (value: boolean) => {
    if (stopped || value === notResponding) return;
    notResponding = value;
    onChange(value);
  };

  const tick = () => {
    if (stopped || inFlight) return; // never pile up overlapping pings
    inFlight = true;
    conn.request('ping', undefined, opts.timeoutMs).then(
      () => {
        inFlight = false;
        set(false);
      },
      () => {
        inFlight = false;
        set(true);
      },
    );
  };

  const timer = setInterval(tick, opts.intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** An app that never answers yields 'timeout' so the user can still End Task. */
export async function requestClose(
  conn: Connection,
  timeoutMs = 10000,
): Promise<'close' | 'cancel' | 'timeout'> {
  try {
    const answer = await conn.request('beforeClose', undefined, timeoutMs);
    return answer === false ? 'cancel' : 'close';
  } catch {
    return 'timeout';
  }
}
