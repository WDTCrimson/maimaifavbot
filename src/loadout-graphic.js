import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

const defaultTheme = {
  backgroundStart: '#c96a84',
  backgroundMiddle: '#a8566f',
  backgroundEnd: '#8c4a63',
  glow1Color: 'rgba(255, 200, 220, 0.25)',
  glow2Color: 'rgba(255, 180, 200, 0.2)',
  glowRadius: 400,
  diamondSize: 40,
  diamondOpacity: 0.08,
  overlayTint: 'rgba(120, 40, 60, 0.15)',
  headerFill: '#2b1538',
  cardFill: '#3e1f53',
  cardStroke: '#8b5cf6',
  cardTitleBar: '#5b286f',
  titleColor: '#ffffff',
  subtitleColor: '#f9a8d4',
  artistColor: '#ddd6fe',
  chartColor: '#f1e6ff',
  versionColor: '#fbcfe8',
  watermarkOpacity: 0.14,
  headerOverlayOpacity: 0.95,
  cardBgOpacity: 0.45,
  cardFrameOpacity: 1
};

function trimText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function levelToNumber(value) {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number.parseFloat(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : -1;
}

function formatInternal(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toFixed(1) : String(value);
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return '?';
  }
  if (/^-?\d+$/.test(text)) {
    return `${text}.0`;
  }
  return text;
}

function buildDifficultyLines(song) {
  const order = ['basic', 'advanced', 'expert', 'master', 'remaster'];
  const labels = {
    basic: 'BSC',
    advanced: 'ADV',
    expert: 'EXP',
    master: 'MAS',
    remaster: 'ReM'
  };

  const byDifficulty = new Map(order.map((difficulty) => [difficulty, null]));
  const charts = Array.isArray(song.difficultyLevels) ? song.difficultyLevels : [];

  for (const chart of charts) {
    const difficulty = String(chart.difficulty || '').toLowerCase();
    if (!byDifficulty.has(difficulty) || !chart.level) {
      continue;
    }

    const existing = byDifficulty.get(difficulty);
    if (!existing || levelToNumber(chart.internalLevelValue) > levelToNumber(existing.internalLevelValue)) {
      byDifficulty.set(difficulty, chart);
    }
  }

  const lines = [];
  for (const difficulty of order) {
    const chart = byDifficulty.get(difficulty);
    if (!chart) {
      continue;
    }
    lines.push(`${labels[difficulty]}  Lvl ${chart.level} [${formatInternal(chart.internalLevelValue)}]`);
  }

  if (!lines.length) {
    return ['No chart data'];
  }

  return lines.slice(0, 5);
}

function getPrimaryVersion(song) {
  const charts = Array.isArray(song.difficultyLevels) ? song.difficultyLevels : [];
  const withVersion = charts.filter((chart) => chart.version).map((chart) => chart.version);
  if (!withVersion.length) {
    return null;
  }
  return withVersion[withVersion.length - 1];
}

