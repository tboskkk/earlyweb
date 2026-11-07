// @vitest-environment happy-dom
import { render } from 'preact';
import { expect, test } from 'vitest';
import { AppFrame } from '../src/host/AppFrame.tsx';

test('AppFrame renders a locked-down sandboxed iframe', () => {
  // detached root: happy-dom would otherwise try to load the iframe page
  const root = document.createElement('div');
  render(<AppFrame appId="a.b.c" baseUrl="http://apps.test/a.b.c/" entry="index.html" />, root);
  const frame = root.querySelector('iframe');
  expect(frame).not.toBeNull();
  expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame?.getAttribute('allow')).toBe('');
  expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(frame?.getAttribute('data-app')).toBe('a.b.c');
  expect(frame?.getAttribute('src')).toBe('http://apps.test/a.b.c/index.html');
  expect(frame?.getAttributeNames().sort()).toEqual([
    'allow',
    'data-app',
    'referrerpolicy',
    'sandbox',
    'src',
    'title',
  ]);
  render(null, root);
});
