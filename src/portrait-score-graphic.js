import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

// ─── Constants ────────────────────────────────────────────────────────────────

const SCORE_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'score');
const DANI_ASSET  = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'dani');

const CANVAS_W  = 1080;
const CANVAS_H  = 1392;
const COVER_W   = 180;
const COVER_H   = 101; // floor(180 / (16/9))
const GAP_X     = 12;
const GAP_Y     = 12;
const COLS      = 5;

// Positions from portrait_splash theme.yml
const HEADER = {
  name:     { x: 157, y: 98,  size: 30 },
  dxrating: { x: 285, y: 47,  size: 15 },
  ratingBg: { x: 140, y: 20 },
  dani:     { x: 330, y: 20,  scale: 0.58 },
};
const TILE = {
  shadow:   { x: 2,   y: 2 },
  type:     { x: 115, y: 2,  scale: 1.0 },
  rateIcon: { x: 125, y: 53, scale: 0.42 },
  fcIcon:   { x: 130, y: 76, scale: 0.5 },
  fsIcon:   { x: 152, y: 76, scale: 0.5 },
  title:    { x: 8,   y: 47, size: 20 },
  achieve:  { x: 8,   y: 70, size: 16 },
  base:     { x: 8,   y: 91, size: 14 },
};

// Grid section origins (from theme.yml oldCharts / newCharts)
const OLD_ORIGIN = { x: 69, y: 206 };
const NEW_ORIGIN = { x: 69, y: 1046 };

const DIFF_LABEL_FILE = {
  basic:    'label_Basic.png',
  advanced: 'label_Advanced.png',
  expert:   'label_Expert.png',
  master:   'label_Master.png',
  remaster: 'label_ReMASTER.png',
};

const FONT_FAMILY = 'Inter, Murecho, "Noto Sans JP", sans-serif';

// ─── Image cache ──────────────────────────────────────────────────────────────

const IMAGE_CACHE = new Map();
const REGISTERED_FONTS = new Set();

