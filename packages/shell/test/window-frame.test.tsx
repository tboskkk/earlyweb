// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWindowStore, type WindowState } from '../src/state/windows.ts';
import { WindowFrame } from '../src/ui/WindowFrame.tsx';

function setup(notResponding: boolean) {
  const store = createWindowStore(signal({ width: 1280, height: 800 }));
  const id = store.open({
    appId: 'a',
    instanceId: 'i',
    title: 'Notes',
    icon: '',
    minW: 100,
    minH: 100,
    resizable: true,
    w: 400,
    h: 300,
  });
  const win: WindowState = {
    ...(store.windows.peek().find((w) => w.id === id) as WindowState),
    notResponding,
  };
  const onCloseRequest = vi.fn();
  const onEndTask = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  act(() => {
    render(
      <WindowFrame win={win} store={store} onCloseRequest={onCloseRequest} onEndTask={onEndTask}>
        <p>body</p>
      </WindowFrame>,
      container,
    );
  });
  return { win, container, onCloseRequest, onEndTask };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('WindowFrame', () => {
  it('not responding: shows the suffix and End Task calls onEndTask once', () => {
    const { win, container, onEndTask } = setup(true);
    expect(container.querySelector('.ew-title')?.textContent).toBe('Notes (Not Responding)');
    const btn = container.querySelector('.ew-endtask') as HTMLButtonElement;
    expect(btn.textContent).toBe('End Task');
    act(() => btn.click());
    expect(onEndTask).toHaveBeenCalledTimes(1);
    expect(onEndTask).toHaveBeenCalledWith(win.id);
  });

  it('responding: no End Task button and no suffix', () => {
    const { container } = setup(false);
    expect(container.querySelector('.ew-endtask')).toBeNull();
    expect(container.textContent).not.toContain('End Task');
    expect(container.textContent).not.toContain('(Not Responding)');
  });

  it('close button calls onCloseRequest with the window id', () => {
    const { win, container, onCloseRequest } = setup(false);
    act(() => (container.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
    expect(onCloseRequest).toHaveBeenCalledTimes(1);
    expect(onCloseRequest).toHaveBeenCalledWith(win.id);
  });
});
