const DEFAULT_FONT = 'Inter, Murecho, "Noto Sans JP", sans-serif';

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawMaiDeckWatermark(ctx, {
  text = 'MaiDeck',
  width = ctx.canvas?.width,
  height = ctx.canvas?.height,
  fontFamily = DEFAULT_FONT,
  margin = 14,
  fontSize = 13
} = {}) {
  if (!width || !height) {
    return;
  }

  ctx.save();
  ctx.font = `700 ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const padX = 10;
  const padY = 5;
  const label = String(text || 'MaiDeck');
  const textWidth = ctx.measureText(label).width;
  const boxW = Math.ceil(textWidth + padX * 2);
  const boxH = fontSize + padY * 2;
  const x = width - margin - boxW;
  const y = height - margin - boxH;

  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  roundedRect(ctx, x, y, boxW, boxH, boxH / 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.70)';
  ctx.fillText(label, x + padX, y + boxH / 2 + 0.5);
  ctx.restore();
}