async function fileExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function loadCachedImage(path) {
  if (!path) return null;
  if (IMAGE_CACHE.has(path)) return IMAGE_CACHE.get(path);
  const promise = (async () => {
    try {
      if (/^https?:\/\//.test(path)) return await loadImage(path);
      if (!(await fileExists(path))) return null;
      return await loadImage(path);
    } catch { return null; }
  })();
  IMAGE_CACHE.set(path, promise);
  return promise;
}

async function registerFonts() {
  if (REGISTERED_FONTS.size) return;
  const tomomaiFont = join(process.cwd(), 'data', 'assets', 'tomomai', 'res', 'fonts');
  const mappings = [
    ['Inter',       join(tomomaiFont, 'Inter-VariableFont_opsz,wght.woff2')],
    ['Murecho',     join(tomomaiFont, 'Murecho-VariableFont_wght.woff2')],
    ['Noto Sans JP',join(tomomaiFont, 'NotoSansJP-VariableFont_wght.woff2')],
  ];
  for (const [family, path] of mappings) {
    if (await fileExists(path)) {
      FontLibrary.use(family, [path]);
      REGISTERED_FONTS.add(family);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreAsset(name) {
  return join(SCORE_ASSET, name);
}

function getRankIconFile(achievement) {
  const a = Number(achievement) || 0;
  if (a >= 1005000) return 'music_icon_sssp.png';
  if (a >= 1000000) return 'music_icon_sss.png';
  if (a >= 995000)  return 'music_icon_ssp.png';
  if (a >= 990000)  return 'music_icon_ss.png';
  if (a >= 980000)  return 'music_icon_sp.png';
  if (a >= 970000)  return 'music_icon_s.png';
  if (a >= 940000)  return 'music_icon_aaa.png';
  if (a >= 900000)  return 'music_icon_aa.png';
  if (a >= 800000)  return 'music_icon_a.png';
  if (a >= 750000)  return 'music_icon_bbb.png';
  if (a >= 700000)  return 'music_icon_bb.png';
  if (a >= 600000)  return 'music_icon_b.png';
  if (a >= 500000)  return 'music_icon_c.png';
  return 'music_icon_d.png';
}

function getFcIconFile(fc) {
  const map = { 'fc': 'music_icon_fc.png', 'fc+': 'music_icon_fcp.png', 'ap': 'music_icon_ap.png', 'ap+': 'music_icon_app.png' };
  return map[String(fc || '').toLowerCase()] || null;
}

function getFsIconFile(fs) {
  const map = { 'sync': 'music_icon_fs.png', 'fs': 'music_icon_fs.png', 'fs+': 'music_icon_fsp.png', 'fdx': 'music_icon_fsd.png', 'fdx+': 'music_icon_fsdp.png' };
  return map[String(fs || '').toLowerCase()] || null;
}

function getRatingFrameIndex(rating) {
  const r = Number(rating) || 0;
  if (r >= 15000) return 11;
  if (r >= 14500) return 10;
  if (r >= 14000) return  9;
  if (r >= 13000) return  8;
  if (r >= 12000) return  7;
  if (r >= 10000) return  6;
  if (r >= 7000)  return  5;
  if (r >= 4000)  return  4;
  if (r >= 2000)  return  3;
  if (r >= 1000)  return  2;
  return 1;
}

function formatAchievement(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?.????%';
  return `${(n / 10000).toFixed(4)}%`;
}

function trimToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

function sanitizeFileName(text) {
  return String(text || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'score';
}

function resolveJacketPath(song) {
  if (song?.jacket?.dxratingFile) return join(process.cwd(), 'data', 'assets', 'jacket', 'dxrating', song.jacket.dxratingFile);
  if (song?.jacket?.otogeFile)    return join(process.cwd(), 'data', 'assets', 'jacket', 'otoge-db', song.jacket.otogeFile);
  return null;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

async function drawJacketCover(ctx, imagePath, x, y, w, h) {
  const fallback = scoreAsset('default_cover.png');
  const img = (await loadCachedImage(imagePath)) || (await loadCachedImage(fallback));
  if (!img) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // square center-crop to fill w×h
  const srcSize = Math.min(img.width, img.height);
  const srcX    = (img.width  - srcSize) / 2;
  const srcY    = (img.height - srcSize) / 2;
  const scale   = Math.max(w / srcSize, h / srcSize);
  const dw = srcSize * scale;
  const dh = srcSize * scale;
  ctx.drawImage(img, srcX, srcY, srcSize, srcSize, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

async function drawTile(ctx, entry, tx, ty) {
  const diff     = String(entry.difficulty || 'master').toLowerCase();
  const labelFile = DIFF_LABEL_FILE[diff] || 'label_Master.png';

  // 1. jacket art as background (center-cropped to COVER_W × COVER_H)
  await drawJacketCover(ctx, entry.jacketPath, tx, ty, COVER_W, COVER_H);

  // 2. difficulty label overlay (drawn at shadow offset for depth)
  const label = await loadCachedImage(scoreAsset(labelFile));
  if (label) {
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.drawImage(label, tx + TILE.shadow.x, ty + TILE.shadow.y, COVER_W, COVER_H);
    ctx.globalAlpha = 1.0;
    ctx.drawImage(label, tx, ty, COVER_W, COVER_H);
    ctx.restore();
  }

  // 3. type badge (DX / STD)
  const typeFile = String(entry.type || '').toLowerCase() === 'dx' ? 'type_dx.png' : 'type_sd.png';
  const typeImg  = await loadCachedImage(scoreAsset(typeFile));
  if (typeImg) {
    ctx.drawImage(typeImg,
      tx + TILE.type.x, ty + TILE.type.y,
      typeImg.width * TILE.type.scale, typeImg.height * TILE.type.scale);
  }

  // 4. rank icon
  const rankImg = await loadCachedImage(scoreAsset(getRankIconFile(entry.achievement)));
  if (rankImg) {
    ctx.drawImage(rankImg,
      tx + TILE.rateIcon.x, ty + TILE.rateIcon.y,
      rankImg.width * TILE.rateIcon.scale, rankImg.height * TILE.rateIcon.scale);
  }

  // 5. FC icon
  const fcFile = getFcIconFile(entry.fc);
  if (fcFile) {
    const fcImg = await loadCachedImage(scoreAsset(fcFile));
    if (fcImg) {
      ctx.drawImage(fcImg,
        tx + TILE.fcIcon.x, ty + TILE.fcIcon.y,
        fcImg.width * TILE.fcIcon.scale, fcImg.height * TILE.fcIcon.scale);
    }
  }

  // 6. FS icon
  const fsFile = getFsIconFile(entry.fs);
  if (fsFile) {
    const fsImg = await loadCachedImage(scoreAsset(fsFile));
    if (fsImg) {
      ctx.drawImage(fsImg,
        tx + TILE.fsIcon.x, ty + TILE.fsIcon.y,
        fsImg.width * TILE.fsIcon.scale, fsImg.height * TILE.fsIcon.scale);
    }
  }

  // 7. text: song title, achievement, internal level
  const textMaxW = TILE.type.x - TILE.title.x - 4;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle    = '#ffffff';
  ctx.shadowColor  = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur   = 3;

  ctx.font = `600 ${TILE.title.size}px ${FONT_FAMILY}`;
  ctx.fillText(trimToWidth(ctx, entry.title || '?', textMaxW), tx + TILE.title.x, ty + TILE.title.y);

  ctx.font = `500 ${TILE.achieve.size}px ${FONT_FAMILY}`;
  ctx.fillText(formatAchievement(entry.achievement), tx + TILE.achieve.x, ty + TILE.achieve.y);

  const baseText = entry.internalLevelValue != null
    ? `${Number(entry.internalLevelValue).toFixed(1)}  ${entry.rating ?? ''}`.trim()
    : entry.levelDisplay ?? '';
  ctx.font = `400 ${TILE.base.size}px ${FONT_FAMILY}`;
  ctx.fillText(trimToWidth(ctx, baseText, textMaxW), tx + TILE.base.x, ty + TILE.base.y);

  ctx.restore();
}

function drawGrid(ctx, entries, origin, maxRows) {
  const promises = [];
  for (let i = 0; i < Math.min(entries.length, COLS * maxRows); i += 1) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const tx  = origin.x + col * (COVER_W + GAP_X);
    const ty  = origin.y + row * (COVER_H + GAP_Y);
    promises.push(drawTile(ctx, entries[i], tx, ty));
  }
  return Promise.all(promises);
}

async function drawSectionLabel(ctx, text, x, y) {
  ctx.save();
  ctx.font         = `700 22px ${FONT_FAMILY}`;
  ctx.fillStyle    = 'rgba(0,0,0,0.45)';
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(text).width + 28;
  ctx.beginPath();
  ctx.roundRect(x, y - 22, w, 30, 6);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + 14, y);
  ctx.restore();
}

async function drawHeader(ctx, account) {
  const rating   = Number(account?.metrics?.rating) || 0;
  const name     = account?.player?.name || 'Player';
  const courseRankIndex = account?.extra?.courseRankIndex ?? null;
  const courseRankUrl   = account?.extra?.courseRankUrl ?? null;

  // rating frame
  const frameIdx  = getRatingFrameIndex(rating);
  const frameFile = `rating_base_${String(frameIdx).padStart(2, '0')}.png`;
  const frameImg  = await loadCachedImage(scoreAsset(frameFile));
  if (frameImg) {
    ctx.drawImage(frameImg, HEADER.ratingBg.x, HEADER.ratingBg.y, frameImg.width, frameImg.height);
    // rating digits on frame
    ctx.save();
    ctx.font         = `700 ${HEADER.dxrating.size}px ${FONT_FAMILY}`;
    ctx.fillStyle    = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor  = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur   = 4;
    ctx.fillText(String(rating), HEADER.dxrating.x, HEADER.dxrating.y + HEADER.dxrating.size);
    ctx.restore();
  }

  // dan rank icon
  const daniSrc = courseRankIndex != null
    ? join(DANI_ASSET, `dani_${String(courseRankIndex).padStart(2, '0')}.png`)
    : courseRankUrl;
  if (daniSrc) {
    const daniImg = await loadCachedImage(daniSrc);
    if (daniImg) {
      ctx.drawImage(daniImg,
        HEADER.dani.x, HEADER.dani.y,
        daniImg.width * HEADER.dani.scale, daniImg.height * HEADER.dani.scale);
    }
  }

  // player name
  ctx.save();
  ctx.font         = `700 ${HEADER.name.size}px ${FONT_FAMILY}`;
  ctx.fillStyle    = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor  = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur   = 6;
  ctx.fillText(name, HEADER.name.x, HEADER.name.y);
  ctx.restore();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderPortraitScoreGraphic({ account, songCatalog }) {
  await registerFonts();

  const best50 = account?.best50;
  if (!best50 || !Array.isArray(best50.b15) || !Array.isArray(best50.b35)) {
    throw new Error('No B50 data available. Run /account sync first.');
  }

  function buildEntries(rawList) {
    return rawList.map((entry) => {
      const song = entry.favoriteId ? songCatalog.getByFavoriteId(entry.favoriteId) : null;
      return {
        ...entry,
        title:              song?.title ?? entry.title ?? 'Unknown',
        jacketPath:         resolveJacketPath(song),
        internalLevelValue: entry.internalLevelValue ?? song?.charts?.[entry.difficulty]?.internalLevelValue ?? null,
        levelDisplay:       entry.level ?? '',
      };
    });
  }

  const b15 = buildEntries(best50.b15);
  const b35 = buildEntries(best50.b35);

  const canvas = new Canvas(CANVAS_W, CANVAS_H);
  const ctx    = canvas.getContext('2d');

  // background
  const bg = await loadCachedImage(scoreAsset('score_bg.png'));
  if (bg) ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);

  await drawHeader(ctx, account);

  // section labels (positioned just above each grid)
  const b35Total = b35.reduce((s, e) => s + (e.rating ?? 0), 0);
  const b15Total = b15.reduce((s, e) => s + (e.rating ?? 0), 0);
  await drawSectionLabel(ctx, `OLD SONGS  ${b35.length}/35  ${b35Total} pts`, OLD_ORIGIN.x, OLD_ORIGIN.y - 8);
  await drawSectionLabel(ctx, `NEW SONGS  ${b15.length}/15  ${b15Total} pts`, NEW_ORIGIN.x, NEW_ORIGIN.y - 8);

  await drawGrid(ctx, b35, OLD_ORIGIN, 7);
  await drawGrid(ctx, b15, NEW_ORIGIN, 3);

  const buffer = await canvas.toBuffer('png');
  return {
    buffer,
    fileName: `${sanitizeFileName(account?.player?.name || 'player')}-score-card.png`,
  };
}
