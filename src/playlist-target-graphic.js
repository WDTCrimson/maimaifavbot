import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';
import { drawMaiDeckWatermark } from './graphic-watermark.js';
import { drawRatingPlateDigits } from './rating-plate-digits.js';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const loadedThemeFonts = new Map();
const imageCache = new Map();
const REGISTERED_FONTS = new Set();
const TOMOMAI_FONTS = join(process.cwd(), 'data', 'assets', 'tomomai', 'res', 'fonts');
const TOMOMAI = join(process.cwd(), 'data', 'assets', 'tomomai', 'res');
const DANI_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'dani');

const WIDTH = 1500;
const PLAYER_H = 156;
const PLAYLIST_BAR_H = 48;
const HEADER_HEIGHT = PLAYER_H + PLAYLIST_BAR_H;
const CELL_HEIGHT = 116;
const CELL_PADDING = 4;
const COLUMNS = 5;
const BOTTOM_PAD = 40;
const GRID_GAP = 6;
const DEFAULT_DXRATING_RANK_SLUG = 'circle-plus';

const FONT = 'Inter, Murecho, "Noto Sans JP", sans-serif';

const defaultTheme = {
  accentColor: '#c8a8f9',
  headerFill: 'rgba(0,0,0,0.55)',
  titleColor: '#ffffff',
  subtitleColor: 'rgba(255,255,255,0.8)',
  cardText: '#ffffff',
  badgeFill: 'rgba(0,0,0,0.38)',
  badgeStroke: 'rgba(255,255,255,0.18)',
  fontFamily: FONT
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

function wrapTextToWidth(ctx, text, maxWidth, maxLines = 2) {
  const value = String(text || '').trim();
  if (!value) {
    return [''];
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [trimTextToWidth(ctx, value, maxWidth)];
  }

  const lines = [];
  let current = '';

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    if (!current) {
      lines.push(trimTextToWidth(ctx, word, maxWidth));
    } else {
      lines.push(current);
      current = word;
    }

    if (lines.length === maxLines - 1) {
      const remainingWords = [current, ...words.slice(index + 1)].filter(Boolean);
      const remaining = remainingWords.join(' ');
      lines.push(trimTextToWidth(ctx, remaining, maxWidth));
      return lines;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

async function fileExists(path) {
  try {
    const fileStat = await stat(path);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function registerFonts() {
  if (REGISTERED_FONTS.size) return;
  const mappings = [
    ['Inter',      'Inter-VariableFont_opsz,wght.woff2'],
    ['Murecho',    'Murecho-VariableFont_wght.woff2'],
    ['Noto Sans JP','NotoSansJP-VariableFont_wght.woff2'],
    ['Geist Mono', 'GeistMono-VariableFont_wght.woff2'],
  ];
  for (const [family, file] of mappings) {
    const path = join(TOMOMAI_FONTS, file);
    if (await fileExists(path)) { FontLibrary.use(family, [path]); REGISTERED_FONTS.add(family); }
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
      logo: await resolveThemeAsset(resolvedDir, 'logo')
    }
  };
}

async function getImage(path) {
  if (!path) return null;
  if (imageCache.has(path)) return imageCache.get(path);
  const promise = (async () => {
    try {
      if (/^https?:\/\//i.test(path)) return await loadImage(path);
      if (!(await fileExists(path))) return null;
      return await loadImage(path);
    } catch { return null; }
  })();
  imageCache.set(path, promise);
  return promise;
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

function drawMaskedCover(ctx, image, x, y, width, height) {
  const tempCanvas = new Canvas(width, height);
  const tempCtx = tempCanvas.getContext('2d');
  drawImageCover(tempCtx, image, 0, 0, width, height);

  tempCtx.globalCompositeOperation = 'destination-in';
  const fade = tempCtx.createLinearGradient(0, 0, width, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.12, 'rgba(0,0,0,0.55)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  tempCtx.fillStyle = fade;
  tempCtx.fillRect(0, 0, width, height);

  ctx.drawImage(tempCanvas, x, y, width, height);
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

function formatComboFlag(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fc') return 'FC';
  if (normalized === 'fc+') return 'FC+';
  if (normalized === 'ap') return 'AP';
  if (normalized === 'ap+') return 'AP+';
  return null;
}

function rankKeyFromAchievement(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  if (number >= 100.5) return 'sssp';
  if (number >= 100) return 'sss';
  if (number >= 99.5) return 'ssp';
  if (number >= 99) return 'ss';
  if (number >= 98) return 'sp';
  if (number >= 97) return 's';
  if (number >= 94) return 'aaa';
  if (number >= 90) return 'aa';
  if (number >= 80) return 'a';
  if (number >= 75) return 'bbb';
  if (number >= 70) return 'bb';
  if (number >= 60) return 'b';
  if (number >= 50) return 'c';
  return 'd';
}

function resolveDxratingRankPath(rankKey, slug = DEFAULT_DXRATING_RANK_SLUG) {
  if (!rankKey) {
    return null;
  }
  return join(process.cwd(), 'data', 'assets', 'dxrating', 'rank', slug, `${rankKey}.png`);
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
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 24px ${ctx._fontFamily}`;
  ctx.fillText(String(value), x, y - 10);
  ctx.fillStyle = 'rgba(255,255,255,0.50)';
  ctx.font = `500 12px ${ctx._fontFamily}`;
  ctx.fillText(String(label), x, y + 12);
  ctx.restore();
}

function createCellGradient(ctx, color, x, y, width, height) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.65, color);
  gradient.addColorStop(1, `${color}CC`);
  return gradient;
}

async function drawCell(ctx, entry, index, theme, x, y, width, height) {
  const difficultyMeta = DIFFICULTIES[entry.chart?.difficulty] || DIFFICULTIES.master;
  const diffColor = difficultyMeta.inverted ? '#EBCFFF' : difficultyMeta.color;

  // Dark card background + border
  ctx.save();
  roundedRectPath(ctx, x, y, width, height, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Difficulty accent bar on left edge
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, 4, height, [10, 0, 0, 10]);
  ctx.fillStyle = diffColor;
  ctx.fill();
  ctx.restore();

  // Jacket on right with fade
  const coverWidth = entry.cover ? 108 : 0;
  ctx.save();
  roundedRectPath(ctx, x, y, width, height, 10);
  ctx.clip();
  if (entry.cover) {
    drawMaskedCover(ctx, entry.cover, x + width - coverWidth, y, coverWidth, height);
  }
  ctx.restore();

  const leftX = x + 14;
  const topY = y + 10;
  const contentWidth = Math.max(120, width - coverWidth - 28);
  const hasTarget = entry.target?.achievementRate != null;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 14px ${theme.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 3;
  const titleLines = wrapTextToWidth(ctx, entry.song.title, contentWidth, 2);
  titleLines.forEach((line, lineIndex) => {
    ctx.fillText(line, leftX, topY + lineIndex * 16);
  });

  const isDx = String(entry.chart?.chartType || entry.chart?.type || '').toLowerCase() !== 'std';
  const typeBadgeImg = await getImage(join(process.cwd(), 'data', 'assets', 'logo', 'otoge-db', isDx ? 'chart_badge_dx.png' : 'chart_badge_std.png'));
  if (typeBadgeImg) {
    const th = 20, tw = typeBadgeImg.width * (th / typeBadgeImg.height);
    ctx.drawImage(typeBadgeImg, leftX, y + 44, tw, th);
  }

  // Level chip — B50 style, top-right corner
  const levelStr = formatInternal(entry.chart?.internalLevelValue);
  const chipW = 48, chipH = 28; // chipW also used for combo flag positioning
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x + width - chipW, y, chipW, chipH, [0, 10, 0, 10]);
  ctx.fillStyle = diffColor;
  ctx.fill();
  ctx.font = `700 13px ${theme.fontFamily}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(levelStr, x + width - chipW / 2, y + chipH / 2);
  ctx.restore();

  const rank = rankFromAchievement(entry.target?.achievementRate);
  const scoreText = hasTarget ? formatAchievementTarget(entry.target?.achievementRate) : 'NO TARGET';
  const rightEdge = leftX + contentWidth;
  const scoreBaseY = y + 82;

  // Score — left
  ctx.font = `700 13px ${theme.fontFamily}`;
  ctx.fillStyle = hasTarget ? '#ffffff' : 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(scoreText, leftX, scoreBaseY);

  // Rank — centered below score
  if (hasTarget) {
    const scoreW = ctx.measureText(scoreText).width;
    const rankCenterX = leftX + scoreW / 2;
    if (entry.rankImage) {
      const rh = 18, rw = entry.rankImage.width * (rh / entry.rankImage.height);
      ctx.drawImage(entry.rankImage, rankCenterX - rw / 2, scoreBaseY + 4, rw, rh);
    } else if (rank) {
      ctx.font = `600 11px ${theme.fontFamily}`;
      ctx.fillStyle = 'rgba(255,255,255,0.80)';
      ctx.textAlign = 'center';
      ctx.fillText(rank, rankCenterX, scoreBaseY + 16);
    }
  }

  // Rating — right of score
  if (entry.targetRating != null) {
    ctx.font = `700 18px ${theme.fontFamily}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(entry.targetRating), rightEdge, scoreBaseY);
    ctx.font = `500 10px ${theme.fontFamily}`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('rating', rightEdge, scoreBaseY + 13);
  }

  // Combo flag badge — top right (beside level chip)
  const comboFlag = formatComboFlag(entry.target?.comboFlag);
  if (comboFlag) {
    drawBadge(ctx, {
      x: x + width - chipW - 52,
      y: y + 4,
      text: comboFlag,
      fill: 'rgba(0,0,0,0.55)',
      color: '#fff',
      stroke: 'rgba(255,255,255,0.16)',
      font: `700 10px ${theme.fontFamily}`,
      paddingX: 8,
      paddingY: 2,
      radius: 10
    });
  }

  ctx.restore();
}

function ratingVariant(rating, gameVersion) {
  const v = Number(rating) || 0, gv = Number(gameVersion) || 0;
  if (v >= 16000 && gv >= 13) return 'kiwami';
  if (v >= 15000) return 'rainbow';
  if (v >= 14500) return 'platinum';
  if (v >= 14000) return 'gold';
  if (v >= 13000) return 'silver';
  if (v >= 12000) return 'bronze';
  if (v >= 10000) return 'purple';
  if (v >= 7000) return 'red';
  if (v >= 4000) return 'orange';
  if (v >= 2000) return 'green';
  if (v >= 1) return 'blue';
  return 'normal';
}

async function drawPlayerHeader(ctx, account, fontFamily) {
  const name           = account?.player?.name || 'Player';
  const title          = account?.extra?.title || '';
  const rating         = Number(account?.metrics?.rating) || 0;
  const gameVer        = Number(account?.gameVersion) || 13;
  const courseRankIndex = account?.extra?.courseRankIndex ?? null;
  const courseRankUrl  = account?.extra?.courseRankUrl ?? null;
  const classRankUrl   = account?.extra?.classRankUrl ?? null;
  const iconUrl        = account?.extra?.iconUrl || account?.player?.iconUrl || null;
  const totalPlays     = account?.metrics?.playCount ?? null;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, WIDTH, PLAYER_H);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, PLAYER_H - 1, WIDTH, 1);

  // Avatar
  const AV = 100, ax = 22, ay = (PLAYER_H - AV) / 2;
  const avatar = await getImage(iconUrl);
  ctx.save();
  roundedRectPath(ctx, ax, ay, AV, AV, 10); ctx.clip();
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(ax, ay, AV, AV);
  if (avatar) ctx.drawImage(avatar, ax, ay, AV, AV);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
  roundedRectPath(ctx, ax, ay, AV, AV, 10); ctx.stroke();
  ctx.restore();

  // Title pill + name + plays
  const tx = ax + AV + 18;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
  if (title) {
    ctx.font = `500 14px ${fontFamily}`; ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(title).width;
    const pH = 24, pY = PLAYER_H / 2 - 50;
    ctx.fillStyle = 'rgba(255,220,80,0.18)'; ctx.shadowBlur = 0;
    roundedRectPath(ctx, tx, pY, tw + 20, pH, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,80,0.38)'; ctx.lineWidth = 1;
    roundedRectPath(ctx, tx, pY, tw + 20, pH, 3); ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,100,0.9)'; ctx.shadowBlur = 5;
    ctx.fillText(title, tx + 10, pY + pH - 5);
  }
  ctx.font = `700 32px ${fontFamily}`; ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, tx, PLAYER_H / 2 + 14);
  if (totalPlays != null) {
    ctx.font = `500 13px ${fontFamily}`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`${Number(totalPlays).toLocaleString()} plays`, tx, PLAYER_H / 2 + 34);
  }
  ctx.restore();

  // Right cluster (right-to-left): logo → class rank → dani → rating
  let rx = WIDTH - 22;

  const logoImg = await getImage(join(TOMOMAI, 'logo', `${gameVer}.png`));
  if (logoImg) {
    const lh = 54, lw = logoImg.width * (lh / logoImg.height);
    rx -= lw;
    ctx.drawImage(logoImg, rx, (PLAYER_H - lh) / 2, lw, lh);
    rx -= 16;
  }

  if (classRankUrl) {
    const ci = await getImage(classRankUrl);
    if (ci) {
      const ch = 48, cw = ci.width * (ch / ci.height);
      rx -= cw; ctx.drawImage(ci, rx, (PLAYER_H - ch) / 2, cw, ch); rx -= 14;
    }
  }

  const daniSrc = courseRankIndex != null
    ? join(DANI_ASSET, `dani_${String(courseRankIndex).padStart(2, '0')}.png`)
    : courseRankUrl;
  if (daniSrc) {
    const di = await getImage(daniSrc);
    if (di) {
      const dh = 48, dw = di.width * (dh / di.height);
      rx -= dw; ctx.drawImage(di, rx, (PLAYER_H - dh) / 2, dw, dh); rx -= 14;
    }
  }

  const frameImg = await getImage(join(TOMOMAI, 'rating', `${ratingVariant(rating, gameVer)}.png`));
  const FRAME_SCALE = 0.80;
  if (frameImg) {
    const fw = frameImg.width * FRAME_SCALE, fh = frameImg.height * FRAME_SCALE;
    rx -= fw;
    const fy = (PLAYER_H - fh) / 2;
    ctx.drawImage(frameImg, rx, fy, fw, fh);
    await drawRatingPlateDigits(ctx, rating, rx, fy, fw, fh);
  }
}

export async function renderPlaylistTargetGraphic({ account, playlistName, entries, themeDir }) {
  await registerFonts();
  const { theme, assets } = await loadTheme(themeDir);
  const preparedEntries = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      cover: entry.jacketPath ? await getImage(entry.jacketPath) : null,
      rankImage: entry.rankKey ? await getImage(resolveDxratingRankPath(entry.rankKey)) : null
    }))
  );
  const rows = Math.max(1, Math.ceil(preparedEntries.length / COLUMNS));
  const height = HEADER_HEIGHT + rows * CELL_HEIGHT + (rows - 1) * GRID_GAP + BOTTOM_PAD;

  const canvas = new Canvas(WIDTH, height);
  const ctx = canvas.getContext('2d');
  ctx._fontFamily = theme.fontFamily;

  const background = await getImage(assets.background);
  if (background) {
    drawImageCover(ctx, background, 0, 0, WIDTH, height);
  } else {
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, WIDTH, height);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, WIDTH, height);

  // Player header
  await drawPlayerHeader(ctx, account, theme.fontFamily);

  // Playlist title bar
  const barY = PLAYER_H;
  const songCount = preparedEntries.length;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, barY, WIDTH, PLAYLIST_BAR_H);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, barY + PLAYLIST_BAR_H - 1, WIDTH, 1);
  ctx.textBaseline = 'middle';
  ctx.font = `700 20px ${theme.fontFamily}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(trimText(playlistName, 60), 22, barY + PLAYLIST_BAR_H / 2);
  ctx.font = `500 13px ${theme.fontFamily}`;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'right';
  ctx.fillText(`${songCount} song${songCount !== 1 ? 's' : ''}`, WIDTH - 22, barY + PLAYLIST_BAR_H / 2);

  const cellWidth = WIDTH / COLUMNS;
  await Promise.all(preparedEntries.map((entry, index) => {
    const row = Math.floor(index / COLUMNS);
    const column = index % COLUMNS;
    const x = column * cellWidth + CELL_PADDING;
    const y = HEADER_HEIGHT + row * (CELL_HEIGHT + GRID_GAP);
    return drawCell(ctx, entry, index, theme, x, y, cellWidth - CELL_PADDING * 2, CELL_HEIGHT);
  }));

  drawMaiDeckWatermark(ctx, { width: WIDTH, height, fontFamily: theme.fontFamily });

  const buffer = await canvas.toBuffer('png');
  return {
    buffer,
    fileName: `${String(playlistName || 'playlist').replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'playlist'}-targets.png`
  };
}
