// What each board can do. One place; the server never guesses from the name elsewhere.
export const BOARDS = Object.freeze({
  amoled18: { touch: true, label: 'AMOLED 1.8' },
  epaper154: { touch: false, label: 'e-paper 1.54' },
});
export const hasTouch = (board) => (BOARDS[board] ? BOARDS[board].touch : true);
