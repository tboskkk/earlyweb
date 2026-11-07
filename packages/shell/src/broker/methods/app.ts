import type { MethodMap } from '@earlyweb/protocol';
import type { Handler } from '../broker.ts';

export function appHandlers(deps: {
  onReady(instanceId: string): void;
}): Partial<Record<keyof MethodMap, Handler>> {
  return {
    'app.ready': async (ctx) => {
      deps.onReady(ctx.instance.instanceId);
      return null;
    },
  };
}
