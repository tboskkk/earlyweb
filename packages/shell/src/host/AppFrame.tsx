type Props = {
  appId: string;
  baseUrl: string;
  entry: string;
  /** Called with the frame's window once mounted (and null on unmount). */
  onWindow?(win: Window | null): void;
};

export function AppFrame({ appId, baseUrl, entry, onWindow }: Props) {
  return (
    <iframe
      sandbox="allow-scripts"
      allow=""
      referrerpolicy="no-referrer"
      title={appId}
      data-app={appId}
      src={baseUrl + entry}
      ref={(el: HTMLIFrameElement | null) => onWindow?.(el?.contentWindow ?? null)}
    />
  );
}
