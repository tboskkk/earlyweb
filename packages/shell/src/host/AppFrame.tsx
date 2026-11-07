import { useCallback, useRef } from 'preact/hooks';

type Props = {
  appId: string;
  baseUrl: string;
  entry: string;
  /** Called with the frame's window once mounted (and null on unmount). */
  onWindow?(win: Window | null): void;
};

export function AppFrame({ appId, baseUrl, entry, onWindow }: Props) {
  const latest = useRef(onWindow);
  latest.current = onWindow;
  // Stable ref callback: a changing ref would fire (null, then win) on every render.
  const setRef = useCallback(
    (el: HTMLIFrameElement | null) => latest.current?.(el?.contentWindow ?? null),
    [],
  );
  return (
    <iframe
      sandbox="allow-scripts"
      allow=""
      referrerpolicy="no-referrer"
      title={appId}
      data-app={appId}
      src={baseUrl + entry}
      ref={setRef}
    />
  );
}
