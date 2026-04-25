import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

// ─── Layout constants ─────────────────────────────────────────────────────────

const W = 900;
const HEADER_H = 62;
const JACKET_SIZE = 256;
const SCORE_H = 96;
const H = HEADER_H + JACKET_SIZE + SCORE_H;  // 414px total

const SCORE_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'score');
const VERSION_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'version');

const DIFF_COLOR = {
  basic:    '#22c55e',
  advanced: '#f97316',
  expert:   '#ef4444',
  master:   '#a855f7',
  remaster: '#c4b5fd',
  utage:    '#f59e0b',
};

const FONT = 'Inter, Murecho, "Noto Sans JP", sans-serif';

// ─── Image cache ──────────────────────────────────────────────────────────────

const IMAGE_CACHE = new Map();
const REGISTERED_FONTS = new Set();

async function fileExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function loadCached(path) {
  if (!path) return null;
  if (IMAGE_CACHE.has(path)) return IMAGE_CACHE.get(path);
  const p = (async () => {
    try {
      if (/^https?:\/\//.test(path)) return await loadImage(path);
      if (!(await fileExists(path))) return null;
      return await loadImage(path);
    } catch { return null; }
  })();
  IMAGE_CACHE.set(path, p);
  return p;
}

async function registerFonts() {
  if (REGISTERED_FONTS.size) return;
  const base = join(process.cwd(), 'data', 'assets', 'tomomai', 'res', 'fonts');
  for (const [family, file] of [
    ['Inter',        'Inter-VariableFont_opsz,wght.woff2'],
    ['Murecho',      'Murecho-VariableFont_wght.woff2'],
    ['Noto Sans JP', 'NotoSansJP-VariableFont_wght.woff2'],
  ]) {
    const path = join(base, file);
    if (await fileExists(path)) { FontLibrary.use(family, [path]); REGISTERED_FONTS.add(family); }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRankIconFile(achievement) {
  const a = Number(achievement) || 0;
  if (a >= 1005000) return 'music_icon_sssp.png';
  if (a >= 1000000) return 'music_icon_sss.png';
  if (a >= 995000)  return 'music_icon_ssp.png';
  if (a >= 990000)  return 'music_icon_ss.png';
  if (a >= 970000)  return 'music_icon_sp.png';
  if (a >= 940000)  return 'music_icon_s.png';
  if (a >= 900000)  return 'music_icon_aaa.png';
  if (a >= 800000)  return 'music_icon_aa.png';
  if (a >= 750000)  return 'music_icon_a.png';
  if (a >= 700000)  return 'music_icon_bbb.png';
  if (a >= 600000)  return 'music_icon_bb.png';
  if (a >= 500000)  return 'music_icon_b.png';
  if (a >= 400000)  return 'music_icon_c.png';
  return 'music_icon_d.png';
}

function getFcIconFile(fc) {
  return { 'fc': 'music_icon_fc.png', 'fc+': 'music_icon_fcp.png', 'ap': 'music_icon_ap.png', 'ap+': 'music_icon_app.png' }[String(fc || '').toLowerCase()] ?? null;
}

function getFsIconFile(fs) {
  return { 'sync': 'music_icon_fs.png', 'fs': 'music_icon_fs.png', 'fs+': 'music_icon_fsp.png', 'fdx': 'music_icon_fsd.png', 'fdx+': 'music_icon_fsdp.png' }[String(fs || '').toLowerCase()] ?? null;
}

function formatAchievement(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n / 10000).toFixed(4)}%` : '?.????%';
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).replace(',', '');
  } catch { return null; }
}

function versionNameToFile(version) {
  if (!version) return null;
  const normalized = String(version).toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/でらっくす/, 'maimai_deluxe')
    .replace(/[^\w]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const map = {
    'maimai_dx': 'maimai_deluxe',
    'maimai_dx_plus': 'maimai_deluxe_plus',
    'splash_plus': 'splash_plus',
    'universe_plus': 'universe_plus',
    'festival_plus': 'festival_plus',
    'buddies_plus': 'buddies_plus',
    'prism_plus': 'prism_plus',
    'circle_plus': 'circle_plus',
  };
  return `${map[normalized] ?? normalized}.png`;
}

function trimToWidth(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

function resolveJacketPath(song) {
  if (song?.jacket?.dxratingFile) return join(process.cwd(), 'data', 'assets', 'jacket', 'dxrating', song.jacket.dxratingFile);
  if (song?.jacket?.otogeFile)    return join(process.cwd(), 'data', 'assets', 'jacket', 'otoge-db', song.jacket.otogeFile);
  return null;
}

function sanitizeFileName(text) {
  return String(text || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'score-card';
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

async function drawBackground(ctx, jacketImg) {
  // Blurred jacket fill
  if (jacketImg) {
    ctx.save();
    ctx.filter = 'blur(40px) brightness(0.25) saturate(1.4)';
    ctx.drawImage(jacketImg, -60, -60, W + 120, H + 120);
    ctx.filter = 'none';
    ctx.restore();
  } else {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#1a0a2e');
    grad.addColorStop(1, '#0d0520');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  // Dark overlay to ensure readability
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);
}

async function drawHeader(ctx, account) {
  const name   = account?.player?.name || 'Player';
  const title  = account?.extra?.title || '';
  const rating = Number(account?.metrics?.rating) || 0;
  const iconUrl = account?.extra?.iconUrl || account?.player?.iconUrl || null;

  // Header background
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, HEADER_H);

  // Avatar
  const AVATAR_SIZE = 44;
  const AVATAR_X = 10;
  const AVATAR_Y = (HEADER_H - AVATAR_SIZE) / 2;
  const avatar = iconUrl ? await loadCached(iconUrl) : null;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE, 6);
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE);
  } else {
    ctx.fillStyle = '#444';
    ctx.fillRect(AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE);
  }
  ctx.restore();

  // Name + title
  const textX = AVATAR_X + AVATAR_SIZE + 12;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  if (title) {
    ctx.font = `500 13px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(title, textX, AVATAR_Y + 14);
  }
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, textX, AVATAR_Y + AVATAR_SIZE - 4);
  ctx.restore();

  // Rating badge (right-aligned)
  ctx.save();
  ctx.font = `700 15px ${FONT}`;
  ctx.textBaseline = 'middle';
  const ratingText = String(rating);
  const ratingW = ctx.measureText(ratingText).width + 24;
  const ratingX = W - ratingW - 14;
  const ratingY = HEADER_H / 2 - 13;
  ctx.fillStyle = rating >= 15000 ? '#f0c040' : rating >= 14000 ? '#c0c0c0' : '#4ade80';
  ctx.beginPath();
  ctx.roundRect(ratingX, ratingY, ratingW, 26, 5);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.fillText(ratingText, ratingX + ratingW / 2 - ctx.measureText(ratingText).width / 2, ratingY + 13);
  ctx.restore();
}

