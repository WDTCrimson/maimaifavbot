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
      cache.set(path, (async () => {
        try {
          if (/^https?:\/\//i.test(path) || /^data:/i.test(path)) {
            const response = await fetch(path);
            if (!response.ok) {
              return null;
            }
            const arrayBuffer = await response.arrayBuffer();
            return loadImage(Buffer.from(arrayBuffer));
          }
          return loadImage(path);
        } catch {
          return null;
        }
      })());
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
        jacketSong: song,
        bucket: entry.bucket || 'old'
      };
    })
  );
}

function buildSectionSummary(label, entries) {
  const total = sumRatings(entries);
  return `${label}: ${entries.length} songs • ${total} total • ${entries.length ? (total / entries.length).toFixed(1) : '0.0'} avg`;
}

async function drawSongCard(ctx, cache, theme, fontFamily, card, x, y, width, height) {
  const jacketImage = await cache.get(card.imagePath);
  const difficultyColor = getDifficultyTextColor(theme, card.difficulty);

  ctx.save();
  roundedRectPath(ctx, x, y, width, height, 10);
  ctx.clip();
  if (jacketImage) {
    drawImageCover(ctx, jacketImage, x - 4, y - 4, width + 8, height + 8);
  } else {
    ctx.fillStyle = '#43253e';
    ctx.fillRect(x, y, width, height);
  }
  ctx.restore();

  ctx.save();
  ctx.shadowColor = '#00000026';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  const coverGradient = ctx.createLinearGradient(0, y + height, 0, y);
  coverGradient.addColorStop(0, '#0000003c');
  coverGradient.addColorStop(0.5, '#00000029');
  coverGradient.addColorStop(1, '#0000001c');
  ctx.fillStyle = coverGradient;
  ctx.strokeStyle = difficultyColor;
  ctx.lineWidth = 4;
  roundedRectPath(ctx, x, y, width, height, 10);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const infoHeight = 70;
  const infoGradient = ctx.createLinearGradient(0, y + height, 0, y + height - infoHeight);
  infoGradient.addColorStop(0, '#00000060');
  infoGradient.addColorStop(1, '#00000000');
  ctx.save();
  ctx.globalAlpha = 0.3;
  roundedRectPath(ctx, x, y, width, height, 10);
  ctx.clip();
  ctx.fillStyle = infoGradient;
  ctx.fillRect(x, y + height - infoHeight, width, infoHeight);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.font = `700 18px ${fontFamily}`;
  ctx.fillStyle = '#f5f5f5';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.beginPath();
  ctx.rect(x + 2, y + 2, width - 14, height - 14);
  ctx.clip();
  ctx.fillText(trimTextToWidth(ctx, card.title || 'Unknown Song', width - 24), x + 12, y + height - 39);
  ctx.shadowColor = '#00000030';
  ctx.fillText(trimTextToWidth(ctx, card.title || 'Unknown Song', width - 24), x + 12, y + height - 39);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.font = `550 16px ${fontFamily}`;
  ctx.fillStyle = '#f5f5f5';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(formatAchievement(card.achievement), x + 12, y + height - 14);
  ctx.shadowColor = '#00000030';
  ctx.fillText(formatAchievement(card.achievement), x + 12, y + height - 14);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.font = `600 26px ${fontFamily}`;
  ctx.fillStyle = '#f5f5f5';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(String(card.rating || 0), x + width - 10, y + height - 8);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.save();
  ctx.font = `500 14px ${fontFamily}`;
  const diffText = formatConstant(card.internalLevelValue);
  const diffWidth = ctx.measureText(diffText).width;
  ctx.fillStyle = difficultyColor;
  roundedRectPath(ctx, x, y, width, height, 10);
  ctx.clip();
  roundedRectPath(ctx, x + width - diffWidth - 30, y - 10, diffWidth + 30, 34, 10);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.font = `500 14px ${fontFamily}`;
  ctx.fillStyle = String(card.difficulty || '').toLowerCase() === 'remaster' ? '#591a8b' : '#f2f2f2';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(diffText, x + width - 10, y + 4);
  ctx.restore();

  const badge = await cache.get(resolveDifficultyBadgePath(card.difficulty));
  if (badge) {
    drawImageContain(ctx, badge, x + 8, y + 8, 48, 16);
  }

  roundedRectPath(ctx, x + 12, y + 28, 34, 14, 7);
  ctx.fillStyle = String(card.type || '').toLowerCase() === 'dx' ? '#f59e0b' : '#3b82f6';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 9px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText(String(card.type || 'std').toUpperCase(), x + 29, y + 38);
  ctx.textAlign = 'left';

  ctx.fillStyle = theme.subtitleColor;
  ctx.font = `600 12px ${fontFamily}`;
  const fcFs = [card.fc && card.fc !== 'none' ? String(card.fc).toUpperCase() : null, card.fs && card.fs !== 'none' ? String(card.fs).toUpperCase() : null]
    .filter(Boolean)
    .join(' / ');
  if (fcFs) {
    ctx.fillText(fcFs, x + 12, y + 60);
  }
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
    ratingPlate: resolveRatingPlatePath(account.metrics?.rating, visualVersion),
    titleTrophy: join(
      process.cwd(),
      'data',
      'assets',
      'tomomai',
      'res',
      'trophy',
      `${String(account.extra?.titleType || 'normal').toLowerCase()}.png`
    ),
    profileIcon: account.player?.iconUrl || account.extra?.iconUrl || null,
    classRank: account.extra?.classRankUrl || null,
    courseRank: account.extra?.courseRankUrl || null
  };

  const b15 = await buildRenderEntries(best50.b15, songCatalog);
  const b35 = await buildRenderEntries(best50.b35, songCatalog);

  const width = 1200;
  const height = 2100;
  const margin = 36;
  const cardGap = 16;
  const columns = 5;
  const overlayLeft = margin;
  const overlayWidth = width - margin * 2;
  const cardWidth = (overlayWidth - cardGap * 4) / columns;
  const cardHeight = (cardWidth / 16) * 11;
  const headerHeight = 276;

  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');
  const imageCache = createImageCache();
  await imageCache.prefetch([
    assets.background,
    assets.headerOverlay,
    assets.logo,
    assets.ratingPlate,
    assets.titleTrophy,
    assets.profileIcon,
    assets.classRank,
    assets.courseRank,
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

  const overlayTop = 276;
  const gradient = ctx.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(1, '#00000020');
  gradient.addColorStop(0, '#00000020');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, overlayTop, width, height - overlayTop);

  const headerOverlay = await imageCache.get(assets.headerOverlay);
  if (headerOverlay) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    drawImageContain(ctx, headerOverlay, width - 540, -30, 360, 260);
    ctx.restore();
  }

  const logo = await imageCache.get(assets.logo);
  if (logo) {
    drawImageContain(ctx, logo, width - 530, 120, 320, 110);
  }

  const icon = await imageCache.get(assets.profileIcon);
  const trophy = await imageCache.get(assets.titleTrophy);
  const ratingPlate = await imageCache.get(assets.ratingPlate);
  const classRank = await imageCache.get(assets.classRank);
  const courseRank = await imageCache.get(assets.courseRank);

  if (icon) {
    drawImageContain(ctx, icon, 36, 36, 204, 204);
  }

  if (trophy) {
    drawImageContain(ctx, trophy, 272, 36, 345, 74);
    ctx.fillStyle = '#f9f0f4';
    ctx.font = `450 18px ${fontFamily}`;
    const title = trimText(String(account.player?.title || account.extra?.title || ''), 40);
    const trophyTextWidth = ctx.measureText(title).width;
    ctx.fillText(title, 272 + 345 / 2 - trophyTextWidth / 2, 82);
  }

  roundedRectPath(ctx, 272, 130, 345, 74, 10);
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = 'black';
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#f9f0f4';
  ctx.font = `700 28px ${fontFamily}`;
  const playerName = trimText(String(account.player?.name || 'Unknown Player'), 24);
  const playerNameWidth = ctx.measureText(playerName).width;
  ctx.fillText(playerName, 272 + 345 / 2 - playerNameWidth / 2, 174);

  if (ratingPlate) {
    drawImageContain(ctx, ratingPlate, 270, 220, 160, 46);
    ctx.fillStyle = '#f9f0f4';
    ctx.font = `600 24px ${fontFamily}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(account.metrics?.rating || 0)), 270 + 130, 251);
    ctx.textAlign = 'left';
  }

  if (classRank) {
    drawImageContain(ctx, classRank, 442, 218, 70, 52);
  }
  if (courseRank) {
    drawImageContain(ctx, courseRank, 522, 220, 64, 46);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = `600 14px ${fontFamily}`;
  ctx.fillText(`B15 ${b15.length}/15`, 36, 316);
  ctx.fillText(`B35 ${b35.length}/35`, 36, 856);

  const b15YOffset = 60;
  for (let index = 0; index < b15.length; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = overlayLeft + col * (cardWidth + cardGap);
    const y = overlayTop + b15YOffset + row * (cardHeight + 2 + cardGap);
    await drawSongCard(ctx, imageCache, theme, fontFamily, b15[index], x, y, cardWidth, cardHeight);
  }

  const b35YOffset = 110;
  for (let index = 0; index < b35.length; index += 1) {
    const col = index % columns;
    const absoluteIndex = index + 15;
    const row = Math.floor(absoluteIndex / columns);
    const x = overlayLeft + col * (cardWidth + cardGap);
    const y = overlayTop + b35YOffset + row * (cardHeight + 2 + cardGap);
    await drawSongCard(ctx, imageCache, theme, fontFamily, b35[index], x, y, cardWidth, cardHeight);
  }

  ctx.fillStyle = '#ffffffaa';
  ctx.font = `500 14px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText(
    `Generated ${new Date().toLocaleString('en-GB')} • maimai Favorite Bot`,
    width - 36,
    height - 18
  );
  ctx.textAlign = 'left';

  return {
    buffer: await canvas.toBuffer('png'),
    fileName: `${sanitizeFileName(account.player?.name || 'account')}-b50.png`
  };
}
