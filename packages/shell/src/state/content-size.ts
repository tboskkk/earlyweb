// Window chrome around the app content (see themes glass chrome.css):
// 1px window border on each side, 30px titlebar, 3px body margin left/right/bottom.
export const CHROME_W = 2 + 6;
export const CHROME_H = 2 + 30 + 3;

export const toWindowSize = (content: { width: number; height: number }) => ({
  w: content.width + CHROME_W,
  h: content.height + CHROME_H,
});

export const toContentSize = (win: { w: number; h: number }) => ({
  width: Math.max(0, win.w - CHROME_W),
  height: Math.max(0, win.h - CHROME_H),
});
