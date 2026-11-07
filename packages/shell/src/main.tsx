import '@earlyweb/themes/glass/chrome.css';
import { applyTheme, glass } from '@earlyweb/themes';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { createWindowStore } from './state/windows.ts';
import { Desktop } from './ui/Desktop.tsx';

applyTheme(glass);

const viewport = signal({ width: window.innerWidth, height: window.innerHeight });
window.addEventListener('resize', () => {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
});
const store = createWindowStore(viewport);

render(
  <Desktop
    store={store}
    apps={[]}
    onLaunch={() => {}}
    renderApp={() => null}
    onCloseRequest={(id) => store.close(id)}
    onEndTask={(id) => store.close(id)}
  />,
  document.getElementById('app') as HTMLElement,
);