async function drawJacketArea(ctx, jacketImg, song, score) {
  const jx = 14;
  const jy = HEADER_H + 14;
  const js = JACKET_SIZE - 28;

  // Jacket with rounded corners
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(jx, jy, js, js, 8);
  ctx.clip();
  if (jacketImg) {
    const srcSize = Math.min(jacketImg.width, jacketImg.height);
    const sx = (jacketImg.width - srcSize) / 2;
    const sy = (jacketImg.height - srcSize) / 2;
    ctx.drawImage(jacketImg, sx, sy, srcSize, srcSize, jx, jy, js, js);
  } else {
    ctx.fillStyle = '#333';
    ctx.fillRect(jx, jy, js, js);
  }
  ctx.restore();

  // Jacket border
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(jx, jy, js, js, 8);
  ctx.stroke();
  ctx.restore();

  // Version logo (bottom-left corner of jacket)
  const verFile = versionNameToFile(song?.version);
  if (verFile) {
    const verImg = await loadCached(join(VERSION_ASSET, verFile));
    if (verImg) {
      const maxVW = js * 0.55;
      const scale = Math.min(maxVW / verImg.width, 28 / verImg.height);
      const vw = verImg.width * scale;
      const vh = verImg.height * scale;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 6;
      ctx.drawImage(verImg, jx + 6, jy + js - vh - 6, vw, vh);
      ctx.restore();
    }
  }

  // DX/STD type badge (top-right of jacket)
  const typeFile = String(score?.type || '').toLowerCase() === 'dx' ? 'type_dx.png' : 'type_sd.png';
  const typeImg = await loadCached(join(SCORE_ASSET, typeFile));
  if (typeImg) {
    const tw = typeImg.width * 0.9;
    const th = typeImg.height * 0.9;
    ctx.drawImage(typeImg, jx + js - tw - 4, jy + 4, tw, th);
  }
}

