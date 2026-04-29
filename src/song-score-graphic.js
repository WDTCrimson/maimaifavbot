import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';
import { drawMaiDeckWatermark } from './graphic-watermark.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const TOMOMAI     = join(process.cwd(), 'data', 'assets', 'tomomai', 'res');
const SCORE_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'score');
const RANK_ASSET  = join(process.cwd(), 'data', 'assets', 'dxrating', 'rank');
const VER_ASSET   = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'version');
const CAT_ASSET   = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'category');
const DANI_ASSET  = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'dani');

// ─── Layout ───────────────────────────────────────────────────────────────────

const W          = 820;
const MARGIN     = 16;
const IW         = W - MARGIN * 2;    // 788
const PLAYER_H   = 156;
const SONG_H     = 290;
const ROW_H      = 182;
const ROW_HDR_H  = 54;
const GAP        = 14;

const FONT      = 'Inter, Murecho, "Noto Sans JP", sans-serif';
const FONT_MONO = '"Geist Mono", monospace';

// ─── Difficulty palette ───────────────────────────────────────────────────────

const DIFF_COLOR = { basic:'#22c55e', advanced:'#f97316', expert:'#ef4444', master:'#a855f7', remaster:'#e879f9', utage:'#f59e0b' };
const DIFF_DARK  = { basic:'#15803d', advanced:'#c2410c', expert:'#b91c1c', master:'#7e22ce', remaster:'#a21caf', utage:'#b45309' };
const DIFF_NAME  = { basic:'BASIC',   advanced:'ADVANCED', expert:'EXPERT', master:'MASTER', remaster:'Re:MASTER', utage:'U·TA·GE' };

// ─── Cache / fonts ────────────────────────────────────────────────────────────

const IMG_CACHE        = new Map();
const IMG_BOUNDS_CACHE = new WeakMap();
const REGISTERED_FONTS = new Set();

async function fileExists(p) { try { await stat(p); return true; } catch { return false; } }

