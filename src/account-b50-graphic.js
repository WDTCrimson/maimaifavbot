import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const loadedThemeFonts = new Map();

const defaultTheme = {
  backgroundStart: '#fbdffe',
  backgroundMiddle: '#f5bac8',
  backgroundEnd: '#fdb2e0',
  glow1Color: 'rgba(255, 235, 245, 0.22)',
  glow2Color: 'rgba(255, 210, 230, 0.18)',
  glowRadius: 420,
  diamondSize: 40,
  diamondOpacity: 0.06,
  overlayTint: 'rgba(60, 20, 40, 0.08)',
  headerFill: '#4f2547',
  cardFill: '#261430',
  cardFillOpacity: 0.78,
  cardStroke: '#f6b8dd',
  cardTitleBar: '#4f2344',
  titleColor: '#ffffff',
  subtitleColor: '#ffe4f3',
  artistColor: '#f2d7ff',
  chartColor: '#f9e9ff',
  difficultyColorBasic: '#22bb5b',
  difficultyColorAdvanced: '#fb9c2d',
  difficultyColorExpert: '#f64861',
  difficultyColorMaster: '#9e45e2',
  difficultyColorRemaster: '#ba67f8',
  versionColor: '#ffe2ef',
  fontFamily: 'FOT-NewRodin Pro, Inter, Murecho, Noto Sans JP, Arial, sans-serif'
};

const DIFFICULTY_SHORT = {
  basic: 'BSC',
  advanced: 'ADV',
  expert: 'EXP',
  master: 'MAS',
  remaster: 'REMAS'
};

function sanitizeFileName(text) {
  const value = String(text || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return value || 'b50';
}

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

function formatAchievement(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '?.????%';
  }
  return `${(number / 10000).toFixed(4)}%`;
}

function formatConstant(value) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Number.isInteger(number) ? number.toFixed(1) : String(number);
  }
  const text = String(value || '').trim();
  if (!text) {
    return '?';
  }
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
}

function getDifficultyTextColor(theme, difficulty) {
  const normalized = String(difficulty || '').toLowerCase();
  const colors = {
    basic: theme.difficultyColorBasic || '#22bb5b',
    advanced: theme.difficultyColorAdvanced || '#fb9c2d',
    expert: theme.difficultyColorExpert || '#f64861',
    master: theme.difficultyColorMaster || '#9e45e2',
    remaster: theme.difficultyColorRemaster || '#ba67f8'
  };
  return colors[normalized] || theme.chartColor;
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

    const family = `MaimaiB50Theme-${Buffer.from(themeDir).toString('base64url').slice(0, 16)}`;
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
  const theme = {
    ...defaultTheme,
    ...themeJson
  };

  return {
    theme,
    resolvedDir,
    fontFamily:
      (await loadThemeFontFamily(resolvedDir)) != null
        ? `"${await loadThemeFontFamily(resolvedDir)}", ${theme.fontFamily}`
        : theme.fontFamily
  };
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
  return { get, prefetch };
}

function drawFallbackBackground(ctx, width, height, theme) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, theme.backgroundStart);
  gradient.addColorStop(0.4, theme.backgroundMiddle);
  gradient.addColorStop(1, theme.backgroundEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow1 = ctx.createRadialGradient(width * 0.25, height * 0.12, 0, width * 0.25, height * 0.12, theme.glowRadius);
  glow1.addColorStop(0, theme.glow1Color);
  glow1.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, width, height);

  const glow2 = ctx.createRadialGradient(width * 0.85, height * 0.3, 0, width * 0.85, height * 0.3, theme.glowRadius);
  glow2.addColorStop(0, theme.glow2Color);
  glow2.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = theme.overlayTint;
  ctx.fillRect(0, 0, width, height);
}

