/**
 * Boot-time session restore. The saver is enabled only when the stored session was
 * readable: if `load` itself throws, the stored data is left untouched and saving stays
 * off (otherwise the next save would overwrite a session we merely failed to read).
 * A failure while restoring still enables saving, as the stored data was read fine.
 */
export async function bootSession<T>(deps: {
  load(): Promise<T>;
  restore(records: T): void;
  enable(): void;
  onError?(what: string, err: unknown): void;
}): Promise<void> {
  const report = deps.onError ?? ((what, err) => console.error(what, err));
  let records: T;
  try {
    records = await deps.load();
  } catch (err) {
    report('session load failed', err);
    return;
  }
  try {
    deps.restore(records);
  } catch (err) {
    report('session restore failed', err);
  }
  deps.enable();
}