async function loadCached(path) {
  if (!path) return null;
  if (IMG_CACHE.has(path)) return IMG_CACHE.get(path);
  const p = (async () => {
    try {
      if (/^https?:\/\//.test(path)) return await loadImage(path);
      if (!(await fileExists(path))) return null;
      return await loadImage(path);
    } catch { return null; }
  })();
  IMG_CACHE.set(path, p);
  return p;
}

function getVisibleImageBounds(image) {
  if (!image) return null;
  if (IMG_BOUNDS_CACHE.has(image)) return IMG_BOUNDS_CACHE.get(image);

  const canvas = new Canvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const alpha = pixels[(y * image.width + x) * 4 + 3];
      if (alpha <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const bounds = maxX >= minX && maxY >= minY
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { x: 0, y: 0, width: image.width, height: image.height };
  IMG_BOUNDS_CACHE.set(image, bounds);
  return bounds;
}

async function registerFonts() {
  if (REGISTERED_FONTS.size) return;
  const fontDir = join(TOMOMAI, 'fonts');
  for (const [family, file] of [
    ['Inter',       'Inter-VariableFont_opsz,wght.woff2'],
    ['Murecho',     'Murecho-VariableFont_wght.woff2'],
    ['Noto Sans JP','NotoSansJP-VariableFont_wght.woff2'],
    ['Geist Mono',  'GeistMono-VariableFont_wght.woff2'],
  ]) {
    const path = join(fontDir, file);
    if (await fileExists(path)) { FontLibrary.use(family, [path]); REGISTERED_FONTS.add(family); }
  }
}

// ─── Asset helpers ────────────────────────────────────────────────────────────

// Tomomai rating variant (matches getRatingImageUrl in rating-calculator.ts)
function ratingVariant(rating, gameVersion = 13) {
  const r = Number(rating) || 0, v = Number(gameVersion) || 0;
  if (r >= 16000 && v >= 13) return 'kiwami';
  if (r >= 15000) return 'rainbow';
  if (r >= 14500) return 'platinum';
  if (r >= 14000) return 'gold';
  if (r >= 13000) return 'silver';
  if (r >= 12000) return 'bronze';
  if (r >= 10000) return 'purple';
  if (r >= 7000)  return 'red';
  if (r >= 4000)  return 'orange';
  if (r >= 2000)  return 'green';
  if (r >= 1)     return 'blue';
  return 'normal';
}

// 7-tier DX star system (from calculateDXStars in score-details.ts)
function calculateDXStars(dxScore, maxDxScore) {
  if (!maxDxScore || !dxScore) return 0;
  const pct = dxScore / maxDxScore;
  if (dxScore >= maxDxScore) return 7;
  if (pct >= 0.99) return 6;
  if (pct >= 0.97) return 5;
  if (pct >= 0.95) return 4;
  if (pct >= 0.93) return 3;
  if (pct >= 0.90) return 2;
  if (pct >= 0.85) return 1;
  return 0;
}

// Star image file: 3=rainbow(5-7), 2=gold(3-4), 1=silver(1-2)
function starImageFile(n) { return n >= 5 ? 'star_3.png' : n >= 3 ? 'star_2.png' : 'star_1.png'; }

function getRankIconFile(achievement) {
  const a = Number(achievement) || 0;
  if (a >= 1005000) return 'sssp.png';
  if (a >= 1000000) return 'sss.png';
  if (a >= 995000)  return 'ssp.png';
  if (a >= 990000)  return 'ss.png';
  if (a >= 980000)  return 'sp.png';
  if (a >= 970000)  return 's.png';
  if (a >= 940000)  return 'aaa.png';
  if (a >= 900000)  return 'aa.png';
  if (a >= 800000)  return 'a.png';
  if (a >= 750000)  return 'bbb.png';
  if (a >= 700000)  return 'bb.png';
  if (a >= 600000)  return 'b.png';
  if (a >= 500000)  return 'c.png';
  return 'd.png';
}

function rankIconPath(achievement) {
  return join(RANK_ASSET, 'prism-plus', getRankIconFile(achievement));
}

// Badge file for FC (from badge/13/ directory)
function fcBadgeFile(fc) {
  return { 'fc': 'fc.png', 'fc+': 'fc+.png', 'ap': 'ap.png', 'ap+': 'ap+.png' }
    [String(fc || '').toLowerCase()] ?? 'none.png';
}

// Badge file for FS (sync = fs in badge naming)
function fsBadgeFile(fs) {
  return { 'sync': 'sync.png', 'fs': 'sync.png', 'fs+': 'fs+.png', 'fdx': 'fdx.png', 'fdx+': 'fdx+.png' }
    [String(fs || '').toLowerCase()] ?? 'none.png';
}

function versionNameToFile(version) {
  if (!version) return null;
  const raw = String(version).normalize('NFKC').toLowerCase().trim();
  const exactAlias = {
    'maimaiでらっくす': 'maimai_deluxe',
    'maimaiでらっくす plus': 'maimai_deluxe_plus',
    'maimai dx': 'maimai_deluxe',
    'maimai dx plus': 'maimai_deluxe_plus'
  };
  if (exactAlias[raw]) return `${exactAlias[raw]}.png`;

  const n = raw
    .replace(/maimaiでらっくす/g, 'maimai_deluxe')
    .replace(/でらっくす/g, 'deluxe')
    .replace(/\s+/g, '_').replace(/[^\w]/g, '_')
    .replace(/_+/g, '_').replace(/^_|_$/g, '');
  const alias = { maimai_dx: 'maimai_deluxe', maimai_dx_plus: 'maimai_deluxe_plus' };
  return `${alias[n] ?? n}.png`;
}

function categoryAssetFile(category) {
  const text = String(category || '').normalize('NFKC').toLowerCase().trim();
  if (!text) return null;

  if (text === 'maimai' || text.includes('original')) return 'category_original.png';
  if (text.includes('pops') || text.includes('anime') || text.includes('アニメ')) return 'category_popsanime.png';
  if (text.includes('niconico') || text.includes('vocaloid') || text.includes('ボーカロイド')) return 'category_niconico.png';
  if (text.includes('touhou') || text.includes('東方')) return 'category_touhou.png';
  if (text.includes('chunithm') || text.includes('ongeki') || text.includes('オンゲキ')) return 'category_chugeki.png';
  if (text.includes('variety') || text.includes('バラエティ') || text.includes('ゲーム')) return 'category_variety.png';

  return null;
}

function formatAchievement(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?.????%';
  return `${(n / 10000).toFixed(4)}%`;
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return null; }
}

function trimToWidth(ctx, text, maxW) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
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

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// ─── Background ───────────────────────────────────────────────────────────────

async function drawBackground(ctx, gameVersion, totalH) {
  const v = Math.min(Math.max(Math.floor(Number(gameVersion) || 13), 10), 13);
  const bgImg = await loadCached(join(TOMOMAI, 'bg', `${v}.png`));

  if (bgImg) {
    // Scale bg to cover full card width, crop top
    const scale = W / bgImg.width;
    ctx.drawImage(bgImg, 0, 0, bgImg.width, Math.ceil(totalH / scale), 0, 0, W, totalH);
  } else {
    ctx.fillStyle = '#180826';
    ctx.fillRect(0, 0, W, totalH);
  }
  // Darken for readability
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, 0, W, totalH);
}

