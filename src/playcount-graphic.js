import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

// ─── Paths ────────────────────────────────────────────────────────────────────

const TOMOMAI     = join(process.cwd(), 'data', 'assets', 'tomomai', 'res');
const SCORE_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'score');
const RANK_ASSET  = join(process.cwd(), 'data', 'assets', 'dxrating', 'rank');
const DANI_ASSET  = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'dani');

// ─── Layout ───────────────────────────────────────────────────────────────────

const W          = 820;
const MARGIN     = 16;
const IW         = W - MARGIN * 2;
const PLAYER_H   = 156;
const GAP        = 10;
const ROW_H      = 104;
const JACKET_SZ  = ROW_H - 8;  // 96px, with 4px vertical padding each side

const FONT      = 'Inter, Murecho, "Noto Sans JP", sans-serif';
const FONT_MONO = '"Geist Mono", monospace';

// ─── Difficulty palette ───────────────────────────────────────────────────────

const DIFF_COLOR = { basic:'#22c55e', advanced:'#f97316', expert:'#ef4444', master:'#a855f7', remaster:'#e879f9', utage:'#f59e0b' };
const DIFF_DARK  = { basic:'#15803d', advanced:'#c2410c', expert:'#b91c1c', master:'#7e22ce', remaster:'#a21caf', utage:'#b45309' };
const DIFF_NAME  = { basic:'BASIC',   advanced:'ADVANCED', expert:'EXPERT', master:'MASTER', remaster:'Re:MASTER', utage:'U·TA·GE' };

// ─── Cache / fonts ────────────────────────────────────────────────────────────

const IMG_CACHE        = new Map();
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

function fcBadgeFile(fc) {
  return { 'fc': 'fc.png', 'fc+': 'fc+.png', 'ap': 'ap.png', 'ap+': 'ap+.png' }
    [String(fc || '').toLowerCase()] ?? 'none.png';
}