function resolveVersionVisualId(value) {
  const number = Number(value);
  if (number >= 13) return 13;
  if (number >= 12) return 12;
  if (number >= 11) return 11;
  return 10;
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

function getRatingPlateVariant(rating, gameVersion) {
  const value = Number(rating) || 0;
  const version = Number(gameVersion) || 0;
  if (value >= 16000 && version >= 13) return 'kiwami';
  if (value >= 15000) return 'rainbow';
  if (value >= 14500) return 'platinum';
  if (value >= 14000) return 'gold';
  if (value >= 13000) return 'silver';
  if (value >= 12000) return 'bronze';
  if (value >= 10000) return 'purple';
  if (value >= 7000) return 'red';
  if (value >= 4000) return 'orange';
  if (value >= 2000) return 'green';
  if (value >= 1) return 'blue';
  return 'normal';
}

function resolveRatingPlatePath(rating, gameVersion) {
  const variant = getRatingPlateVariant(rating, gameVersion);
  return join(process.cwd(), 'data', 'assets', 'tomomai', 'res', 'rating', `${variant}.png`);
}

function resolveDifficultyBadgePath(difficulty) {
  const normalized = String(difficulty || '').toLowerCase();
  if (!normalized) {
    return null;
  }
  return join(process.cwd(), 'data', 'assets', 'tomomai', 'res', 'songs', `song_${normalized}.png`);
}

function resolveSectionLabelPath(bucket) {
  return join(process.cwd(), 'data', 'assets', 'tomomai', 'res', 'label', `${bucket}.png`);
}

function sumRatings(entries) {
  return entries.reduce((sum, entry) => sum + (Number.isFinite(Number(entry?.rating)) ? Number(entry.rating) : 0), 0);
}

async function buildRenderEntries(entries, songCatalog) {
  return Promise.all(
    entries.map(async (entry, index) => {
      const song = entry.favoriteId ? songCatalog.getByFavoriteId(entry.favoriteId) : null;
      return {
        ...entry,
        index,
        imagePath: await resolveSongImagePath(song),
        jacketSong: song
      };
    })
  );
}

function buildSectionSummary(label, entries) {
  const total = sumRatings(entries);
  return `${label}: ${entries.length} songs • ${total} total • ${entries.length ? (total / entries.length).toFixed(1) : '0.0'} avg`;
}

async function drawSongCard(ctx, cache, theme, fontFamily, card, x, y, width, height) {
  roundedRectPath(ctx, x, y, width, height, 16);
  ctx.fillStyle = theme.cardFill;
  ctx.globalAlpha = Number(theme.cardFillOpacity) || 0.78;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.cardStroke;
  ctx.stroke();

  roundedRectPath(ctx, x + 10, y + 10, width - 20, 22, 8);
  ctx.fillStyle = theme.cardTitleBar;
  ctx.fill();

  const labelImage = await cache.get(resolveSectionLabelPath(card.bucket));
  if (labelImage) {
    drawImageContain(ctx, labelImage, x + width - 64, y + 8, 48, 24);
  }

  ctx.fillStyle = theme.titleColor;
  ctx.font = `700 12px ${fontFamily}`;
  ctx.fillText(`#${card.index + 1}`, x + 18, y + 25);

  const jacketSize = 88;
  const jacketX = x + 16;
  const jacketY = y + 42;

  roundedRectPath(ctx, jacketX, jacketY, jacketSize, jacketSize, 10);
  ctx.save();
  ctx.clip();
  const jacketImage = await cache.get(card.imagePath);
  if (jacketImage) {
    drawImageCover(ctx, jacketImage, jacketX, jacketY, jacketSize, jacketSize);
  } else {
    ctx.fillStyle = '#3d2748';
    ctx.fillRect(jacketX, jacketY, jacketSize, jacketSize);
    ctx.fillStyle = '#f7d5eb';
    ctx.font = `700 12px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText('NO', jacketX + jacketSize / 2, jacketY + 38);
    ctx.fillText('JACKET', jacketX + jacketSize / 2, jacketY + 54);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  const badge = await cache.get(resolveDifficultyBadgePath(card.difficulty));
  if (badge) {
    drawImageContain(ctx, badge, jacketX - 2, jacketY - 6, 50, 18);
  }

  const textX = jacketX + jacketSize + 14;
  const textW = width - textX + x - 16;

  ctx.fillStyle = theme.titleColor;
  ctx.font = `700 16px ${fontFamily}`;
  const title = trimTextToWidth(ctx, trimText(card.title || 'Unknown', 60), textW);
  ctx.fillText(title, textX, y + 60);

  ctx.fillStyle = theme.artistColor;
  ctx.font = `500 12px ${fontFamily}`;
  const artist = trimTextToWidth(ctx, trimText(card.artist || 'Unknown Artist', 48), textW);
  ctx.fillText(artist, textX, y + 80);

  const typeText = String(card.type || '').toUpperCase() || 'UNK';
  roundedRectPath(ctx, textX, y + 90, 42, 18, 9);
  ctx.fillStyle = typeText === 'DX' ? '#f59e0b' : '#3b82f6';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 10px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText(typeText, textX + 21, y + 102);
  ctx.textAlign = 'left';

  ctx.fillStyle = getDifficultyTextColor(theme, card.difficulty);
  ctx.font = `700 12px ${fontFamily}`;
  ctx.fillText(
    `${DIFFICULTY_SHORT[String(card.difficulty || '').toLowerCase()] || 'CHT'} ${card.level || '?'}`,
    textX + 54,
    y + 103
  );

  ctx.fillStyle = theme.chartColor;
  ctx.font = `600 14px ${fontFamily}`;
  ctx.fillText(`Achv ${formatAchievement(card.achievement)}`, textX, y + 126);
  ctx.fillText(`Const ${formatConstant(card.internalLevelValue)}`, textX, y + 146);

  ctx.fillStyle = theme.subtitleColor;
  ctx.font = `600 13px ${fontFamily}`;
  const fcFs = [card.fc && card.fc !== 'none' ? String(card.fc).toUpperCase() : null, card.fs && card.fs !== 'none' ? String(card.fs).toUpperCase() : null]
    .filter(Boolean)
    .join(' / ');
  ctx.fillText(fcFs || 'No FC/FS badge', textX, y + 164);

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 24px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText(String(card.rating || 0), x + width - 16, y + 165);
  ctx.textAlign = 'left';
}

export async function renderAccountB50Graphic({ account, songCatalog, themeDir }) {
  const best50 = account?.best50;
  if (!best50 || !Array.isArray(best50.b15) || !Array.isArray(best50.b35)) {
    throw new Error('This account snapshot does not include B50 data yet. Run `/account sync` first.');
  }

  const { theme, resolvedDir, fontFamily } = await loadTheme(themeDir);
  const visualVersion = resolveVersionVisualId(best50.currentVersionId);
  const assets = {
    background:
      (await resolveThemeAsset(resolvedDir, `bg-${visualVersion}`)) ||
      (await resolveThemeAsset(resolvedDir, 'background')),
    headerOverlay:
      (await resolveThemeAsset(resolvedDir, `character-${visualVersion}`)) ||
      (await resolveThemeAsset(resolvedDir, 'header-overlay')),
    logo:
      (await resolveThemeAsset(resolvedDir, `logo-${visualVersion}`)) ||
      (await resolveThemeAsset(resolvedDir, 'logo')),
    cardFrame: await resolveThemeAsset(resolvedDir, 'card-frame'),
    ratingPlate: resolveRatingPlatePath(account.metrics?.rating, visualVersion)
  };

  const b15 = await buildRenderEntries(best50.b15, songCatalog);
  const b35 = await buildRenderEntries(best50.b35, songCatalog);

  const width = 1920;
  const margin = 34;
  const cardGap = 14;
  const columns = 5;
  const cardWidth = Math.floor((width - margin * 2 - cardGap * (columns - 1)) / columns);
  const cardHeight = 182;
  const headerHeight = 220;
  const sectionTitleHeight = 36;
  const b15Rows = Math.max(1, Math.ceil(Math.max(b15.length, 15) / columns));
  const b35Rows = Math.max(1, Math.ceil(Math.max(b35.length, 35) / columns));
  const sectionGap = 28;
  const footerHeight = 40;
  const height =
    margin +
    headerHeight +
    sectionGap +
    sectionTitleHeight +
    b15Rows * cardHeight +
    (b15Rows - 1) * cardGap +
    sectionGap +
    sectionTitleHeight +
    b35Rows * cardHeight +
    (b35Rows - 1) * cardGap +
    footerHeight +
    margin;

  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');
  const imageCache = createImageCache();
  await imageCache.prefetch([
    assets.background,
    assets.headerOverlay,
    assets.logo,
    assets.cardFrame,
    assets.ratingPlate,
    ...b15.map((entry) => entry.imagePath),
    ...b35.map((entry) => entry.imagePath),
    ...[...b15, ...b35].map((entry) => resolveDifficultyBadgePath(entry.difficulty)),
    resolveSectionLabelPath('new'),
    resolveSectionLabelPath('old')
  ]);

  const background = await imageCache.get(assets.background);
  if (background) {
    drawImageCover(ctx, background, 0, 0, width, height);
  } else {
    drawFallbackBackground(ctx, width, height, theme);
  }

  roundedRectPath(ctx, margin, margin, width - margin * 2, headerHeight, 24);
  ctx.fillStyle = theme.headerFill;
  ctx.globalAlpha = 0.74;
  ctx.fill();
  ctx.globalAlpha = 1;

  const headerOverlay = await imageCache.get(assets.headerOverlay);
  if (headerOverlay) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    drawImageContain(ctx, headerOverlay, width - 410, margin - 10, 320, 240);
    ctx.restore();
  }

  const logo = await imageCache.get(assets.logo);
  if (logo) {
    drawImageContain(ctx, logo, width - 370, margin + 16, 250, 82);
  }

  const title = String(account.player?.title || account.extra?.title || '').trim();
  if (title) {
    roundedRectPath(ctx, margin + 24, margin + 20, 320, 30, 15);
    ctx.fillStyle = '#ffffff22';
    ctx.fill();
    ctx.fillStyle = theme.subtitleColor;
    ctx.font = `600 16px ${fontFamily}`;
    ctx.fillText(trimTextToWidth(ctx, title, 290), margin + 40, margin + 40);
  }

  ctx.fillStyle = theme.titleColor;
  ctx.font = `800 44px ${fontFamily}`;
  ctx.fillText(trimText(String(account.player?.name || 'Unknown Player'), 32), margin + 24, margin + 96);

  ctx.fillStyle = theme.subtitleColor;
  ctx.font = `600 20px ${fontFamily}`;
  ctx.fillText('True B50 Split', margin + 24, margin + 128);
  ctx.fillText(
    trimText(`Region: ${String(account.player?.region || 'intl').toUpperCase()} • Linked via ${String(account.linkMethod || 'web')}`, 60),
    margin + 24,
    margin + 154
  );
  ctx.fillText(
    trimText(`B15 = ${b15.length} songs • B35 = ${b35.length} songs • Total = ${Math.round(best50.totalRating || 0)}`, 70),
    margin + 24,
    margin + 180
  );

  const ratingPlate = await imageCache.get(assets.ratingPlate);
  if (ratingPlate) {
    const plateX = margin + 24;
    const plateY = margin + 182 - 36;
    drawImageContain(ctx, ratingPlate, plateX, plateY, 140, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 24px ${fontFamily}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(account.metrics?.rating || 0)), plateX + 124, plateY + 28);
    ctx.textAlign = 'left';
  } else {
    ctx.fillStyle = theme.titleColor;
    ctx.font = `700 30px ${fontFamily}`;
    ctx.fillText(`Rating ${Math.round(account.metrics?.rating || 0)}`, margin + 24, margin + 200);
  }

  const sectionStartY = margin + headerHeight + sectionGap;
  ctx.fillStyle = theme.titleColor;
  ctx.font = `800 28px ${fontFamily}`;
  ctx.fillText('B15', margin, sectionStartY + 26);
  ctx.fillStyle = theme.subtitleColor;
  ctx.font = `600 16px ${fontFamily}`;
  ctx.fillText(buildSectionSummary('New Songs', b15), margin + 74, sectionStartY + 26);

  const b15GridTop = sectionStartY + sectionTitleHeight;
  for (let index = 0; index < b15.length; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * (cardWidth + cardGap);
    const y = b15GridTop + row * (cardHeight + cardGap);
    await drawSongCard(ctx, imageCache, theme, fontFamily, b15[index], x, y, cardWidth, cardHeight);
  }

  const b35SectionTop =
    b15GridTop + b15Rows * cardHeight + (b15Rows - 1) * cardGap + sectionGap;
  ctx.fillStyle = theme.titleColor;
  ctx.font = `800 28px ${fontFamily}`;
  ctx.fillText('B35', margin, b35SectionTop + 26);
  ctx.fillStyle = theme.subtitleColor;
  ctx.font = `600 16px ${fontFamily}`;
  ctx.fillText(buildSectionSummary('Old Songs', b35), margin + 74, b35SectionTop + 26);

  const b35GridTop = b35SectionTop + sectionTitleHeight;
  for (let index = 0; index < b35.length; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * (cardWidth + cardGap);
    const y = b35GridTop + row * (cardHeight + cardGap);
    await drawSongCard(ctx, imageCache, theme, fontFamily, b35[index], x, y, cardWidth, cardHeight);
  }

  ctx.fillStyle = '#ffffffaa';
  ctx.font = `500 14px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText(
    `Generated ${new Date().toLocaleString('en-GB')} • maimai Favorite Bot`,
    width - margin,
    height - 18
  );
  ctx.textAlign = 'left';

  return {
    buffer: await canvas.toBuffer('png'),
    fileName: `${sanitizeFileName(account.player?.name || 'account')}-b50.png`
  };
}
