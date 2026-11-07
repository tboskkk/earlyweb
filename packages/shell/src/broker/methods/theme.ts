import type { MethodMap } from '@earlyweb/protocol';
import type { Theme } from '@earlyweb/themes';
import type { Handler } from '../broker.ts';

export function themeHandlers(getTheme: () => Theme): Partial<Record<keyof MethodMap, Handler>> {
  return { 'theme.get': async () => ({ tokens: getTheme().tokens }) };
}
