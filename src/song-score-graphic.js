import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

// ─── Layout ───────────────────────────────────────────────────────────────────
//
// Total: 900 × 440
//
//  ┌─────────────────────────────────────────────────────────────────── 900px ─┐
//  │  HEADER (64px)  avatar | name/title ..................... dani | rating   │
//  ├──────────────────┬──────────────────────────────────────────────────────┤
//  │  JACKET  (300px) │  SCORE PANEL (600px)                                  │
//  │  ┌─────────────┐ │  title (26px bold, up to 2 lines)                    │
//  │  │ label img   │ │  artist (15px, muted)                                │
//  │  │ (top 45px   │ │  genre pill                                          │
//  │  │  solid band)│ │  ── divider ──────────────────────────────────────── │
//  │  │             │ │  [rank icon 60h]  [FC] [FS]    achievement% (34px)  │
//  │  │  jacket art │ │                                DX score              │
//  │  │  fills rest │ │  ── divider ──────────────────────────────────────── │
//  │  │             │ │  date                           play count           │
//  │  │ [ver logo]  │ │                                                      │
//  │  └─────────────┘ │                                                      │
//  └──────────────────┴──────────────────────────────────────────────────────┘

const W        = 900;
const HEADER_H = 64;
const LEFT_W   = 300;
const BODY_H   = 376;
const H        = HEADER_H + BODY_H;  // 440

const SCORE_ASSET   = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'score');
const VERSION_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'version');
const DANI_ASSET    = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'dani');

const FONT = 'Inter, Murecho, "Noto Sans JP", sans-serif';

// ─── Caching ──────────────────────────────────────────────────────────────────

const IMG_CACHE       = new Map();
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

