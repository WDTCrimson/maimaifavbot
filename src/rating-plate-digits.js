import { join } from 'node:path';
import { Canvas, loadImage } from 'skia-canvas';

// 4x4 sheet: 0-3 / 4-7 / 8 9 + - / , . %
const DIGIT_SHEET = join(process.cwd(), 'data', 'assets', 'tomomai', 'res', 'numbers', 'score_num_count_big.png');
const GLYPHS = '0123456789+-';

// Slot geometry measured on the 296x86 tomomai rating plates.
const PLATE_W = 296;
const PLATE_H = 86;
const SLOT_CENTERS_X = [140, 170.5, 202.5, 233, 264];
const SLOT_CENTER_Y = 40.5;
const CELL_H = 40;
const OUTLINE = '#1a1a28';

let sheetPromise = null;

function loadSheet() {
  sheetPromise ??= loadImage(DIGIT_SHEET).catch(() => {
    sheetPromise = null;
    return null;
  });
  return sheetPromise;
}

function ratingSlots(rating) {
  const value = Math.round(Number(rating));
  if (rating == null || !Number.isFinite(value) || value < 0) return '  -  ';
  return String(value).padStart(SLOT_CENTERS_X.length, ' ');
}

// Draws the rating right-aligned into the five slots of a tomomai rating plate
// drawn at (x, y, width, height). Returns false when the digit sheet is missing.
export async function drawRatingPlateDigits(ctx, rating, x, y, width, height) {
  const sheet = await loadSheet();
  if (!sheet) return false;

  const sx = width / PLATE_W;
  const sy = height / PLATE_H;
  const cellW = sheet.width / 4;
  const cellH = sheet.height / 4;
  const dh = CELL_H * sy;
  const dw = dh * cellW / cellH;
  const stroke = Math.max(1, dh / 26);
  const pad = Math.ceil(stroke) + 1;

  const glyphs = new Canvas(Math.ceil(width) + pad * 2, Math.ceil(height) + pad * 2);
  const gctx = glyphs.getContext('2d');
  [...ratingSlots(rating)].forEach((char, slot) => {
    const index = GLYPHS.indexOf(char);
    if (index < 0 || slot >= SLOT_CENTERS_X.length) return;
    gctx.drawImage(
      sheet,
      (index % 4) * cellW, Math.floor(index / 4) * cellH, cellW, cellH,
      pad + SLOT_CENTERS_X[slot] * sx - dw / 2, pad + SLOT_CENTER_Y * sy - dh / 2, dw, dh
    );
  });

  const outline = new Canvas(glyphs.width, glyphs.height);
  const octx = outline.getContext('2d');
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    octx.drawImage(glyphs, Math.cos(angle) * stroke, Math.sin(angle) * stroke);
  }
  octx.drawImage(glyphs, 0, stroke);
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = OUTLINE;
  octx.fillRect(0, 0, outline.width, outline.height);

  ctx.drawImage(outline, x - pad, y - pad);
  ctx.drawImage(glyphs, x - pad, y - pad);
  return true;
}
