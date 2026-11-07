import { useEffect, useRef } from 'preact/hooks';
import type { DialogIcon, MessageRequest } from './dialog-service.ts';

const COLORS: Record<DialogIcon, string> = {
  info: '#2f8be6',
  warning: '#e8a317',
  error: '#d6382f',
  question: '#2f8be6',
};
const GLYPH: Record<DialogIcon, string> = { info: 'i', warning: '!', error: '×', question: '?' };

export function DialogIconShape({ icon }: { icon: DialogIcon }) {
  return (
    <svg class="ew-dlg-icon" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      {icon === 'warning' ? (
        <path d="M20 3 38 35H2Z" fill={COLORS[icon]} stroke="#7a5200" stroke-width="1.5" />
      ) : (
        <circle
          cx="20"
          cy="20"
          r="17"
          fill={COLORS[icon]}
          stroke="#10243a"
          stroke-opacity=".5"
          stroke-width="1.5"
        />
      )}
      <text x="20" y="28" text-anchor="middle" font-size="22" font-weight="700" fill="#fff">
        {GLYPH[icon]}
      </text>
    </svg>
  );
}

export function MessageBox({ req }: { req: MessageRequest }) {
  const def = useRef<HTMLButtonElement>(null);
  const defIdx = Math.max(0, req.buttons.indexOf(req.defaultButton));
  useEffect(() => def.current?.focus(), []);
  return (
    <div class="ew-dlg-body ew-msg">
      <DialogIconShape icon={req.icon} />
      <div class="ew-msg-text">{req.text}</div>
      <div class="ew-dlg-buttons">
        {req.buttons.slice(0, 3).map((label, i) => (
          <button
            key={i}
            type="button"
            class="ew-btn"
            ref={i === defIdx ? def : undefined}
            onClick={() => req.resolve(label)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