function getLabelFile(diff) {
  return {
    basic:    'label_Basic.png',
    advanced: 'label_Advanced.png',
    expert:   'label_Expert.png',
    master:   'label_Master.png',
    remaster: 'label_ReMASTER.png',
  }[diff] ?? 'label_Master.png';
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

function versionNameToFile(version) {
  if (!version) return null;
  const n = String(version).toLowerCase()
    .replace(/でらっくす/g, 'maimai_deluxe')
    .replace(/\s+/g, '_').replace(/[^\w]/g, '_')
    .replace(/_+/g, '_').replace(/^_|_$/g, '');
  const alias = { maimai_dx: 'maimai_deluxe', maimai_dx_plus: 'maimai_deluxe_plus' };
  return `${alias[n] ?? n}.png`;
}

function getDaniFile(danRank) {
  const n = Number(danRank);
  if (!Number.isFinite(n) || n < 0 || n > 23) return null;
  return `dani_${String(n).padStart(2, '0')}.png`;
}

function formatAchievement(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?.????%';
  // Always show 4 decimal places: e.g. 946555 → 94.6555%
  return `${(n / 10000).toFixed(4)}%`;
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// ─── Draw functions ───────────────────────────────────────────────────────────

// Fills the entire canvas with a blurred, darkened jacket image as background.
async function drawBackground(ctx, jacketImg) {
  if (jacketImg) {
    ctx.save();
    ctx.filter = 'blur(50px) brightness(0.20) saturate(1.8)';
    ctx.drawImage(jacketImg, -100, -100, W + 200, H + 200);
    ctx.filter = 'none';
    ctx.restore();
  } else {
    ctx.fillStyle = '#0d0118';
    ctx.fillRect(0, 0, W, H);
  }
  // Gradient vignette — darker on the right for readability
  const vg = ctx.createLinearGradient(0, 0, W, 0);
  vg.addColorStop(0,   'rgba(0,0,0,0.30)');
  vg.addColorStop(0.35,'rgba(0,0,0,0.45)');
  vg.addColorStop(1,   'rgba(0,0,0,0.70)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

async function drawHeader(ctx, account) {
  const name    = account?.player?.name || 'Player';
  const title   = account?.extra?.title || '';
  const rating  = Number(account?.metrics?.rating) || 0;
  const danRank = account?.metrics?.danRank ?? account?.extra?.danRank ?? null;
  const iconUrl = account?.extra?.iconUrl || account?.player?.iconUrl || null;

  // Frosted header strip
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fillRect(0, 0, W, HEADER_H);
  // Bottom edge highlight
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, HEADER_H - 1, W, 1);

  // Avatar
  const AV = 46, ax = 12, ay = (HEADER_H - AV) / 2;
  const avatar = iconUrl ? await loadCached(iconUrl) : null;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(ax, ay, AV, AV, 6); ctx.clip();
  ctx.fillStyle = '#222';
  ctx.fillRect(ax, ay, AV, AV);
  if (avatar) ctx.drawImage(avatar, ax, ay, AV, AV);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(ax, ay, AV, AV, 6); ctx.stroke();
  ctx.restore();

  // Name + title (left of header, after avatar)
  const tx = ax + AV + 10;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
  if (title) {
    ctx.font = `400 12px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, tx, ay + 15);
  }
  ctx.font = `700 21px ${FONT}`; ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, tx, ay + AV - 3);
  ctx.restore();

  // Right side: rating frame + dani badge
  let rx = W - 12;

  // Dan rank badge (rightmost)
  const daniFile = getDaniFile(danRank);
  if (daniFile) {
    const di = await loadCached(join(DANI_ASSET, daniFile));
    if (di) {
      const dh = 36, dw = di.width * (dh / di.height);
      rx -= dw;
      ctx.drawImage(di, rx, (HEADER_H - dh) / 2, dw, dh);
      rx -= 8;
    }
  }

  // Rating frame (176×40 → scaled to height 34)
  const frameImg = await loadCached(join(SCORE_ASSET, getRatingFrame(rating)));
  if (frameImg) {
    const fh = 34, fw = frameImg.width * (fh / frameImg.height);
    rx -= fw;
    const fy = (HEADER_H - fh) / 2;
    ctx.drawImage(frameImg, rx, fy, fw, fh);
    // Rating number centered on frame
    ctx.save();
    ctx.font = `800 16px ${FONT}`; ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
    const rstr = String(rating), rw = ctx.measureText(rstr).width;
    ctx.fillText(rstr, rx + fw / 2 - rw / 2, fy + fh / 2);
    ctx.restore();
    rx -= 8;
  } else {
    // Fallback pill if frame image missing
    ctx.save();
    const rstr = String(rating);
    ctx.font = `700 15px ${FONT}`; ctx.textBaseline = 'middle';
    const pillW = ctx.measureText(rstr).width + 22;
    rx -= pillW;
    ctx.fillStyle = rating >= 15000 ? '#f0c040' : rating >= 14000 ? '#c0c0d8' : '#4ade80';
    ctx.beginPath(); ctx.roundRect(rx, (HEADER_H - 28) / 2, pillW, 28, 6); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillText(rstr, rx + pillW / 2 - ctx.measureText(rstr).width / 2, HEADER_H / 2);
    ctx.restore();
    rx -= 8;
  }
}

// Draws the jacket column (left side of body): jacket art with label overlay, type badge, version logo.
async function drawJacketColumn(ctx, jacketImg, song, score, diff) {
  const jx = 0, jy = HEADER_H, jw = LEFT_W, jh = BODY_H;

  // ── Jacket art (cover-fill the full column) ───────────────────────────────
  const src = jacketImg || await loadCached(join(SCORE_ASSET, 'default_cover.png'));
  if (src) {
    ctx.save();
    ctx.beginPath(); ctx.rect(jx, jy, jw, jh); ctx.clip();
    const scale = Math.max(jw / src.width, jh / src.height);
    const srcW  = jw / scale, srcH = jh / scale;
    const srcX  = (src.width  - srcW) / 2;
    const srcY  = (src.height - srcH) / 2;
    ctx.drawImage(src, srcX, srcY, srcW, srcH, jx, jy, jw, jh);
    // Darken jacket so label and overlays pop
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(jx, jy, jw, jh);
    ctx.restore();
  }

  // ── label_*.png overlay (anchored at top of jacket column) ───────────────
  // The label image (180×101 RGBA) has its colored difficulty band in the top ~27px
  // and is transparent below, letting the jacket show through exactly as the game does.
  const labelImg = await loadCached(join(SCORE_ASSET, getLabelFile(diff)));
  if (labelImg) {
    // Scale label to fill the full column width
    const lScale = jw / labelImg.width;          // 300/180 = 1.667
    const lDestH = labelImg.height * lScale;     // 101*1.667 ≈ 168px
    ctx.drawImage(labelImg, jx, jy, jw, lDestH);

    // Solid band height at this scale (~27px * 1.667 = 45px)
    const bandH = 27 * lScale;

    // Level in the band (right side, vertically centered in band)
    const levelTxt = score?.internalLevelValue != null
      ? Number(score.internalLevelValue).toFixed(1)
      : score?.level ?? '?';
    ctx.save();
    ctx.font = `700 18px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 3;
    const lvW = ctx.measureText(levelTxt).width;
    ctx.fillText(levelTxt, jx + jw - lvW - 10, jy + bandH / 2);
    ctx.restore();

    // DX/STD type badge — just below the solid band, right-aligned
    const typeFile = String(score?.type || '').toLowerCase() === 'dx' ? 'type_dx.png' : 'type_sd.png';
    const typeImg  = await loadCached(join(SCORE_ASSET, typeFile));
    if (typeImg) {
      const tScale = 1.3;
      const tw = typeImg.width * tScale, th = typeImg.height * tScale;
      ctx.drawImage(typeImg, jx + jw - tw - 6, jy + bandH + 6, tw, th);
    }
  }

  // ── Version logo — bottom-left of jacket column ───────────────────────────
  const verFile = versionNameToFile(song?.version);
  if (verFile) {
    const verImg = await loadCached(join(VERSION_ASSET, verFile));
    if (verImg) {
      const maxW = jw * 0.58;
      const s    = Math.min(maxW / verImg.width, 30 / verImg.height);
      const vw   = verImg.width * s, vh = verImg.height * s;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 8;
      ctx.drawImage(verImg, jx + 8, jy + jh - vh - 8, vw, vh);
      ctx.restore();
    }
  }

  // ── Right edge fade (blends jacket into score panel) ─────────────────────
  const fade = ctx.createLinearGradient(jx + jw - 40, 0, jx + jw, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = fade;
  ctx.fillRect(jx + jw - 40, jy, 40, jh);

  // Thin right border
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(jx + jw - 1, jy, 1, jh);
}

// Draws all score info in the right panel.
async function drawScorePanel(ctx, song, score, diff) {
  const px = LEFT_W + 20;         // panel text start x
  const pw = W - px - 16;         // panel usable width
  const py = HEADER_H + 18;       // panel text start y (top of body)

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 5;

  // ── Song title ────────────────────────────────────────────────────────────
  const titleStr = song?.title || score?.title || 'Unknown Song';
  ctx.font = `700 26px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'top';

  if (ctx.measureText(titleStr).width <= pw) {
    ctx.fillText(titleStr, px, py);
  } else {
    // Split into two lines at a character boundary
    let l1 = '';
    for (let i = 1; i <= titleStr.length; i++) {
      if (ctx.measureText(titleStr.slice(0, i) + '…').width > pw) break;
      l1 = titleStr.slice(0, i);
    }
    const l2 = titleStr.slice(l1.length);
    ctx.fillText(l1, px, py);
    ctx.font = `700 21px ${FONT}`;
    ctx.fillText(trimToWidth(ctx, l2, pw), px, py + 33);
  }

  // ── Artist ────────────────────────────────────────────────────────────────
  ctx.font = `400 15px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.fillText(trimToWidth(ctx, song?.artist || '', pw), px, py + 70);

  // ── Genre pill ────────────────────────────────────────────────────────────
  let afterGenre = py + 70 + 22;
  if (song?.genre) {
    ctx.font = `500 12px ${FONT}`;
    const gw = ctx.measureText(song.genre).width + 18;
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.roundRect(px, py + 96, gw, 21, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textBaseline = 'middle';
    ctx.fillText(song.genre, px + 9, py + 96 + 10.5);
    ctx.textBaseline = 'top'; ctx.shadowBlur = 5;
    afterGenre = py + 96 + 27;
  }

  // ── Divider ───────────────────────────────────────────────────────────────
  const div1Y = Math.max(afterGenre + 6, py + 128);
  ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.shadowBlur = 0;
  ctx.fillRect(px, div1Y, pw, 1);

  // ── Rank icon ─────────────────────────────────────────────────────────────
  const rankImg = await loadCached(join(SCORE_ASSET, getRankIconFile(score?.achievement)));
  let afterRankX = px;
  if (rankImg) {
    const rh = 54, rw = rankImg.width * (rh / rankImg.height);   // 120/48 * 54 = 135
    ctx.drawImage(rankImg, px, div1Y + 12, rw, rh);
    afterRankX = px + rw + 10;
  }

  // ── FC / FS combo icons ───────────────────────────────────────────────────
  let comboX = afterRankX;
  for (const file of [getFcIconFile(score?.fc), getFsIconFile(score?.fs)]) {
    if (!file) continue;
    const img = await loadCached(join(SCORE_ASSET, file));
    if (img) {
      const ih = 42, iw = img.width * (ih / img.height);
      ctx.drawImage(img, comboX, div1Y + 20, iw, ih);
      comboX += iw + 8;
    }
  }

  // ── Achievement % (large, right-aligned) ─────────────────────────────────
  const achStr = formatAchievement(score?.achievement);
  ctx.save();
  ctx.font = `800 34px ${FONT}`; ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top'; ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 6;
  const achW = ctx.measureText(achStr).width;
  ctx.fillText(achStr, W - achW - 16, div1Y + 10);
  ctx.restore();

  // ── DX score (below achievement, right-aligned) ───────────────────────────
  if (score?.dxScore != null) {
    const maxPart = score.maxDxScore != null ? ` / ${score.maxDxScore.toLocaleString()}` : '';
    const pctPart = (score.maxDxScore > 0) ? `  (${((score.dxScore / score.maxDxScore) * 100).toFixed(1)}%)` : '';
    const dxStr   = `DX  ${score.dxScore.toLocaleString()}${maxPart}${pctPart}`;
    ctx.save();
    ctx.font = `400 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.textBaseline = 'top'; ctx.shadowBlur = 3;
    const dxW = ctx.measureText(dxStr).width;
    ctx.fillText(dxStr, W - dxW - 16, div1Y + 52);
    ctx.restore();
  }

  // ── Divider 2 ─────────────────────────────────────────────────────────────
  const div2Y = div1Y + 82;
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.shadowBlur = 0;
  ctx.fillRect(px, div2Y, pw, 1);

  // ── Date + play count ─────────────────────────────────────────────────────
  const dateStr  = formatDate(score?.playedAtIso ?? score?.playedAt ?? null);
  const countStr = score?.playCount != null ? `${score.playCount} plays` : null;
  ctx.save();
  ctx.font = `400 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.textBaseline = 'top'; ctx.shadowBlur = 0;
  if (dateStr)  ctx.fillText(dateStr,  px, div2Y + 10);
  if (countStr) {
    const cw = ctx.measureText(countStr).width;
    ctx.fillText(countStr, W - cw - 16, div2Y + 10);
  }
  ctx.restore();

  ctx.restore(); // outer save
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderSongScoreGraphic({ account, song, score, difficulty }) {
  await registerFonts();

  const diff      = String(difficulty || score?.difficulty || 'master').toLowerCase();
  const jacketImg = await loadCached(resolveJacketPath(song));

  const canvas = new Canvas(W, H);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, jacketImg);
  await drawHeader(ctx, account);
  await drawJacketColumn(ctx, jacketImg, song, score, diff);
  await drawScorePanel(ctx, song, score, diff);

  const buffer   = await canvas.toBuffer('png');
  const slug     = sanitizeFileName(song?.title || score?.title || 'song');
  return { buffer, fileName: `${slug}-${diff}-score.png` };
}
