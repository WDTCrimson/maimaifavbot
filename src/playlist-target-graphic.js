import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const loadedThemeFonts = new Map();
const imageCache = new Map();

const WIDTH = 1500;
const HEADER_HEIGHT = 100;
const CELL_HEIGHT = 116;
const CELL_PADDING = 4;
const COLUMNS = 5;
const FOOTER_HEIGHT = 28;
const GRID_GAP = 6;

const defaultTheme = {
  accentColor: '#c8a8f9',
  headerFill: 'rgba(0,0,0,0.82)',
  footerFill: 'rgba(0,0,0,0.4)',
  footerText: '#ffffff',
  titleColor: '#ffffff',
  subtitleColor: 'rgba(255,255,255,0.8)',
  cardText: '#ffffff',
  badgeFill: 'rgba(0,0,0,0.38)',
  badgeStroke: 'rgba(255,255,255,0.18)',
  fontFamily: 'Inter, Noto Sans JP, Arial, sans-serif'
};

const DIFFICULTIES = {
  basic: { title: 'BASIC', color: '#22bb5b' },
  advanced: { title: 'ADVANCED', color: '#fb9c2d' },
  expert: { title: 'EXPERT', color: '#f64861' },
  master: { title: 'MASTER', color: '#9e45e2' },
  remaster: { title: 'Re:MASTER', color: '#951BEF', inverted: true }
};

function trimText(text, maxLength) {
  const value = String(text || '');
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function trimTextToWidth(ctx, text, maxWidth) {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) {
    return value;
  }
  let current = value;
  while (current.length > 1 && ctx.measureText(`${current}…`).width > maxWidth) {
    current = current.slice(0, -1);
  }
  return `${current}…`;
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
    return join(process.cwd(), 'data', 'theme', 'tomomai');
  }
  return isAbsolute(themeDir) ? themeDir : join(process.cwd(), themeDir);
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

async function readThemeJson(themeDir) {
  const path = join(themeDir, 'theme.json');
  if (!(await fileExists(path))) {
    return {};
  }
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

    const family = `PlaylistTargetTheme-${Buffer.from(themeDir).toString('base64url').slice(0, 16)}`;
    FontLibrary.use(family, fontFiles);
    loadedThemeFonts.set(themeDir, family);
    return family;
  } catch {
    loadedThemeFonts.set(themeDir, null);
    return null;
  }
}

async function loadTheme(themeDir) {
  const resolvedDir = resolveThemeDir(themeDir);
  const themeJson = await readThemeJson(resolvedDir);
  const fontFamily = await loadThemeFontFamily(resolvedDir);
  return {
    theme: {
      ...defaultTheme,
      ...themeJson,
      fontFamily: fontFamily ? `${fontFamily}, ${themeJson.fontFamily || defaultTheme.fontFamily}` : themeJson.fontFamily || defaultTheme.fontFamily
    },
    resolvedDir,
    assets: {
      background: await resolveThemeAsset(resolvedDir, 'background'),
      logo: await resolveThemeAsset(resolvedDir, 'logo'),
      watermark: await resolveThemeAsset(resolvedDir, 'watermark')
    }
  };
}

async function getImage(path) {
  if (!path) {
    return null;
  }
  if (imageCache.has(path)) {
    return imageCache.get(path);
  }
  try {
    const image = await loadImage(path);
    imageCache.set(path, image);
    return image;
  } catch {
    imageCache.set(path, null);
    return null;
  }
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

function formatInternal(value) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Number.isInteger(number) ? number.toFixed(1) : String(number);
  }
  return '?';
}

function formatAchievementTarget(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 'NO TARGET';
  }
  return `${number.toFixed(4)}%`;
}

function rankFromAchievement(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  if (number >= 100.5) return 'SSS+';
  if (number >= 100) return 'SSS';
  if (number >= 99.5) return 'SS+';
  if (number >= 99) return 'SS';
  if (number >= 98) return 'S+';
  if (number >= 97) return 'S';
  if (number >= 94) return 'AAA';
  if (number >= 90) return 'AA';
  if (number >= 80) return 'A';
  if (number >= 75) return 'BBB';
  if (number >= 70) return 'BB';
  if (number >= 60) return 'B';
  if (number >= 50) return 'C';
  return 'D';
}

