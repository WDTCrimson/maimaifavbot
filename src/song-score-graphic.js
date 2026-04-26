import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

// ─── Dimensions ───────────────────────────────────────────────────────────────
//
// Portrait card: 820px wide, height grows with number of difficulty rows.
//
//  ┌──────────────────────────────────── 820px ────────────────────────────────┐
//  │  PLAYER HEADER (156px)                                                    │
//  │  [avatar]  [title banner]  [name]          [dani]  [rating frame + #]    │
//  ├───────────────────────────────────────────────────────────────────────────┤
//  │  SONG INFO (290px)                                                        │
//  │  [jacket 252px]  │  [type badge]  [title]                                │
//  │                  │  [artist]  [BPM]  [category]                          │
//  │                  │                           [version logo]               │
//  ├───────────────────────────────────────────────────────────────────────────┤
//  │  DIFFICULTY ROW × N (175px each)                                          │
//  │  ╔═══ colored header band ══════════════════════════════════════════════╗ │
//  │  ║  EXPERT                               Last Played: 2025/11/07 22:05 ║ │
//  │  ║                                       Play Count:  10               ║ │
//  │  ╠═══ dark body ════════════════════════════════════════════════════════╣ │
//  │  ║  [12.5] [SSS+] [FC+] [FDX]    100.7757%  >>281                     ║ │
//  │  ║                                DX 1,982/2,130  >>93.1%  ♦♦♦        ║ │
//  │  ╚══════════════════════════════════════════════════════════════════════╝ │
//  └───────────────────────────────────────────────────────────────────────────┘

const W       = 820;
const MARGIN  = 16;
const IW      = W - MARGIN * 2;   // 788 inner width

const PLAYER_H   = 156;
const SONG_H     = 290;
const ROW_H      = 175;
const ROW_HDR_H  = 54;   // colored top band of each row
const GAP        = 14;   // between sections

const SCORE_ASSET   = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'score');
const VERSION_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'version');
const DANI_ASSET    = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'dani');

const FONT = 'Inter, Murecho, "Noto Sans JP", sans-serif';

const DIFF_COLOR = {
  basic:    '#22c55e',
  advanced: '#f97316',
  expert:   '#ef4444',
  master:   '#a855f7',
  remaster: '#e879f9',
  utage:    '#f59e0b',
};

const DIFF_DARK = {
  basic:    '#15803d',
  advanced: '#c2410c',
  expert:   '#b91c1c',
  master:   '#7e22ce',
  remaster: '#a21caf',
  utage:    '#b45309',
};

const DIFF_NAME = {
  basic:    'BASIC',
  advanced: 'ADVANCED',
  expert:   'EXPERT',
  master:   'MASTER',
  remaster: 'Re:MASTER',
  utage:    'U·TA·GE',
};

// ─── Cache ────────────────────────────────────────────────────────────────────

const IMG_CACHE        = new Map();
const REGISTERED_FONTS = new Set();

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

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

// ─── Asset helpers ────────────────────────────────────────────────────────────

function getRatingFrame(rating) {
  const r = Number(rating) || 0;
  if (r >= 15000) return 'rating_base_11.png';
  if (r >= 14500) return 'rating_base_10.png';
  if (r >= 14000) return 'rating_base_09.png';
  if (r >= 13000) return 'rating_base_08.png';
  if (r >= 12000) return 'rating_base_07.png';
  if (r >= 10000) return 'rating_base_06.png';
  if (r >= 7000)  return 'rating_base_05.png';
  if (r >= 4000)  return 'rating_base_04.png';
  if (r >= 2000)  return 'rating_base_03.png';
  if (r >= 1000)  return 'rating_base_02.png';
  return 'rating_base_01.png';
}

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
  return {
    'fc':  'music_icon_fc.png',
    'fc+': 'music_icon_fcp.png',
    'ap':  'music_icon_ap.png',
    'ap+': 'music_icon_app.png',
  }[String(fc || '').toLowerCase()] ?? null;
}

function getFsIconFile(fs) {
  return {
    'sync': 'music_icon_fs.png',
    'fs':   'music_icon_fs.png',
    'fs+':  'music_icon_fsp.png',
    'fdx':  'music_icon_fsd.png',
    'fdx+': 'music_icon_fsdp.png',
  }[String(fs || '').toLowerCase()] ?? null;
}

function getDaniFile(danRank) {
  const n = Number(danRank);
  if (!Number.isFinite(n) || n < 0 || n > 23) return null;
  return `dani_${String(n).padStart(2, '0')}.png`;
}