// ─── Player header ────────────────────────────────────────────────────────────

async function drawPlayerHeader(ctx, account) {
  const name      = account?.player?.name || 'Player';
  const title     = account?.extra?.title || '';
  const rating    = Number(account?.metrics?.rating) || 0;
  const gameVer   = Number(account?.gameVersion) || 13;
  const courseRankIndex = account?.extra?.courseRankIndex ?? null;
  const courseRankUrl   = account?.extra?.courseRankUrl ?? null;
  const classRankUrl    = account?.extra?.classRankUrl ?? null;
  const iconUrl   = account?.extra?.iconUrl || account?.player?.iconUrl || null;

  // Semi-transparent header strip
  ctx.fillStyle = 'rgba(0,0,0,0.50)';
  ctx.fillRect(0, 0, W, PLAYER_H);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, PLAYER_H - 1, W, 1);

  // ── Avatar ────────────────────────────────────────────────────────────────
  const AV = 80, ax = 18, ay = (PLAYER_H - AV) / 2;
  const avatar = iconUrl ? await loadCached(iconUrl) : null;
  ctx.save();
  rr(ctx, ax, ay, AV, AV, 8); ctx.clip();
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(ax, ay, AV, AV);
  if (avatar) ctx.drawImage(avatar, ax, ay, AV, AV);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
  rr(ctx, ax, ay, AV, AV, 8); ctx.stroke();
  ctx.restore();

  // ── Title pill + name ─────────────────────────────────────────────────────
  const tx = ax + AV + 14;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;

  if (title) {
    ctx.font = `500 13px ${FONT}`; ctx.textBaseline = 'alphabetic';
    const tw   = ctx.measureText(title).width;
    const pH   = 22, pY = PLAYER_H / 2 - 46;
    ctx.fillStyle = 'rgba(255,220,80,0.18)'; ctx.shadowBlur = 0;
    rr(ctx, tx, pY, tw + 20, pH, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,80,0.38)'; ctx.lineWidth = 1;
    rr(ctx, tx, pY, tw + 20, pH, 3); ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,100,0.9)'; ctx.shadowBlur = 5;
    ctx.fillText(title, tx + 10, pY + pH - 5);
  }

  ctx.font = `700 28px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, tx, PLAYER_H / 2 + 12);

  const totalPlays = account?.metrics?.playCount;
  if (totalPlays != null) {
    ctx.font = `500 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`${Number(totalPlays).toLocaleString()} plays`, tx, PLAYER_H / 2 + 32);
  }
  ctx.restore();

  // ── Right side: class rank + dani badge + tomomai rating frame ────────────
  let rx = W - 14;

  // Class rank (Otomodachi)
  if (classRankUrl) {
    const ci = await loadCached(classRankUrl);
    if (ci) {
      const ch = 42, cw = ci.width * (ch / ci.height);
      rx -= cw;
      ctx.drawImage(ci, rx, (PLAYER_H - ch) / 2, cw, ch);
      rx -= 10;
    }
  }

  // Dan badge
  const daniSrc = courseRankIndex != null
    ? join(DANI_ASSET, `dani_${String(courseRankIndex).padStart(2, '0')}.png`)
    : courseRankUrl;
  if (daniSrc) {
    const di = await loadCached(daniSrc);
    if (di) {
      const dh = 42, dw = di.width * (dh / di.height);
      rx -= dw;
      ctx.drawImage(di, rx, (PLAYER_H - dh) / 2, dw, dh);
      rx -= 10;
    }
  }

  // Tomomai rating frame (296×86 → scale 0.72 → ~213×62)
  const frameImg = await loadCached(join(TOMOMAI, 'rating', `${ratingVariant(rating, gameVer)}.png`));
  const FRAME_SCALE = 0.72;
  if (frameImg) {
    const fw = frameImg.width  * FRAME_SCALE;   // ≈ 213
    const fh = frameImg.height * FRAME_SCALE;   // ≈ 62
    rx -= fw;
    const fy = (PLAYER_H - fh) / 2;
    ctx.drawImage(frameImg, rx, fy, fw, fh);

    // Rating digits — same positioning logic as tomomai's renderHeader
    const ratingStr = String(rating);
    ctx.save();
    ctx.font = `600 ${Math.round(fh * 0.53)}px ${FONT_MONO}`;
    ctx.fillStyle = '#f9f0f4';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
    let dx = rx + fw * 0.43;
    const dy = fy + fh * 0.19 + fh * 0.53;
    for (const ch of ratingStr) {
      ctx.fillText(ch, dx, dy);
      dx += 23 * FRAME_SCALE / 0.75;  // proportional to tomomai's 23px at scale 0.75
    }
    ctx.restore();
  } else {
    // Fallback pill
    ctx.save();
    ctx.font = `700 17px ${FONT}`; ctx.textBaseline = 'middle';
    const rstr = String(rating), pw = ctx.measureText(rstr).width + 22;
    rx -= pw;
    ctx.fillStyle = rating >= 15000 ? '#f0c040' : '#4ade80';
    rr(ctx, rx, (PLAYER_H - 30) / 2, pw, 30, 6); ctx.fill();
    ctx.fillStyle = '#000'; ctx.fillText(rstr, rx + pw / 2 - ctx.measureText(rstr).width / 2, PLAYER_H / 2);
    ctx.restore();
  }
}