function drawBadge(ctx, { x, y, text, fill = 'rgba(0,0,0,0.35)', color = '#fff', stroke = null, font = '12px sans-serif', paddingX = 8, paddingY = 4, radius = 12 }) {
  ctx.save();
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const width = metrics.width + paddingX * 2;
  const height = 20 + paddingY;
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + paddingX, y + height / 2 + 0.5);
  ctx.restore();
  return width;
}

function drawFact(ctx, { x, y, value, label, align = 'right' }) {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = `700 30px ${ctx._fontFamily}`;
  ctx.fillText(String(value), x, y);
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = `500 14px ${ctx._fontFamily}`;
  ctx.fillText(String(label), x, y + 20);
  ctx.restore();
}

function createCellGradient(ctx, color, x, y, width, height) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.65, color);
  gradient.addColorStop(1, `${color}CC`);
  return gradient;
}

function drawCell(ctx, entry, index, theme, x, y, width, height) {
  const difficultyMeta = DIFFICULTIES[entry.chart?.difficulty] || DIFFICULTIES.master;
  const backgroundColor = difficultyMeta.inverted ? '#EBCFFF' : difficultyMeta.color;
  const foregroundColor = difficultyMeta.inverted ? difficultyMeta.color : theme.cardText;
  const shadowColor = difficultyMeta.inverted ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.65)';

  ctx.save();
  roundedRectPath(ctx, x, y, width, height, 12);
  ctx.fillStyle = createCellGradient(ctx, backgroundColor, x, y, width, height);
  ctx.fill();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, x, y, width, height, 12);
  ctx.clip();
  if (entry.cover) {
    const coverWidth = 108;
    drawImageCover(ctx, entry.cover, x + width - coverWidth, y, coverWidth, height);
    const fade = ctx.createLinearGradient(x + width - coverWidth - 24, y, x + width, y);
    fade.addColorStop(0, 'rgba(255,255,255,0)');
    fade.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    fade.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = fade;
    ctx.fillRect(x + width - coverWidth - 24, y, coverWidth + 24, height);
  }
  ctx.restore();

  const leftX = x + 10;
  const topY = y + 12;
  const contentWidth = width - 64;

  ctx.save();
  ctx.fillStyle = foregroundColor;
  ctx.font = `700 15px ${theme.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = 2;
  ctx.fillText(trimTextToWidth(ctx, entry.song.title, contentWidth), leftX, topY);

  const typeText = entry.chart?.chartType === 'std' ? 'STD' : 'DX';
  const badgeY = y + 38;
  drawBadge(ctx, {
    x: leftX,
    y: badgeY,
    text: typeText,
    fill: 'rgba(0,0,0,0.45)',
    color: '#fff',
    stroke: 'rgba(255,255,255,0.2)',
    font: `700 11px ${theme.fontFamily}`,
    paddingX: 7,
    paddingY: 3,
    radius: 10
  });
  drawBadge(ctx, {
    x: leftX + 40,
    y: badgeY,
    text: `${difficultyMeta.title} ${formatInternal(entry.chart?.internalLevelValue)}`,
    fill: 'rgba(0,0,0,0.35)',
    color: '#fff',
    stroke: 'rgba(255,255,255,0.2)',
    font: `700 10px ${theme.fontFamily}`,
    paddingX: 6,
    paddingY: 3,
    radius: 10
  });

  drawBadge(ctx, {
    x: leftX,
    y: y + 64,
    text: entry.targetRating != null ? String(entry.targetRating) : '—',
    fill: 'rgba(0,0,0,0.5)',
    color: '#fff',
    font: `700 12px ${theme.fontFamily}`,
    paddingX: 8,
    paddingY: 3,
    radius: 10
  });

  ctx.font = `700 14px ${theme.fontFamily}`;
  ctx.fillStyle = foregroundColor;
  ctx.fillText(formatAchievementTarget(entry.target?.achievementRate), leftX + 54, y + 68);

  const rank = rankFromAchievement(entry.target?.achievementRate);
  if (rank) {
    ctx.font = `600 13px ${theme.fontFamily}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(rank, leftX + 170, y + 68);
  }

  if (entry.target?.achievementRate != null) {
    ctx.font = `500 11px ${theme.fontFamily}`;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    const note = entry.target.difficulty
      ? `${difficultyMeta.title}${entry.target.chartType ? ` • ${typeText}` : ''}`
      : 'Auto-selected chart';
    ctx.fillText(trimTextToWidth(ctx, note, contentWidth), leftX, y + 90);
  } else {
    ctx.font = `500 11px ${theme.fontFamily}`;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText('No explicit target set', leftX, y + 90);
  }

  drawBadge(ctx, {
    x: x + width - 34,
    y: y + height - 24,
    text: `#${index + 1}`,
    fill: 'rgba(0,0,0,0.5)',
    color: '#fff',
    font: `700 10px ${theme.fontFamily}`,
    paddingX: 6,
    paddingY: 2,
    radius: 8
  });
  ctx.restore();
}

