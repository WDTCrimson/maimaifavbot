import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const LOADOUT_SLOT_COUNT = 30;
const GRID_COLUMNS = 6;
const GRID_ROWS = 5;

const loadedThemeFonts = new Map();

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
  cardFillOpacity: 0.58,
  cardBackgroundStyle: 'flat',
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
  cardFrameOpacity: 1,
  fontFamily: 'Inter, "Noto Sans JP", Arial, sans-serif'
};

function trimText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function clampOpacity(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function trimTextToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }

  return `${value}…`;
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

  return { theme, assets, resolvedDir };
}

async function loadThemeFontFamily(themeDir) {
  if (loadedThemeFonts.has(themeDir)) {
    return loadedThemeFonts.get(themeDir);
  }

  const fontsDir = join(themeDir, 'fonts');
  try {
    const entries = await readdir(fontsDir, { withFileTypes: true });
    const fontFiles = entries
      .filter((entry) => entry.isFile() && FONT_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(fontsDir, entry.name));

    if (!fontFiles.length) {
      loadedThemeFonts.set(themeDir, null);
      return null;
    }

    const family = `MaimaiFavTheme-${Buffer.from(themeDir).toString('base64url').slice(0, 16)}`;
    FontLibrary.use(family, fontFiles);
    loadedThemeFonts.set(themeDir, family);
    return family;
  } catch {
    loadedThemeFonts.set(themeDir, null);
    return null;
  }
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

function createImageCache() {
  const cache = new Map();

  async function get(path) {
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
  }

  async function prefetch(paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    await Promise.all(unique.map((path) => get(path)));
  }

  return {
    get,
    prefetch,
    size() {
      return cache.size;
    }
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
  const { theme, assets, resolvedDir } = await loadTheme(themeDir);
  const themeFontFamily = await loadThemeFontFamily(resolvedDir);
  const fontFamily = themeFontFamily
    ? `"${themeFontFamily}", ${theme.fontFamily}`
    : theme.fontFamily;

  const selectedSongs = Array.isArray(songs) ? songs.slice(0, LOADOUT_SLOT_COUNT) : [];
  const cards = await Promise.all(
    selectedSongs.map(async (song) => ({
      title: song?.title || 'Unknown Song',
      artist: song?.artist || 'Unknown Artist',
      lines: buildDifficultyLines(song || {}),
      version: getPrimaryVersion(song || {}),
      imagePath: await resolveSongImagePath(song || {})
    }))
  );
  const slots = Array.from({ length: LOADOUT_SLOT_COUNT }, (_, index) => cards[index] || null);

  const width = 1920;
  const height = 1080;
  const horizontalMargin = 24;
  const verticalMargin = 24;
  const gapX = 14;
  const gapY = 12;
  const headerTop = 20;
  const headerHeight = 96;
  const gridTop = headerTop + headerHeight + 22;
  const cardWidth = Math.floor(
    (width - horizontalMargin * 2 - gapX * (GRID_COLUMNS - 1)) / GRID_COLUMNS
  );
  const cardHeight = Math.floor(
    (height - gridTop - verticalMargin - gapY * (GRID_ROWS - 1)) / GRID_ROWS
  );

  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  const imageCache = createImageCache();
  await imageCache.prefetch([
    ...Object.values(assets),
    ...cards.map((card) => card.imagePath)
  ]);

  const backgroundImage = await imageCache.get(assets.background);
  if (backgroundImage) {
    drawImageCover(ctx, backgroundImage, 0, 0, width, height);
  } else {
    drawFallbackBackground(ctx, width, height, theme);
  }

  const watermarkImage = await imageCache.get(assets.watermark);
  if (watermarkImage) {
    ctx.save();
    ctx.globalAlpha = Number(theme.watermarkOpacity) || 0.14;
    drawImageCover(ctx, watermarkImage, 0, 0, width, height);
    ctx.restore();
  }

  // Character artwork is part of the upper background, not the header panel.
  const headerOverlay = await imageCache.get(assets.headerOverlay);
  if (headerOverlay) {
    const characterSize = 320;
    const characterX = width - characterSize - 220;
    const characterY = -36;
    ctx.save();
    ctx.globalAlpha = Number(theme.headerOverlayOpacity) || 0.95;
    drawImageContain(ctx, headerOverlay, characterX, characterY, characterSize, characterSize);
    ctx.restore();
  }

  roundedRectPath(ctx, horizontalMargin, headerTop, width - horizontalMargin * 2, headerHeight, 18);
  ctx.fillStyle = theme.headerFill;
  ctx.globalAlpha = 0.72;
  ctx.fill();
  ctx.globalAlpha = 1;

  const logoWidth = 172;
  const logoHeight = 76;
  const logoX = width - horizontalMargin - logoWidth;
  const logoY = headerTop + 10;
  const dateRightX = logoX - 18;
  const titleLeftX = horizontalMargin + 22;

  ctx.fillStyle = theme.titleColor;
  ctx.font = `600 40px ${fontFamily}`;
  const safeName = trimTextToWidth(ctx, trimText(loadoutName, 48), dateRightX - titleLeftX - 20);
  ctx.fillText(safeName, titleLeftX, headerTop + 46);

  ctx.fillStyle = theme.subtitleColor;
  ctx.font = `600 18px ${fontFamily}`;
  ctx.fillText(
    `Favorite Loadout (${selectedSongs.length}/${LOADOUT_SLOT_COUNT})`,
    titleLeftX,
    headerTop + 72
  );

  const dateText = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date());

  ctx.fillStyle = theme.versionColor;
  ctx.font = `600 20px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText(dateText, dateRightX, headerTop + 70);
  ctx.textAlign = 'left';

  const logoImage = await imageCache.get(assets.logo);
  if (logoImage) {
    drawImageContain(ctx, logoImage, logoX, logoY, logoWidth, logoHeight);
  }

  const useImageCardBackground = String(theme.cardBackgroundStyle || '').toLowerCase() === 'image';
  const cardBgImage = useImageCardBackground ? await imageCache.get(assets.cardBg) : null;
  const cardFrameImage = await imageCache.get(assets.cardFrame);
  const cardBgOpacity = clampOpacity(theme.cardBgOpacity, 0.45);
  const cardFillOpacity = clampOpacity(theme.cardFillOpacity, 0.58);

  for (let index = 0; index < slots.length; index += 1) {
    const card = slots[index];
    const col = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);
    const x = horizontalMargin + col * (cardWidth + gapX);
    const y = gridTop + row * (cardHeight + gapY);

    roundedRectPath(ctx, x, y, cardWidth, cardHeight, 16);
    ctx.save();
    ctx.globalAlpha = cardFillOpacity;
    ctx.fillStyle = theme.cardFill;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = theme.cardStroke;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (cardBgImage) {
      ctx.save();
      roundedRectPath(ctx, x, y, cardWidth, cardHeight, 16);
      ctx.clip();
      ctx.globalAlpha = cardBgOpacity;
      drawImageCover(ctx, cardBgImage, x, y, cardWidth, cardHeight);
      ctx.restore();
    }

    // Foreground content in each slot should always render at full opacity.
    ctx.globalAlpha = 1;

    roundedRectPath(ctx, x + 10, y + 10, cardWidth - 20, 22, 8);
    ctx.fillStyle = theme.cardTitleBar;
    ctx.fill();

    const jacketX = x + 10;
    const jacketY = y + 40;
    const jacketSize = 90;
    const textX = jacketX + jacketSize + 10;
    const textRight = x + cardWidth - 10;
    const lineMaxWidth = Math.max(40, textRight - textX);

    if (card) {
      ctx.fillStyle = theme.versionColor;
      ctx.font = `500 12px ${fontFamily}`;
      const versionText = card.version ? trimTextToWidth(ctx, card.version, 88) : '';
      const versionWidth = versionText ? ctx.measureText(versionText).width : 0;

      ctx.fillStyle = theme.titleColor;
      ctx.font = `600 14px ${fontFamily}`;
      const titleMaxWidth = Math.max(40, lineMaxWidth - (versionWidth ? versionWidth + 8 : 0));
      const title = trimTextToWidth(ctx, trimText(card.title, 48), titleMaxWidth);
      ctx.fillText(title, textX, y + 25);

      if (versionText) {
        ctx.fillStyle = theme.versionColor;
        ctx.font = `500 12px ${fontFamily}`;
        ctx.textAlign = 'right';
        ctx.fillText(versionText, textRight, y + 25);
        ctx.textAlign = 'left';
      }

      ctx.fillStyle = theme.artistColor;
      ctx.font = `500 12px ${fontFamily}`;
      const artist = trimTextToWidth(ctx, trimText(card.artist, 56), lineMaxWidth);
      ctx.fillText(artist, textX, y + 42);
    } else {
      ctx.fillStyle = theme.artistColor;
      ctx.font = `600 12px ${fontFamily}`;
      ctx.fillText(`Slot ${index + 1}`, x + 16, y + 25);
    }

    const jacketImage = card ? await imageCache.get(card.imagePath) : null;
    if (card && jacketImage) {
      ctx.save();
      roundedRectPath(ctx, jacketX, jacketY, jacketSize, jacketSize, 12);
      ctx.clip();
      drawImageCover(ctx, jacketImage, jacketX, jacketY, jacketSize, jacketSize);
      ctx.restore();
    } else {
      roundedRectPath(ctx, jacketX, jacketY, jacketSize, jacketSize, 12);
      ctx.fillStyle = '#2b2f55';
      ctx.fill();
      ctx.fillStyle = '#c6cce3';
      ctx.textAlign = 'center';
      ctx.font = `600 11px ${fontFamily}`;
      ctx.fillText(card ? 'NO' : 'EMPTY', jacketX + jacketSize / 2, jacketY + 42);
      ctx.fillText(card ? 'IMAGE' : 'SLOT', jacketX + jacketSize / 2, jacketY + 57);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = theme.chartColor;
    ctx.font = `500 13px ${fontFamily}`;
    const lines = card ? card.lines : ['No song selected'];
    const maxLines = 5;
    for (let lineIndex = 0; lineIndex < Math.min(lines.length, maxLines); lineIndex += 1) {
      const line = trimTextToWidth(ctx, lines[lineIndex], lineMaxWidth);
      ctx.fillText(line, textX, y + 62 + lineIndex * 16);
    }

    if (cardFrameImage && card) {
      ctx.save();
      ctx.globalAlpha = 1;
      drawImageContain(
        ctx,
        cardFrameImage,
        jacketX - 7,
        jacketY - 7,
        jacketSize + 14,
        jacketSize + 14
      );
      ctx.restore();
    }
  }

  return {
    buffer: await canvas.toBuffer('png'),
    fileName: `${sanitizeFileName(loadoutName)}-loadout.png`
  };
}
