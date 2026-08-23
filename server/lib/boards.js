// What each board can do. One place; the server never guesses from the name elsewhere.
export const BOARDS = Object.freeze({
  amoled18: { touch: true, label: 'AMOLED 1.8', citizen: 'The AMOLED citizen', blurb: 'A citizen with a face. Waveshare ESP32-S3-Touch-AMOLED-1.8 (V2).', variety: 'russet' },
  epaper154: { touch: false, label: 'e-paper 1.54', citizen: 'The e-paper citizen', blurb: 'A citizen that prints the paper and votes by button. Waveshare ESP32-S3-ePaper-1.54G.', variety: 'charlotte' },
});
export const hasTouch = (board) => (BOARDS[board] ? BOARDS[board].touch : true);