export async function renderPlaylistTargetGraphic({ playlistName, entries, themeDir }) {
  const { theme, assets } = await loadTheme(themeDir);
  const rows = Math.max(1, Math.ceil(entries.length / COLUMNS));
  const height = HEADER_HEIGHT + rows * CELL_HEIGHT + (rows - 1) * GRID_GAP + FOOTER_HEIGHT + 12;

  const canvas = new Canvas(WIDTH, height);
  const ctx = canvas.getContext('2d');
  ctx._fontFamily = theme.fontFamily;

  const background = await getImage(assets.background);
  if (background) {
    drawImageCover(ctx, background, 0, 0, WIDTH, height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, height);
    gradient.addColorStop(0, '#f4b6d9');
    gradient.addColorStop(1, '#d56ca0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, height);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, WIDTH, height);

  const logo = await getImage(assets.logo);
  const watermark = await getImage(assets.watermark);
  const songsWithTargets = entries.filter((entry) => entry.target?.achievementRate != null).length;
  const totalTargetRating = entries.reduce((sum, entry) => sum + (entry.targetRating || 0), 0);

  ctx.save();
  roundedRectPath(ctx, 4, 4, WIDTH - 8, HEADER_HEIGHT - 8, 10);
  ctx.fillStyle = theme.headerFill;
  ctx.fill();
  ctx.restore();

  if (logo) {
    const logoHeight = 62;
    const logoWidth = logo.width * (logoHeight / logo.height);
    ctx.drawImage(logo, WIDTH - logoWidth - 24, 18, logoWidth, logoHeight);
  }

  if (watermark) {
    const wmHeight = 70;
    const wmWidth = watermark.width * (wmHeight / watermark.height);
    ctx.globalAlpha = 0.22;
    ctx.drawImage(watermark, WIDTH - wmWidth - 220, 14, wmWidth, wmHeight);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = theme.titleColor;
  ctx.font = `700 34px ${theme.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(trimText(playlistName, 42), 20, 44);

  ctx.fillStyle = theme.subtitleColor;
  ctx.font = `500 14px ${theme.fontFamily}`;
  ctx.fillText('Target board', 22, 68);

  drawFact(ctx, { x: WIDTH - 26, y: 40, value: totalTargetRating || '—', label: 'Target Total' });
  drawFact(ctx, { x: WIDTH - 180, y: 40, value: songsWithTargets, label: 'Targeted Songs' });
  drawFact(ctx, { x: WIDTH - 330, y: 40, value: entries.length, label: 'Songs' });

  const cellWidth = WIDTH / COLUMNS;
  entries.forEach((entry, index) => {
    const row = Math.floor(index / COLUMNS);
    const column = index % COLUMNS;
    const x = column * cellWidth + CELL_PADDING;
    const y = HEADER_HEIGHT + row * (CELL_HEIGHT + GRID_GAP);
    drawCell(ctx, entry, index, theme, x, y, cellWidth - CELL_PADDING * 2, CELL_HEIGHT);
  });

  ctx.save();
  roundedRectPath(ctx, 4, height - FOOTER_HEIGHT - 4, WIDTH - 8, FOOTER_HEIGHT, 10);
  ctx.fillStyle = theme.footerFill;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = theme.footerText;
  ctx.font = `700 12px ${theme.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Rendered by MaiFav target board', WIDTH / 2, height - FOOTER_HEIGHT / 2 - 4);

  const buffer = await canvas.toBuffer('png');
  return {
    buffer,
    fileName: `${String(playlistName || 'playlist').replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'playlist'}-targets.png`
  };
}