async function drawSongInfo(ctx, song, score) {
  const textX = JACKET_SIZE;
  const textW  = W - textX - 16;
  const textY  = HEADER_H + 20;

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.shadowColor  = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur   = 6;

  // Song title
  ctx.font = `700 26px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  const title = song?.title || score?.title || 'Unknown Song';
  // Word-wrap in two lines if needed
  const line1MaxW = textW;
  if (ctx.measureText(title).width <= line1MaxW) {
    ctx.fillText(title, textX, textY);
  } else {
    // Try to split at a space near midpoint
    const words = title.split('');
    let line1 = '';
    let line2 = '';
    let broke = false;
    for (let i = 0; i < words.length; i++) {
      const candidate = line1 + words[i];
      if (!broke && ctx.measureText(candidate + '…').width > line1MaxW * 0.9) {
        line1 = candidate;
        line2 = words.slice(i + 1).join('');
        broke = true;
        break;
      }
      line1 = candidate;
    }
    ctx.fillText(line1 + (broke ? '' : ''), textX, textY);
    if (line2) {
      ctx.font = `700 22px ${FONT}`;
      ctx.fillText(trimToWidth(ctx, line2, textW), textX, textY + 32);
    }
  }

  // Artist
  ctx.font = `400 16px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(trimToWidth(ctx, song?.artist || '', textW), textX, textY + 72);

  // Genre tag if available
  if (song?.genre) {
    const genreText = song.genre;
    ctx.font = `500 13px ${FONT}`;
    const gw = ctx.measureText(genreText).width + 16;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.roundRect(textX, textY + 96, gw, 22, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(genreText, textX + 8, textY + 99);
  }

  ctx.restore();
}

async function drawScoreStrip(ctx, score, diff) {
  const sy = HEADER_H + JACKET_SIZE;

  // Strip background
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, sy, W, SCORE_H);
  // Thin top accent line in difficulty color
  ctx.fillStyle = DIFF_COLOR[diff] || '#888';
  ctx.fillRect(0, sy, W, 2);

  const midY = sy + SCORE_H / 2;

  // ── Left cluster: difficulty badge + level ────────────────────────────────
  let curX = 14;

  // Difficulty badge
  const diffLabel = diff === 'remaster' ? 'Re:MASTER' : diff === 'utage' ? 'U・TA・GE' : (diff || 'MASTER').toUpperCase();
  ctx.save();
  ctx.font = `700 14px ${FONT}`;
  ctx.textBaseline = 'middle';
  const dlW = ctx.measureText(diffLabel).width + 18;
  ctx.fillStyle = DIFF_COLOR[diff] || '#888';
  ctx.beginPath();
  ctx.roundRect(curX, midY - 14, dlW, 28, 5);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(diffLabel, curX + 9, midY);
  ctx.restore();
  curX += dlW + 10;

  // Internal level
  const levelText = score?.internalLevelValue != null
    ? Number(score.internalLevelValue).toFixed(1)
    : score?.level ?? '?';
  ctx.save();
  ctx.font = `600 18px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textBaseline = 'middle';
  ctx.fillText(levelText, curX, midY);
  curX += ctx.measureText(levelText).width + 12;
  ctx.restore();

  // Rank icon
  const rankImg = await loadCached(join(SCORE_ASSET, getRankIconFile(score?.achievement)));
  if (rankImg) {
    const rh = 36;
    const rw = rankImg.width * (rh / rankImg.height);
    ctx.drawImage(rankImg, curX, midY - rh / 2, rw, rh);
    curX += rw + 8;
  }

  // FC icon
  const fcFile = getFcIconFile(score?.fc);
  if (fcFile) {
    const fcImg = await loadCached(join(SCORE_ASSET, fcFile));
    if (fcImg) {
      const ih = 30;
      const iw = fcImg.width * (ih / fcImg.height);
      ctx.drawImage(fcImg, curX, midY - ih / 2, iw, ih);
      curX += iw + 6;
    }
  }

  // FS icon
  const fsFile = getFsIconFile(score?.fs);
  if (fsFile) {
    const fsImg = await loadCached(join(SCORE_ASSET, fsFile));
    if (fsImg) {
      const ih = 30;
      const iw = fsImg.width * (ih / fsImg.height);
      ctx.drawImage(fsImg, curX, midY - ih / 2, iw, ih);
    }
  }

  // ── Right cluster: achievement + dx score + date + play count ─────────────
  ctx.save();
  ctx.textBaseline = 'middle';

  // Achievement (large, far right)
  const achText = formatAchievement(score?.achievement);
  ctx.font = `700 28px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  const achW = ctx.measureText(achText).width;
  ctx.fillText(achText, W - achW - 14, midY - 12);

  // DX Score below achievement
  if (score?.dxScore != null && score?.maxDxScore != null) {
    const pct = score.maxDxScore > 0 ? ((score.dxScore / score.maxDxScore) * 100).toFixed(1) : '?';
    const dxText = `DX  ${score.dxScore.toLocaleString()} / ${score.maxDxScore.toLocaleString()}  (${pct}%)`;
    ctx.font = `400 13px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    const dxW = ctx.measureText(dxText).width;
    ctx.fillText(dxText, W - dxW - 14, midY + 16);
  }

  // Date + play count (left of achievement block, right of icons)
  const dateText = formatDate(score?.playedAtIso || score?.playedAt);
  const playText = score?.playCount != null ? `Play ${score.playCount}` : null;

  ctx.font = `400 12px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  const metaX = W - achW - 14 - 160;
  if (dateText) ctx.fillText(dateText, metaX, midY - 10);
  if (playText) ctx.fillText(playText, metaX, midY + 8);

  ctx.restore();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderSongScoreGraphic({ account, song, score, difficulty }) {
  await registerFonts();

  const diff      = String(difficulty || score?.difficulty || 'master').toLowerCase();
  const jacketPath = resolveJacketPath(song);
  const jacketImg  = (await loadCached(jacketPath)) || (await loadCached(join(SCORE_ASSET, 'default_cover.png')));

  const canvas = new Canvas(W, H);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, jacketImg);
  await drawHeader(ctx, account);
  await drawJacketArea(ctx, jacketImg, song, score);
  await drawSongInfo(ctx, song, score);
  await drawScoreStrip(ctx, score, diff);

  // Separator between jacket and song info areas
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(JACKET_SIZE, HEADER_H);
  ctx.lineTo(JACKET_SIZE, HEADER_H + JACKET_SIZE);
  ctx.stroke();
  ctx.restore();

  const buffer = await canvas.toBuffer('png');
  const songSlug = sanitizeFileName(song?.title || score?.title || 'song');
  return { buffer, fileName: `${songSlug}-${diff}-score.png` };
}
