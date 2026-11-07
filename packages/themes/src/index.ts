import type { Theme } from './types.ts';

export { glass } from './glass/tokens.ts';
export type { Theme } from './types.ts';

export function applyTheme(theme: Theme, el: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(theme.tokens)) el.style.setProperty(name, value);
  el.dataset.theme = theme.id;
}