// ─── Song info section ────────────────────────────────────────────────────────

async function drawSongInfo(ctx, song, scores, y) {
  const JACKET_SZ = 252;
  const jx = MARGIN, jy = y;

  // Jacket
  const jacketImg = await loadCached(resolveJacketPath(song));
  const src = jacketImg || await loadCached(join(SCORE_ASSET, 'default_cover.png'));
  if (src) {
    ctx.save(); rr(ctx, jx, jy, JACKET_SZ, JACKET_SZ, 10); ctx.clip();
    const s = Math.min(src.width, src.height);
    ctx.drawImage(src, (src.width-s)/2, (src.height-s)/2, s, s, jx, jy, JACKET_SZ, JACKET_SZ);
    ctx.restore();
  }
  ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=2; rr(ctx,jx,jy,JACKET_SZ,JACKET_SZ,10); ctx.stroke(); ctx.restore();

  // Version logo on jacket
  const version = song?.difficultyLevels?.[0]?.version ?? scores?.[0]?.version ?? null;
  const verFile = versionNameToFile(version);
  if (verFile) {
    const vi = await loadCached(join(VER_ASSET, verFile));
    if (vi) {
      const s2 = Math.min((JACKET_SZ * 0.58) / vi.width, 30 / vi.height);
      ctx.save(); ctx.shadowColor='rgba(0,0,0,0.95)'; ctx.shadowBlur=8;
      ctx.drawImage(vi, jx+8, jy+JACKET_SZ-vi.height*s2-8, vi.width*s2, vi.height*s2);
      ctx.restore();
    }
  }

  // Right panel
  const infoX = jx + JACKET_SZ + 20, infoW = W - infoX - MARGIN;
  let cy = jy + 6;
  ctx.save(); ctx.shadowColor='rgba(0,0,0,0.85)'; ctx.shadowBlur=5;

  // DX/STD type badge
  const typeFile = String(scores?.[0]?.type || '').toLowerCase() === 'dx' ? 'type_dx.png' : 'type_sd.png';
  const ti = await loadCached(join(SCORE_ASSET, typeFile));
  if (ti) {
    const ts = 1.4;
    ctx.drawImage(ti, infoX, cy, ti.width*ts, ti.height*ts);
    cy += ti.height*ts + 12;
  } else { cy += 12; }

  // Song title (up to 2 lines)
  const titleStr = song?.title || 'Unknown Song';
  ctx.font = `700 28px ${FONT}`; ctx.fillStyle='#ffffff'; ctx.textBaseline='top';
  if (ctx.measureText(titleStr).width <= infoW) {
    ctx.fillText(titleStr, infoX, cy); cy += 36;
  } else {
    let l1 = '';
    for (let i = 1; i <= titleStr.length; i++) {
      if (ctx.measureText(titleStr.slice(0,i)+'…').width > infoW) break;
      l1 = titleStr.slice(0,i);
    }
    ctx.fillText(l1, infoX, cy); cy += 33;
    ctx.font=`700 22px ${FONT}`;
    ctx.fillText(trimToWidth(ctx, titleStr.slice(l1.length), infoW), infoX, cy); cy += 30;
  }

  // Artist
  ctx.font=`400 16px ${FONT}`; ctx.fillStyle='rgba(255,255,255,0.65)';
  ctx.fillText(trimToWidth(ctx, song?.artist||'', infoW), infoX, cy); cy += 26;

  // BPM
  if (song?.bpm) {
    ctx.font=`500 14px ${FONT}`; ctx.fillStyle='rgba(255,255,255,0.45)';
    ctx.fillText(`BPM  ${song.bpm}`, infoX, cy); cy += 22;
  }

  // Category badge
  const category = song?.category || song?.genre;
  const categoryFile = categoryAssetFile(category);
  const categoryImg = categoryFile ? await loadCached(join(CAT_ASSET, categoryFile)) : null;
  if (categoryImg) {
    const bounds = getVisibleImageBounds(categoryImg);
    const badgeW = Math.min(85, infoW);
    const badgeH = bounds.height * (badgeW / bounds.width);
    ctx.shadowBlur = 6;
    ctx.drawImage(
      categoryImg,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      infoX,
      cy - 2,
      badgeW,
      badgeH
    );
  } else if (category) {
    ctx.font=`500 13px ${FONT}`;
    const gw = ctx.measureText(category).width + 18;
    ctx.fillStyle='rgba(255,255,255,0.10)'; ctx.shadowBlur=0;
    rr(ctx, infoX, cy, gw, 22, 4); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.textBaseline='middle';
    ctx.fillText(category, infoX+9, cy+11);
  }

  ctx.restore();
}