function formatAchievement(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?.????%';
  return `${(n / 10000).toFixed(4)}%`;
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

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// ─── Background ───────────────────────────────────────────────────────────────

async function drawBackground(ctx, gameVersion, totalH) {
  const v = Math.min(Math.max(Math.floor(Number(gameVersion) || 13), 10), 13);
  const bgImg = await loadCached(join(TOMOMAI, 'bg', `${v}.png`));
  if (bgImg) {
    const scale = W / bgImg.width;
    ctx.drawImage(bgImg, 0, 0, bgImg.width, Math.ceil(totalH / scale), 0, 0, W, totalH);
  } else {
    ctx.fillStyle = '#180826';
    ctx.fillRect(0, 0, W, totalH);
  }
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
  const iconUrl   = account?.extra?.iconUrl || account?.player?.iconUrl || null;

  ctx.fillStyle = 'rgba(0,0,0,0.50)';
  ctx.fillRect(0, 0, W, PLAYER_H);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, PLAYER_H - 1, W, 1);

  // Avatar
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

  // Title + name
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

  // Right side: dani + rating frame
  let rx = W - 14;

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

  const frameImg = await loadCached(join(TOMOMAI, 'rating', `${ratingVariant(rating, gameVer)}.png`));
  const FRAME_SCALE = 0.72;
  if (frameImg) {
    const fw = frameImg.width  * FRAME_SCALE;
    const fh = frameImg.height * FRAME_SCALE;
    rx -= fw;
    const fy = (PLAYER_H - fh) / 2;
    ctx.drawImage(frameImg, rx, fy, fw, fh);

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
      dx += 23 * FRAME_SCALE / 0.75;
    }
    ctx.restore();
  } else {
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

// ─── Section header ───────────────────────────────────────────────────────────

function drawSectionHeader(ctx, y, count) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, y, W, 36);

  ctx.font = `700 14px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.textBaseline = 'middle';
  ctx.fillText(`TOP ${count} BY PLAY COUNT`, MARGIN, y + 18);
  ctx.restore();
}

// ─── Single play-count row ────────────────────────────────────────────────────
//
// Horizontal zones (left → right):
//   MARGIN(16) | stripe(6) | rank#(32) | gap(4) | jacket(96) | gap(10)
//   | MIDDLE | gap(8) | SCORE(130) | divider(1) | PLAYCOUNT(96) | MARGIN(16)
//
// SCORE zone holds rank icon (top-half) + FC badge (top-half) + achievement (bottom-half)
// PLAYCOUNT zone holds the large number + "PLAYS" label

const RANK_NUM_W = 32;
const SCORE_W    = 130;
const PC_W       = 96;

const JACKET_X   = MARGIN + 6 + RANK_NUM_W + 4;       // 58
const MID_X      = JACKET_X + JACKET_SZ + 10;          // 164
const PC_RIGHT   = W - MARGIN;                          // 804 (right edge of play count zone)
const PC_LEFT    = PC_RIGHT - PC_W;                     // 708
const SCORE_RIGHT = PC_LEFT - 1;                        // 707 (divider at 708)
const SCORE_LEFT  = SCORE_RIGHT - SCORE_W;              // 577
const MID_W      = SCORE_LEFT - 8 - MID_X;             // ~405px

async function drawPlayCountRow(ctx, entry, rank, y, badgeVersion) {
  const { score, song } = entry;
  const diff  = String(score.difficulty || 'master').toLowerCase();
  const color = DIFF_COLOR[diff] || '#888';
  const dark  = DIFF_DARK[diff]  || '#444';
  const name  = DIFF_NAME[diff]  || diff.toUpperCase();
  const bv    = String(badgeVersion || 13);
  const midCY = y + ROW_H / 2;

  // ── Row background
  ctx.save();
  ctx.fillStyle = 'rgba(20,14,36,0.88)';
  rr(ctx, MARGIN, y, IW, ROW_H, 10); ctx.fill();
  ctx.restore();

  // ── Left accent stripe
  ctx.save();
  rr(ctx, MARGIN, y, IW, ROW_H, 10); ctx.clip();
  const lg = ctx.createLinearGradient(MARGIN, y, MARGIN + 6, y);
  lg.addColorStop(0, color); lg.addColorStop(1, dark);
  ctx.fillStyle = lg;
  ctx.fillRect(MARGIN, y, 6, ROW_H);
  ctx.restore();

  // ── Rank number
  ctx.save();
  ctx.font = `800 15px ${FONT_MONO}`;
  ctx.fillStyle = rank === 1 ? '#ffd700' : rank <= 3 ? '#c0c0c0' : 'rgba(255,255,255,0.35)';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(`#${rank}`, MARGIN + 6 + RANK_NUM_W / 2, midCY);
  ctx.restore();

  // ── Jacket
  const jacketY = y + (ROW_H - JACKET_SZ) / 2;
  const jacketImg = await loadCached(resolveJacketPath(song));
  const fallback  = await loadCached(join(SCORE_ASSET, 'default_cover.png'));
  const src = jacketImg || fallback;
  if (src) {
    ctx.save();
    rr(ctx, JACKET_X, jacketY, JACKET_SZ, JACKET_SZ, 6); ctx.clip();
    const s = Math.min(src.width, src.height);
    ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, JACKET_X, jacketY, JACKET_SZ, JACKET_SZ);
    ctx.restore();
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
  rr(ctx, JACKET_X, jacketY, JACKET_SZ, JACKET_SZ, 6); ctx.stroke();
  ctx.restore();

  // ── Middle: title, artist, diff badge
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 4;

  const title = score.title || song?.title || 'Unknown';
  ctx.font = `600 16px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(trimToWidth(ctx, title, MID_W), MID_X, midCY - 6);

  const artist = song?.artist || score.artist || '';
  ctx.font = `400 12px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(trimToWidth(ctx, artist, MID_W), MID_X, midCY + 10);

  const levelStr = score.internalLevelValue != null
    ? Number(score.internalLevelValue).toFixed(1)
    : score.level ?? '?';
  const badgeText = `${name}  ${levelStr}`;
  ctx.font = `700 10px ${FONT}`;
  const bdgW = ctx.measureText(badgeText).width + 12;
  const bdgH = 16, bdgY = midCY + 18;
  ctx.fillStyle = color; ctx.shadowBlur = 0;
  rr(ctx, MID_X, bdgY, bdgW, bdgH, 3); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, MID_X + 6, bdgY + bdgH / 2);

  ctx.restore();

  // ── Score zone (SCORE_LEFT → SCORE_RIGHT)
  // Top half: rank icon + FC badge, right-aligned
  // Bottom half: achievement text, right-aligned
  const topY  = y + 6;
  const topH  = ROW_H / 2 - 6;
  const botY  = y + ROW_H / 2;
  const botH  = ROW_H / 2 - 6;

  let scoreRX = SCORE_RIGHT; // accumulate right-to-left

  const fcBadge = await loadCached(join(TOMOMAI, 'badge', bv, fcBadgeFile(score.fc)));
  if (fcBadge) {
    const bh2 = 26, bw2 = fcBadge.width * (bh2 / fcBadge.height);
    scoreRX -= bw2;
    ctx.drawImage(fcBadge, scoreRX, topY + (topH - bh2) / 2, bw2, bh2);
    scoreRX -= 4;
  }

  const rankImg = await loadCached(join(RANK_ASSET, 'prism-plus', getRankIconFile(score.achievement)));
  if (rankImg) {
    const rh2 = 30, maxW = 72;
    const rw2 = Math.min(rankImg.width * (rh2 / rankImg.height), maxW);
    scoreRX -= rw2;
    ctx.drawImage(rankImg, scoreRX, topY + (topH - rh2) / 2, rw2, rh2);
  }

  ctx.save();
  ctx.font = `500 12px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
  ctx.fillText(formatAchievement(score.achievement), SCORE_RIGHT, botY + botH / 2);
  ctx.restore();

  // ── Vertical divider between score zone and play count zone
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(PC_LEFT - 1, y + 10, 1, ROW_H - 20);
  ctx.restore();

  // ── Play count zone (PC_LEFT → PC_RIGHT)
  if (score.playCount != null) {
    const pcStr = Number(score.playCount).toLocaleString();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
    ctx.textAlign = 'right';

    // Auto-size so large numbers fit within PC_W
    let fontSize = 22;
    ctx.font = `800 ${fontSize}px ${FONT_MONO}`;
    while (ctx.measureText(pcStr).width > PC_W - 8 && fontSize > 13) {
      fontSize -= 1;
      ctx.font = `800 ${fontSize}px ${FONT_MONO}`;
    }
    ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
    ctx.fillText(pcStr, PC_RIGHT - 4, midCY + 8);

    ctx.font = `500 9px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('PLAYS', PC_RIGHT - 4, midCY - 10);

    ctx.restore();
  }

  // ── Row border
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  rr(ctx, MARGIN, y, IW, ROW_H, 10); ctx.stroke();
  ctx.restore();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderPlayCountGraphic({ account, entries }) {
  await registerFonts();

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('No play-count data to render.');
  }

  const gameVersion = Number(account?.gameVersion) || 13;
  const badgeVer    = Math.min(Math.max(Math.floor(gameVersion), 10), 13);

  const HDR_H   = 36;
  const n       = entries.length;
  const totalH  = PLAYER_H + GAP + HDR_H + GAP + n * ROW_H + (n - 1) * GAP + GAP;

  const canvas = new Canvas(W, totalH);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, gameVersion, totalH);
  await drawPlayerHeader(ctx, account);

  const sectionY = PLAYER_H + GAP;
  drawSectionHeader(ctx, sectionY, n);

  let rowY = sectionY + HDR_H + GAP;
  for (let i = 0; i < n; i++) {
    await drawPlayCountRow(ctx, entries[i], i + 1, rowY, badgeVer);
    rowY += ROW_H + GAP;
  }

  const buffer = await canvas.toBuffer('png');
  const playerSlug = String(account?.player?.name || 'player').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'player';
  return { buffer, fileName: `${playerSlug}-top-plays.png` };
}
