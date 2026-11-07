import type { ComponentChildren } from 'preact';
import type { CatalogEntry } from '../state/catalog.ts';
import type { WindowState, WindowStore } from '../state/windows.ts';
import { Taskbar } from './Taskbar.tsx';
import { WindowFrame } from './WindowFrame.tsx';

type Props = {
  store: WindowStore;
  apps: CatalogEntry[];
  onLaunch(appId: string): void;
  renderApp(win: WindowState): ComponentChildren;
  onCloseRequest(id: string): void;
  onEndTask(id: string): void;
};

export function Desktop({ store, apps, onLaunch, renderApp, onCloseRequest, onEndTask }: Props) {
  return (
    <div class="ew-desktop">
      {store.windows.value.map((win) => (
        <WindowFrame
          key={win.id}
          win={win}
          store={store}
          onCloseRequest={onCloseRequest}
          onEndTask={onEndTask}
        >
          {renderApp(win)}
        </WindowFrame>
      ))}
      <Taskbar store={store} apps={apps} onLaunch={onLaunch} />
    </div>
  );
}