async function fileExists(path) {
  try {
    const fileStat = await stat(path);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function resolveThemeDir(themeDir) {
  if (!themeDir) {
    return join(process.cwd(), 'data', 'theme');
  }
  return isAbsolute(themeDir) ? themeDir : join(process.cwd(), themeDir);
}

async function readThemeJson(themeDir) {
  const path = join(themeDir, 'theme.json');
  if (!(await fileExists(path))) {
    return {};
  }

  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

async function resolveThemeAsset(themeDir, baseName) {
  for (const ext of IMAGE_EXTENSIONS) {
    const path = join(themeDir, `${baseName}${ext}`);
    if (await fileExists(path)) {
      return path;
    }
  }
  return null;
}

async function loadTheme(themeDir) {
  const resolvedDir = resolveThemeDir(themeDir);
  const themeJson = await readThemeJson(resolvedDir);
  const theme = {
    ...defaultTheme,
    ...themeJson
  };

  const assets = {
    background: await resolveThemeAsset(resolvedDir, 'background'),
    headerOverlay: await resolveThemeAsset(resolvedDir, 'header-overlay'),
    logo: await resolveThemeAsset(resolvedDir, 'logo'),
    watermark: await resolveThemeAsset(resolvedDir, 'watermark'),
    cardBg: await resolveThemeAsset(resolvedDir, 'card-bg'),
    cardFrame: await resolveThemeAsset(resolvedDir, 'card-frame')
  };

  return { theme, assets };
}

async function resolveSongImagePath(song) {
  const candidates = [
    song?.jacket?.dxratingFile
      ? join(process.cwd(), 'data', 'assets', 'jacket', 'dxrating', song.jacket.dxratingFile)
      : null,
    song?.jacket?.otogeFile
      ? join(process.cwd(), 'data', 'assets', 'jacket', 'otoge-db', song.jacket.otogeFile)
      : null
  ].filter(Boolean);

  for (const path of candidates) {
    if (await fileExists(path)) {
      return path;
    }
  }

  return null;
}

function sanitizeFileName(text) {
  const value = String(text || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return value || 'loadout';
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawImageCover(ctx, image, x, y, width, height) {
  const imgRatio = image.width / image.height;
  const boxRatio = width / height;

  let drawWidth = width;
  let drawHeight = height;
  let offsetX = x;
  let offsetY = y;

  if (imgRatio > boxRatio) {
    drawHeight = height;
    drawWidth = height * imgRatio;
    offsetX = x - (drawWidth - width) / 2;
  } else {
    drawWidth = width;
    drawHeight = width / imgRatio;
    offsetY = y - (drawHeight - height) / 2;
  }

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

function drawImageContain(ctx, image, x, y, width, height) {
  const imgRatio = image.width / image.height;
  const boxRatio = width / height;

  let drawWidth = width;
  let drawHeight = height;
  let offsetX = x;
  let offsetY = y;

  if (imgRatio > boxRatio) {
    drawWidth = width;
    drawHeight = width / imgRatio;
    offsetY = y + (height - drawHeight) / 2;
  } else {
    drawHeight = height;
    drawWidth = height * imgRatio;
    offsetX = x + (width - drawWidth) / 2;
  }

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

function createImageLoader() {
  const cache = new Map();
  return async (path) => {
    if (!path) {
      return null;
    }
    if (!cache.has(path)) {
      cache.set(
        path,
        loadImage(path).catch(() => null)
      );
    }
    return cache.get(path);
  };
}

function drawFallbackBackground(ctx, width, height, theme) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, theme.backgroundStart);
  gradient.addColorStop(0.4, theme.backgroundMiddle);
  gradient.addColorStop(1, theme.backgroundEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow1 = ctx.createRadialGradient(width * 0.3, height * 0.2, 0, width * 0.3, height * 0.2, theme.glowRadius);
  glow1.addColorStop(0, theme.glow1Color);
  glow1.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, width, height);

  const glow2 = ctx.createRadialGradient(width * 0.8, height * 0.7, 0, width * 0.8, height * 0.7, theme.glowRadius);
  glow2.addColorStop(0, theme.glow2Color);
  glow2.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, width, height);

  const size = Math.max(8, Number(theme.diamondSize) || 40);
  ctx.save();
  ctx.globalAlpha = Number(theme.diamondOpacity) || 0.08;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;

  for (let x = -size; x < width + size; x += size) {
    for (let y = -size; y < height + size; y += size) {
      ctx.beginPath();
      ctx.moveTo(x, y + size / 2);
      ctx.lineTo(x + size / 2, y);
      ctx.lineTo(x + size, y + size / 2);
      ctx.lineTo(x + size / 2, y + size);
      ctx.closePath();
      ctx.stroke();
    }
  }

  ctx.restore();

  ctx.fillStyle = theme.overlayTint;
  ctx.fillRect(0, 0, width, height);
}

export async function renderLoadoutGraphic({ loadoutName, songs, themeDir }) {
  const { theme, assets } = await loadTheme(themeDir);
  const cards = await Promise.all(
    songs.map(async (song) => ({
      title: song?.title || 'Unknown Song',
      artist: song?.artist || 'Unknown Artist',
      lines: buildDifficultyLines(song || {}),
      version: getPrimaryVersion(song || {}),
      imagePath: await resolveSongImagePath(song || {})
    }))
  );

  const cardCount = cards.length;
  const columns = cardCount <= 8 ? 2 : cardCount <= 18 ? 3 : 4;
  const cardWidth = 360;
  const cardHeight = 170;
  const gap = 16;
  const margin = 24;
  const headerHeight = 120;
  const rows = Math.max(1, Math.ceil(cardCount / columns));
  const width = margin * 2 + columns * cardWidth + (columns - 1) * gap;
  const height = headerHeight + margin + rows * cardHeight + (rows - 1) * gap + margin;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const loadThemeImage = createImageLoader();

  const backgroundImage = await loadThemeImage(assets.background);
  if (backgroundImage) {
    drawImageCover(ctx, backgroundImage, 0, 0, width, height);
  } else {
    drawFallbackBackground(ctx, width, height, theme);
  }

  const watermarkImage = await loadThemeImage(assets.watermark);
  if (watermarkImage) {
    ctx.save();
    ctx.globalAlpha = Number(theme.watermarkOpacity) || 0.14;
    drawImageCover(ctx, watermarkImage, 0, 0, width, height);
    ctx.restore();
  }

  roundedRectPath(ctx, margin, 26, width - margin * 2, 78, 18);
  ctx.fillStyle = theme.headerFill;
  ctx.globalAlpha = 0.72;
  ctx.fill();
  ctx.globalAlpha = 1;

  const headerOverlay = await loadThemeImage(assets.headerOverlay);
  if (headerOverlay) {
    ctx.save();
    roundedRectPath(ctx, margin, 26, width - margin * 2, 78, 18);
    ctx.clip();
    ctx.globalAlpha = Number(theme.headerOverlayOpacity) || 0.95;
    drawImageCover(ctx, headerOverlay, margin, 26, width - margin * 2, 78);
    ctx.restore();
  }

  ctx.fillStyle = theme.titleColor;
  ctx.font = '600 42px Arial, sans-serif';
  ctx.fillText(trimText(loadoutName, 24), margin + 24, 66);

  ctx.fillStyle = theme.subtitleColor;
  ctx.font = '600 20px Arial, sans-serif';
  ctx.fillText('Favorite Loadout', margin + 24, 92);

  const dateText = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date());

  ctx.fillStyle = theme.versionColor;
  ctx.font = '600 22px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(dateText, width - margin - 24, 92);
  ctx.textAlign = 'left';

  const logoImage = await loadThemeImage(assets.logo);
  if (logoImage) {
    drawImageContain(ctx, logoImage, width - margin - 116, 32, 116, 66);
  }

  const cardBgImage = await loadThemeImage(assets.cardBg);
  const cardFrameImage = await loadThemeImage(assets.cardFrame);

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * (cardWidth + gap);
    const y = headerHeight + margin + row * (cardHeight + gap);

    roundedRectPath(ctx, x, y, cardWidth, cardHeight, 16);
    ctx.fillStyle = theme.cardFill;
    ctx.fill();
    ctx.strokeStyle = theme.cardStroke;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (cardBgImage) {
      ctx.save();
      roundedRectPath(ctx, x, y, cardWidth, cardHeight, 16);
      ctx.clip();
      ctx.globalAlpha = Number(theme.cardBgOpacity) || 0.45;
      drawImageCover(ctx, cardBgImage, x, y, cardWidth, cardHeight);
      ctx.restore();
    }

    roundedRectPath(ctx, x + 14, y + 12, cardWidth - 28, 24, 8);
    ctx.fillStyle = theme.cardTitleBar;
    ctx.fill();

    ctx.fillStyle = theme.titleColor;
    ctx.font = '600 18px Arial, sans-serif';
    ctx.fillText(trimText(card.title, 26), x + 122, y + 30);

    ctx.fillStyle = theme.artistColor;
    ctx.font = '500 14px Arial, sans-serif';
    ctx.fillText(trimText(card.artist, 30), x + 122, y + 52);

    if (card.version) {
      ctx.fillStyle = theme.versionColor;
      ctx.font = '500 13px Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(card.version, x + cardWidth - 14, y + 28);
      ctx.textAlign = 'left';
    }

    const jacketX = x + 14;
    const jacketY = y + 44;
    const jacketSize = 96;

    const jacketImage = await loadThemeImage(card.imagePath);
    if (jacketImage) {
      ctx.save();
      roundedRectPath(ctx, jacketX, jacketY, jacketSize, jacketSize, 12);
      ctx.clip();
      drawImageCover(ctx, jacketImage, jacketX, jacketY, jacketSize, jacketSize);
      ctx.restore();
    } else {
      roundedRectPath(ctx, jacketX, jacketY, jacketSize, jacketSize, 12);
      ctx.fillStyle = '#2b2f55';
      ctx.fill();
      ctx.fillStyle = '#b8bfd8';
      ctx.textAlign = 'center';
      ctx.font = '600 12px Arial, sans-serif';
      ctx.fillText('NO', jacketX + jacketSize / 2, jacketY + 44);
      ctx.fillText('IMAGE', jacketX + jacketSize / 2, jacketY + 60);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = theme.chartColor;
    ctx.font = '500 16px Arial, sans-serif';
    for (let lineIndex = 0; lineIndex < card.lines.length; lineIndex += 1) {
      ctx.fillText(card.lines[lineIndex], x + 122, y + 78 + lineIndex * 20);
    }

    if (cardFrameImage) {
      ctx.save();
      ctx.globalAlpha = Number(theme.cardFrameOpacity) || 1;
      drawImageContain(ctx, cardFrameImage, x, y, cardWidth, cardHeight);
      ctx.restore();
    }
  }

  return {
    buffer: canvas.toBuffer('image/png'),
    fileName: `${sanitizeFileName(loadoutName)}-loadout.png`
  };
}