// ─── Single difficulty row ────────────────────────────────────────────────────

async function drawDiffRow(ctx, score, y, badgeVersion) {
  const rx = MARGIN, rw = IW;
  const diff  = String(score.difficulty || 'master').toLowerCase();
  const color = DIFF_COLOR[diff]  || '#888';
  const dark  = DIFF_DARK[diff]   || '#444';
  const name  = DIFF_NAME[diff]   || diff.toUpperCase();
  const bv    = String(badgeVersion || 13);

  // Container
  ctx.save(); ctx.fillStyle='#1a1528'; rr(ctx, rx, y, rw, ROW_H, 10); ctx.fill(); ctx.restore();

  // ── Colored header band ───────────────────────────────────────────────────
  ctx.save(); rr(ctx, rx, y, rw, ROW_H, 10); ctx.clip();
  const hg = ctx.createLinearGradient(rx, y, rx, y+ROW_HDR_H);
  hg.addColorStop(0, color); hg.addColorStop(1, dark);
  ctx.fillStyle = hg; ctx.fillRect(rx, y, rw, ROW_HDR_H);
  // Bottom shadow
  const sg = ctx.createLinearGradient(rx, y+ROW_HDR_H-8, rx, y+ROW_HDR_H);
  sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = sg; ctx.fillRect(rx, y, rw, ROW_HDR_H);
  ctx.restore();
  ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.fillRect(rx, y+ROW_HDR_H, rw, 1);

  // Difficulty name
  ctx.save(); ctx.font=`800 22px ${FONT}`; ctx.fillStyle='#ffffff'; ctx.textBaseline='middle';
  ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=4;
  ctx.fillText(name, rx+16, y+ROW_HDR_H/2); ctx.restore();

  // Play count + date (header right, play count rightmost)
  const dateStr  = formatDate(score?.playedAtIso ?? score?.playedAt ?? null);
  const countStr = score?.playCount != null ? `${Number(score.playCount).toLocaleString()} plays` : null;
  if (dateStr || countStr) {
    ctx.save(); ctx.textBaseline='middle'; ctx.shadowColor='rgba(0,0,0,0.7)'; ctx.shadowBlur=3;
    let curX = rx + rw - 14;

    if (countStr) {
      ctx.font=`600 14px ${FONT}`; ctx.fillStyle='#ffffff';
      const cw = ctx.measureText(countStr).width;
      curX -= cw;
      ctx.fillText(countStr, curX, y + ROW_HDR_H/2 + 5);
      ctx.font=`400 11px ${FONT}`; ctx.fillStyle='rgba(255,255,255,0.6)';
      ctx.fillText('Plays', curX, y + ROW_HDR_H/2 - 7);
      curX -= 20;
    }

    if (dateStr) {
      ctx.font=`600 13px ${FONT}`; ctx.fillStyle='rgba(255,255,255,0.85)';
      const dw = ctx.measureText(dateStr).width;
      curX -= dw;
      ctx.fillText(dateStr, curX, y + ROW_HDR_H/2 + 5);
      ctx.font=`400 11px ${FONT}`; ctx.fillStyle='rgba(255,255,255,0.6)';
      ctx.fillText('Last Played', curX, y + ROW_HDR_H/2 - 7);
    }
    ctx.restore();
  }

  // ── Body ─────────────────────────────────────────────────────────────────
  const by   = y + ROW_HDR_H + 1;
  const bh   = ROW_H - ROW_HDR_H - 1;
  const midY = by + bh / 2;

  // Level box
  const levelStr = score?.internalLevelValue != null
    ? Number(score.internalLevelValue).toFixed(1)
    : score?.level ?? '?';
  ctx.save();
  ctx.font=`700 22px ${FONT}`; ctx.textBaseline='middle';
  const lvW  = ctx.measureText(levelStr).width;
  const boxW = lvW + 22, boxH = 44, boxX = rx+14, boxY = midY - boxH/2;
  ctx.fillStyle='rgba(0,0,0,0.5)'; rr(ctx,boxX,boxY,boxW,boxH,6); ctx.fill();
  ctx.strokeStyle=color; ctx.lineWidth=2; rr(ctx,boxX,boxY,boxW,boxH,6); ctx.stroke();
  ctx.fillStyle='#ffffff'; ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=4;
  ctx.fillText(levelStr, boxX+11, midY); ctx.restore();

  // Rank icon (dxrating/rank/*.png, 120×48)
  let iconX = boxX + boxW + 12;
  const rankImg = await loadCached(rankIconPath(score?.achievement));
  if (rankImg) {
    const rh = 54, rw2 = rankImg.width * (rh / rankImg.height);
    ctx.drawImage(rankImg, iconX, midY - rh/2, rw2, rh);
    iconX += rw2 + 10;
  }

  // FC badge (tomomai badge/13/*.png, 42×47)
  const fcBadge = await loadCached(join(TOMOMAI, 'badge', bv, fcBadgeFile(score?.fc)));
  if (fcBadge) {
    const bh2 = 44, bw2 = fcBadge.width * (bh2 / fcBadge.height);
    ctx.drawImage(fcBadge, iconX, midY - bh2/2, bw2, bh2);
    iconX += bw2 + 4;
  }

  // FS badge
  const fsBadge = await loadCached(join(TOMOMAI, 'badge', bv, fsBadgeFile(score?.fs)));
  if (fsBadge) {
    const bh2 = 44, bw2 = fsBadge.width * (bh2 / fsBadge.height);
    ctx.drawImage(fsBadge, iconX, midY - bh2/2, bw2, bh2);
  }

  // ── Right: achievement, rating, DX score, stars ───────────────────────────
  ctx.save(); ctx.shadowColor='rgba(0,0,0,0.9)'; ctx.shadowBlur=5;

  // Achievement %
  const achStr = formatAchievement(score?.achievement);
  ctx.font=`800 30px ${FONT}`; ctx.fillStyle='#ffffff'; ctx.textBaseline='alphabetic';
  const achW = ctx.measureText(achStr).width;
  ctx.fillText(achStr, rx+rw-achW-16, by+38);

  // >> Rating
  if (score?.rating != null) {
    const rtStr = `>> ${score.rating}`;
    ctx.font=`600 15px ${FONT}`; ctx.fillStyle=color; ctx.textBaseline='alphabetic';
    const rtW = ctx.measureText(rtStr).width;
    ctx.fillText(rtStr, rx+rw-rtW-16, by+bh-12);
  }

  // DX Score line: "DX Score  N / M  >> P%"
  if (score?.dxScore != null && score?.maxDxScore != null) {
    const pct   = score.maxDxScore > 0 ? ((score.dxScore / score.maxDxScore) * 100).toFixed(1) : '?';
    const dxStr = `DX Score  ${score.dxScore.toLocaleString()} / ${score.maxDxScore.toLocaleString()}`;
    const arStr = `  >>  ${pct}%`;

    ctx.font=`500 13px ${FONT}`; ctx.textBaseline='alphabetic';

    // Prefix in muted white
    ctx.fillStyle='rgba(255,255,255,0.65)';
    const dxW = ctx.measureText(dxStr).width;
    const arW = ctx.measureText(arStr).width;
    const totalDxW = dxW + arW;
    ctx.fillText(dxStr, rx+rw-totalDxW-16, by+58);
    // Arrow + percentage in difficulty color
    ctx.fillStyle = color;
    ctx.fillText(arStr, rx+rw-arW-16, by+58);

    // DX stars (star_1/2/3.png, 28×28 each)
    const stars = calculateDXStars(score.dxScore, score.maxDxScore);
    if (stars > 0) {
      const starImg = await loadCached(join(TOMOMAI, 'songs', starImageFile(stars)));
      if (starImg) {
        const STAR_SIZE = 18, STAR_GAP = 3;
        const totalStarW = stars * STAR_SIZE + (stars-1) * STAR_GAP;
        const pillPad = 6, pillH = STAR_SIZE + pillPad*2;
        const pillW = totalStarW + pillPad*2;
        const pillX = rx + rw - pillW - 16;
        const pillY = by + 64;

        // White pill background (like tomomai)
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.shadowBlur = 6; ctx.shadowColor = 'rgba(0,0,0,0.15)';
        rr(ctx, pillX, pillY, pillW, pillH, pillH/2); ctx.fill(); ctx.restore();

        // Draw each star
        for (let i = 0; i < stars; i++) {
          const sx = pillX + pillPad + i * (STAR_SIZE + STAR_GAP);
          const sy = pillY + pillPad;
          ctx.drawImage(starImg, sx, sy, STAR_SIZE, STAR_SIZE);
        }
      }
    }
  }

  ctx.restore();

  // Row border
  ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1;
  rr(ctx, rx, y, rw, ROW_H, 10); ctx.stroke(); ctx.restore();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderSongScoreGraphic({ account, song, scores }) {
  await registerFonts();

  if (!Array.isArray(scores) || scores.length === 0) {
    throw new Error('No score data to render.');
  }

  const gameVersion = Number(account?.gameVersion) || 13;
  const badgeVer    = Math.min(Math.max(Math.floor(gameVersion), 10), 13);

  const n      = scores.length;
  const totalH = PLAYER_H + GAP + SONG_H + GAP + n * ROW_H + (n - 1) * GAP + GAP;

  const canvas = new Canvas(W, totalH);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, gameVersion, totalH);
  await drawPlayerHeader(ctx, account);
  await drawSongInfo(ctx, song, scores, PLAYER_H + GAP);

  let rowY = PLAYER_H + GAP + SONG_H + GAP;
  for (const score of scores) {
    await drawDiffRow(ctx, score, rowY, badgeVer);
    rowY += ROW_H + GAP;
  }

  drawMaiDeckWatermark(ctx, { width: W, height: totalH, fontFamily: FONT });

  const buffer = await canvas.toBuffer('png');
  const slug   = sanitizeFileName(song?.title || scores[0]?.title || 'song');
  return { buffer, fileName: `${slug}-score.png` };
}
