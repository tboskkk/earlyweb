/**
 * Save policy: schedule() debounces churn (drag/resize); flushNow() saves at once
 * (window closed, file changed, page hidden). Nothing is saved until enable() is
 * called after the restore has run, so the empty initial store can never overwrite
 * the stored session.
 */
export function createSessionSaver(opts: { save: () => void; debounceMs: number }) {
  let enabled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
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
        opts.save();
      }, opts.debounceMs);
    },
    flushNow() {
      if (!enabled) return;
      clear();
      opts.save();
    },
  };
}