function versionNameToFile(version) {
  if (!version) return null;
  const n = String(version).toLowerCase()
    .replace(/でらっくす/g, 'maimai_deluxe')
    .replace(/\s+/g, '_').replace(/[^\w]/g, '_')
    .replace(/_+/g, '_').replace(/^_|_$/g, '');
  const alias = { maimai_dx: 'maimai_deluxe', maimai_dx_plus: 'maimai_deluxe_plus' };
  return `${alias[n] ?? n}.png`;
}

function calculateDXStars(dxScore, maxDxScore) {
  if (!maxDxScore || !dxScore) return 0;
  const pct = (dxScore / maxDxScore) * 100;
  if (pct >= 97) return 5;
  if (pct >= 95) return 4;
  if (pct >= 93) return 3;
  if (pct >= 90) return 2;
  if (pct >= 75) return 1;
  return 0;
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
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

// ─── Player header (full width, PLAYER_H px) ─────────────────────────────────

async function drawPlayerHeader(ctx, account, jacketImg) {
  // Background: blurred jacket or gradient
  ctx.save();
  if (jacketImg) {
    ctx.filter = 'blur(60px) brightness(0.28) saturate(1.6)';
    ctx.drawImage(jacketImg, -100, -100, W + 200, PLAYER_H + 200);
    ctx.filter = 'none';
  } else {
    ctx.fillStyle = '#180826'; ctx.fillRect(0, 0, W, PLAYER_H);
  }
  // Dark overlay
  ctx.fillStyle = 'rgba(0,0,0,0.50)'; ctx.fillRect(0, 0, W, PLAYER_H);
  // Bottom edge separator
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(0, PLAYER_H - 1, W, 1);
  ctx.restore();

  const name    = account?.player?.name || 'Player';
  const title   = account?.extra?.title || '';
  const rating  = Number(account?.metrics?.rating) || 0;
  const danRank = account?.metrics?.danRank ?? account?.extra?.danRank ?? null;
  const iconUrl = account?.extra?.iconUrl || account?.player?.iconUrl || null;

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

  // ── Title banner + player name ────────────────────────────────────────────
  const textX = ax + AV + 14;
  const nameY  = PLAYER_H / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;

  // Title (above name in a rounded pill)
  if (title) {
    ctx.font = `500 13px ${FONT}`; ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(title).width;
    const pillW = tw + 20, pillH = 22, pillY = nameY - 42;
    // Draw title background (subtle gold tint)
    ctx.fillStyle = 'rgba(255,220,80,0.18)';
    ctx.shadowBlur = 0;
    rr(ctx, textX, pillY, pillW, pillH, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,80,0.35)'; ctx.lineWidth = 1;
    rr(ctx, textX, pillY, pillW, pillH, 3); ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,100,0.88)'; ctx.shadowBlur = 5;
    ctx.fillText(title, textX + 10, pillY + pillH - 5);
  }

  // Player name
  ctx.font = `700 28px ${FONT}`; ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, textX, nameY + 10);
  ctx.restore();

  // ── Right: dani badge + rating frame ─────────────────────────────────────
  let rx = W - 14;

  const daniFile = getDaniFile(danRank);
  if (daniFile) {
    const di = await loadCached(join(DANI_ASSET, daniFile));
    if (di) {
      const dh = 42, dw = di.width * (dh / di.height);
      rx -= dw;
      ctx.drawImage(di, rx, (PLAYER_H - dh) / 2, dw, dh);
      rx -= 10;
    }
  }

  const frameImg = await loadCached(join(SCORE_ASSET, getRatingFrame(rating)));
  if (frameImg) {
    // Scale frame to height 42
    const fh = 42, fw = frameImg.width * (fh / frameImg.height);
    rx -= fw;
    const fy = (PLAYER_H - fh) / 2;
    ctx.drawImage(frameImg, rx, fy, fw, fh);
    // Rating number on frame
    ctx.save();
    ctx.font = `800 20px ${FONT}`; ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 5;
    const rstr = String(rating), rw = ctx.measureText(rstr).width;
    ctx.fillText(rstr, rx + fw / 2 - rw / 2, fy + fh / 2);
    ctx.restore();
  } else {
    // Fallback
    ctx.save();
    const rstr = String(rating);
    ctx.font = `700 18px ${FONT}`; ctx.textBaseline = 'middle';
    const pillW = ctx.measureText(rstr).width + 24;
    rx -= pillW;
    ctx.fillStyle = rating >= 15000 ? '#f0c040' : rating >= 14000 ? '#c0c0d8' : '#4ade80';
    rr(ctx, rx, (PLAYER_H - 30) / 2, pillW, 30, 6); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillText(rstr, rx + pillW / 2 - ctx.measureText(rstr).width / 2, PLAYER_H / 2);
    ctx.restore();
  }
}

