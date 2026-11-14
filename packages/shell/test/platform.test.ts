import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { APP_ORIGIN } from '../src/config.ts';
import { createPlatform } from '../src/platform.ts';

test('a window without __TAURI_INTERNALS__ gives the web platform', async () => {
  const p = await createPlatform({} as Window);
  expect(p.kind).toBe('web');
  expect(p.appOrigin).toBe(APP_ORIGIN);
  expect(p.invoke).toBeUndefined();
  await p.kv.set('k', 1);
  expect(await p.kv.get('k')).toBe(1);
});
