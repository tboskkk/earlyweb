import type { Theme } from '../types.ts';

export const glass: Theme = {
  id: 'glass',
  name: 'Glass',
  era: '2000s',
  tokens: {
    '--ew-font': '"Segoe UI", Tahoma, "Noto Sans", system-ui, sans-serif',
    '--ew-font-size': '12px',
    '--ew-text': '#10243a',
    '--ew-surface': '#eef4fb',
    '--ew-desktop-bg':
      'radial-gradient(ellipse at 20% 15%, #9fd8ff 0%, transparent 55%), radial-gradient(ellipse at 80% 85%, #3f7fd6 0%, transparent 60%), linear-gradient(160deg, #5fb2ee 0%, #2a6bc4 55%, #17407f 100%)',
    '--ew-window-bg': 'rgba(210, 232, 252, 0.72)',
    '--ew-window-border': 'rgba(255, 255, 255, 0.65)',
    '--ew-window-radius': '6px',
    '--ew-titlebar-bg': 'linear-gradient(180deg, rgba(150, 205, 250, 0.85) 0%, rgba(80, 150, 220, 0.8) 100%)',
    '--ew-titlebar-bg-inactive':
      'linear-gradient(180deg, rgba(205, 222, 240, 0.8) 0%, rgba(170, 195, 222, 0.75) 100%)',
    '--ew-titlebar-fg': '#ffffff',
    '--ew-glass-blur': '8px',
    '--ew-taskbar-bg': 'linear-gradient(180deg, rgba(110, 175, 235, 0.78) 0%, rgba(30, 90, 165, 0.88) 100%)',
    '--ew-accent': '#2f8be6',
    '--ew-selection': 'rgba(47, 139, 230, 0.35)',
    '--ew-button-bg': 'linear-gradient(180deg, #ffffff 0%, #dce9f7 100%)',
    '--ew-button-bg-hover': 'linear-gradient(180deg, #ffffff 0%, #bfdcf8 100%)',
    '--ew-button-border': '#7a9cc0',
  },
};