// ─── Song info section ────────────────────────────────────────────────────────

async function drawSongInfo(ctx, song, scores, y) {
  const JACKET_SZ = 252;
  const jx = MARGIN, jy = y;

  // ── Jacket ────────────────────────────────────────────────────────────────
  const jacketImg = await loadCached(resolveJacketPath(song));
  const src = jacketImg || await loadCached(join(SCORE_ASSET, 'default_cover.png'));
  if (src) {
    ctx.save();
    rr(ctx, jx, jy, JACKET_SZ, JACKET_SZ, 10); ctx.clip();
    const s = Math.min(src.width, src.height);
    const sx = (src.width - s) / 2, sy = (src.height - s) / 2;
    ctx.drawImage(src, sx, sy, s, s, jx, jy, JACKET_SZ, JACKET_SZ);
    ctx.restore();
  }
  // Jacket border
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
  rr(ctx, jx, jy, JACKET_SZ, JACKET_SZ, 10); ctx.stroke();
  ctx.restore();

  // ── Version logo on jacket (bottom-left) ─────────────────────────────────
  const version = song?.difficultyLevels?.[0]?.version ?? song?.version ?? scores?.[0]?.version ?? null;
  const verFile = versionNameToFile(version);
  if (verFile) {
    const verImg = await loadCached(join(VERSION_ASSET, verFile));
    if (verImg) {
      const maxW = JACKET_SZ * 0.6;
      const s2 = Math.min(maxW / verImg.width, 32 / verImg.height);
      const vw = verImg.width * s2, vh = verImg.height * s2;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 8;
      ctx.drawImage(verImg, jx + 8, jy + JACKET_SZ - vh - 8, vw, vh);
      ctx.restore();
    }
  }

  // ── Song metadata (right of jacket) ──────────────────────────────────────
  const infoX = jx + JACKET_SZ + 20;
  const infoW  = W - infoX - MARGIN;
  let curY = jy + 6;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 5;

  // DX/STD type badge (from first score entry)
  const scoreType = String(scores?.[0]?.type || '').toLowerCase();
  const typeFile  = scoreType === 'dx' ? 'type_dx.png' : 'type_sd.png';
  const typeImg   = await loadCached(join(SCORE_ASSET, typeFile));
  if (typeImg) {
    const ts = 1.4;
    ctx.drawImage(typeImg, infoX, curY, typeImg.width * ts, typeImg.height * ts);
    curY += typeImg.height * ts + 10;
  } else {
    curY += 10;
  }

  // Song title
  ctx.font = `700 28px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'top';
  const titleStr = song?.title || 'Unknown Song';
  if (ctx.measureText(titleStr).width <= infoW) {
    ctx.fillText(titleStr, infoX, curY);
    curY += 36;
  } else {
    // Two-line split
    let l1 = '';
    for (let i = 1; i <= titleStr.length; i++) {
      if (ctx.measureText(titleStr.slice(0, i) + '…').width > infoW) break;
      l1 = titleStr.slice(0, i);
    }
    const l2 = titleStr.slice(l1.length);
    ctx.fillText(l1, infoX, curY); curY += 33;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(trimToWidth(ctx, l2, infoW), infoX, curY); curY += 30;
  }

  // Artist
  ctx.font = `400 16px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(trimToWidth(ctx, song?.artist || '', infoW), infoX, curY);
  curY += 26;

  // BPM (if available)
  if (song?.bpm) {
    ctx.font = `500 14px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(`BPM  ${song.bpm}`, infoX, curY); curY += 22;
  }

  // Category / genre pill
  const genre = song?.category || song?.genre;
  if (genre) {
    ctx.font = `500 13px ${FONT}`;
    const gw = ctx.measureText(genre).width + 18;
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.shadowBlur = 0;
    rr(ctx, infoX, curY, gw, 22, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textBaseline = 'middle';
    ctx.fillText(genre, infoX + 9, curY + 11);
    ctx.textBaseline = 'top'; ctx.shadowBlur = 5;
  }

  ctx.restore();
}

// ─── Difficulty row ───────────────────────────────────────────────────────────

async function drawDiffRow(ctx, score, y) {
  const rx = MARGIN, rw = IW;
  const diff = String(score.difficulty || 'master').toLowerCase();
  const color  = DIFF_COLOR[diff]  || '#888';
  const dark   = DIFF_DARK[diff]   || '#444';
  const name   = DIFF_NAME[diff]   || diff.toUpperCase();

  // ── Row container (rounded rect, dark background) ─────────────────────────
  ctx.save();
  ctx.fillStyle = '#1e1a2e';
  rr(ctx, rx, y, rw, ROW_H, 10); ctx.fill();
  ctx.restore();

  // ── Colored header band ───────────────────────────────────────────────────
  ctx.save();
  rr(ctx, rx, y, rw, ROW_H, 10); ctx.clip();
  const hg = ctx.createLinearGradient(rx, y, rx, y + ROW_HDR_H);
  hg.addColorStop(0, color);
  hg.addColorStop(1, dark);
  ctx.fillStyle = hg; ctx.fillRect(rx, y, rw, ROW_HDR_H);
  // Subtle inner shadow at bottom of header band
  const shg = ctx.createLinearGradient(rx, y + ROW_HDR_H - 6, rx, y + ROW_HDR_H);
  shg.addColorStop(0, 'rgba(0,0,0,0)'); shg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = shg; ctx.fillRect(rx, y, rw, ROW_HDR_H);
  ctx.restore();

  // Thin separator between header and body
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(rx, y + ROW_HDR_H, rw, 1);

  // ── Difficulty name (header, left) ────────────────────────────────────────
  ctx.save();
  ctx.font = `800 22px ${FONT}`; ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
  ctx.fillText(name, rx + 16, y + ROW_HDR_H / 2);
  ctx.restore();

  // ── Date + play count (header, right) ─────────────────────────────────────
  const dateStr  = formatDate(score?.playedAtIso ?? score?.playedAt ?? null);
  const countStr = score?.playCount != null ? String(score.playCount) : null;
  ctx.save();
  ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 3;
  if (dateStr) {
    ctx.font = `400 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const dw = ctx.measureText(dateStr).width;
    ctx.fillText('Last Played', rx + rw - dw - 14, y + ROW_HDR_H / 2 - 9);
    ctx.font = `600 13px ${FONT}`;
    ctx.fillText(dateStr, rx + rw - dw - 14, y + ROW_HDR_H / 2 + 9);
  }
  if (countStr && !dateStr) {
    // Only play count (no date)
    ctx.font = `600 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const cw = ctx.measureText(countStr).width;
    ctx.fillText(`Play Count:  ${countStr}`, rx + rw - cw - 80, y + ROW_HDR_H / 2);
  } else if (countStr && dateStr) {
    ctx.font = `400 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const cw = ctx.measureText(countStr).width;
    const label = 'Play Count';
    ctx.fillText(label, rx + rw - cw - 14, y + ROW_HDR_H / 2 - 9);
    ctx.font = `600 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(countStr, rx + rw - cw - 14, y + ROW_HDR_H / 2 + 9);
  }
  ctx.restore();

  // ─ Body ──────────────────────────────────────────────────────────────────
  const by = y + ROW_HDR_H + 1;  // body top
  const bh = ROW_H - ROW_HDR_H - 1;
  const midY = by + bh / 2;

  // Level box (dark rounded, left)
  const levelStr = score?.internalLevelValue != null
    ? Number(score.internalLevelValue).toFixed(1)
    : score?.level ?? '?';
  ctx.save();
  ctx.font = `700 22px ${FONT}`; ctx.textBaseline = 'middle';
  const lvW = ctx.measureText(levelStr).width;
  const boxW = lvW + 22, boxH = 44;
  const boxX = rx + 14, boxY = midY - boxH / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; rr(ctx, boxX, boxY, boxW, boxH, 6); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2; rr(ctx, boxX, boxY, boxW, boxH, 6); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
  ctx.fillText(levelStr, boxX + 11, midY);
  ctx.restore();

  // Rank icon (after level box)
  let iconX = rx + 14 + boxW + 12;
  const rankImg = await loadCached(join(SCORE_ASSET, getRankIconFile(score?.achievement)));
  if (rankImg) {
    const rh = 54, rw2 = rankImg.width * (rh / rankImg.height);
    ctx.drawImage(rankImg, iconX, midY - rh / 2, rw2, rh);
    iconX += rw2 + 8;
  }

  // FC icon
  const fcFile = getFcIconFile(score?.fc);
  if (fcFile) {
    const img = await loadCached(join(SCORE_ASSET, fcFile));
    if (img) {
      const ih = 44, iw = img.width * (ih / img.height);
      ctx.drawImage(img, iconX, midY - ih / 2, iw, ih);
      iconX += iw + 6;
    }
  }

  // FS icon
  const fsFile = getFsIconFile(score?.fs);
  if (fsFile) {
    const img = await loadCached(join(SCORE_ASSET, fsFile));
    if (img) {
      const ih = 44, iw = img.width * (ih / img.height);
      ctx.drawImage(img, iconX, midY - ih / 2, iw, ih);
    }
  }

  // ── Right cluster: achievement, rating, DX score, stars ───────────────────
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;

  // Achievement % (large, top-right)
  const achStr = formatAchievement(score?.achievement);
  ctx.font = `800 30px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic';
  const achW = ctx.measureText(achStr).width;
  ctx.fillText(achStr, rx + rw - achW - 16, by + 40);

  // >> Rating (after achievement, same line)
  if (score?.rating != null) {
    const rateStr = `>> ${score.rating}`;
    ctx.font = `600 17px ${FONT}`; ctx.fillStyle = color;
    const rtW = ctx.measureText(rateStr).width;
    ctx.fillText(rateStr, rx + rw - rtW - 16, by + bh - 14);
  }

  // DX score line
  if (score?.dxScore != null && score?.maxDxScore != null) {
    const pct = score.maxDxScore > 0 ? ((score.dxScore / score.maxDxScore) * 100).toFixed(1) : '?';
    const dxStr = `DX  ${score.dxScore.toLocaleString()} / ${score.maxDxScore.toLocaleString()}`;
    const pctStr = ` >> ${pct}%`;
    ctx.font = `500 14px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textBaseline = 'alphabetic';
    const dxW = ctx.measureText(dxStr + pctStr).width;
    ctx.fillText(dxStr, rx + rw - dxW - 16, by + 62);
    ctx.fillStyle = color;
    ctx.fillText(pctStr, rx + rw - ctx.measureText(pctStr).width - 16, by + 62);

    // DX stars (♦ symbols)
    const stars = calculateDXStars(score.dxScore, score.maxDxScore);
    if (stars > 0) {
      const starColor = stars >= 5 ? '#ffd700' : stars >= 3 ? '#f97316' : '#86efac';
      ctx.font = `600 16px ${FONT}`; ctx.fillStyle = starColor;
      const starStr = '♦'.repeat(stars);
      const sw = ctx.measureText(starStr).width;
      ctx.fillText(starStr, rx + rw - sw - 16, by + 82);
    }
  }

  ctx.restore();

  // Row border
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  rr(ctx, rx, y, rw, ROW_H, 10); ctx.stroke();
  ctx.restore();
}

// ─── Canvas background ────────────────────────────────────────────────────────

async function drawBackground(ctx, jacketImg, totalH) {
  if (jacketImg) {
    ctx.save();
    ctx.filter = 'blur(60px) brightness(0.18) saturate(1.8)';
    ctx.drawImage(jacketImg, -120, -120, W + 240, totalH + 240);
    ctx.filter = 'none';
    ctx.restore();
  } else {
    ctx.fillStyle = '#100118'; ctx.fillRect(0, 0, W, totalH);
  }
  // Uniform dark overlay
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, totalH);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderSongScoreGraphic({ account, song, scores }) {
  await registerFonts();

  if (!Array.isArray(scores) || scores.length === 0) {
    throw new Error('No score data to render.');
  }

  const n     = scores.length;
  const totalH = PLAYER_H + GAP + SONG_H + GAP + n * ROW_H + (n - 1) * GAP + GAP;

  const jacketImg = await loadCached(resolveJacketPath(song));
  const canvas = new Canvas(W, totalH);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, jacketImg, totalH);
  await drawPlayerHeader(ctx, account, jacketImg);

  const songY = PLAYER_H + GAP;
  await drawSongInfo(ctx, song, scores, songY);

  let rowY = songY + SONG_H + GAP;
  for (const score of scores) {
    await drawDiffRow(ctx, score, rowY);
    rowY += ROW_H + GAP;
  }

  const buffer = await canvas.toBuffer('png');
  const slug   = sanitizeFileName(song?.title || scores[0]?.title || 'song');
  return { buffer, fileName: `${slug}-score.png` };
}
