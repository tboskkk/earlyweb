/**
 * Save policy: schedule() debounces churn (drag/resize); flushNow() saves at once
 * (window closed, file changed, page hidden). Nothing is saved until enable() is
 * called after the restore has run, so the empty initial store can never overwrite
 * the stored session. idle() flushes any pending debounce and resolves once no save
 * is in flight (lets an e2e test await durability before reloading).
 */
export function createSessionSaver(opts: {
  save: () => void | Promise<void>;
  debounceMs: number;
  onError?: (err: unknown) => void;
}) {
  let enabled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> = Promise.resolve();
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  // save() is invoked synchronously (a snapshot is taken now); IndexedDB orders the writes.
  const run = () => {
    let p: Promise<void>;
    try {
      p = Promise.resolve(opts.save());
    } catch (err) {
      p = Promise.reject(err);
    }
    const tracked = p.catch((err) => opts.onError?.(err));
    const prev = inflight;
    inflight = Promise.all([prev, tracked]).then(() => {});
  };
  return {
    enable() {
      enabled = true;
    },
    schedule() {
      if (!enabled) return;
      clear();
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, opts.debounceMs);
    },
    flushNow() {
      if (!enabled) return;
      clear();
      run();
    },
    async idle() {
      if (timer !== undefined) this.flushNow();
      await inflight;
    },
  };
}
