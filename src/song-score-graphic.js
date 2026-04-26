import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

// ─── Layout ───────────────────────────────────────────────────────────────────

const W         = 900;
const HEADER_H  = 64;
const LEFT_W    = 290;   // jacket column width
const J_PAD     = 14;    // jacket margin
const J_SZ      = LEFT_W - J_PAD * 2;   // 262 — inner jacket square
const H         = HEADER_H + J_PAD + J_SZ + J_PAD;  // 354

const SCORE_ASSET   = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'score');
const VERSION_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'version');
const DANI_ASSET    = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'dani');

const FONT = 'Inter, Murecho, "Noto Sans JP", sans-serif';

// ─── Image / font cache ───────────────────────────────────────────────────────

const IMAGE_CACHE     = new Map();
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
  const normalized = String(version).toLowerCase()
    .replace(/でらっくす/g, 'maimai_deluxe')
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    maimai_dx:       'maimai_deluxe',
    maimai_dx_plus:  'maimai_deluxe_plus',
  };
  return `${aliases[normalized] ?? normalized}.png`;
}

function getDaniFile(danRank) {
  if (danRank == null) return null;
  const n = Number(danRank);
  if (!Number.isFinite(n) || n < 0 || n > 23) return null;
  return `dani_${String(n).padStart(2, '0')}.png`;
}

function formatAchievement(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?.????%';
  return `${(n / 10000).toFixed(4)}%`;
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    }).replace(/\//g, '-');
  } catch { return null; }
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

// ─── Draw helpers ─────────────────────────────────────────────────────────────

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ─── Sections ─────────────────────────────────────────────────────────────────

async function drawBackground(ctx, jacketImg) {
  if (jacketImg) {
    ctx.save();
    ctx.filter = 'blur(48px) brightness(0.22) saturate(1.6)';
    ctx.drawImage(jacketImg, -80, -80, W + 160, H + 160);
    ctx.filter = 'none';
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#120820');
    g.addColorStop(1, '#0a0316');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Vignette-style overlay — heavier on right so text pops
  ctx.fillStyle = 'rgba(0,0,0,0.48)';
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createLinearGradient(LEFT_W, 0, W, 0);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(LEFT_W, 0, W - LEFT_W, H);
}

async function drawHeader(ctx, account) {
  const name    = account?.player?.name || 'Player';
  const title   = account?.extra?.title || '';
  const rating  = Number(account?.metrics?.rating) || 0;
  const danRank = account?.metrics?.danRank ?? account?.extra?.danRank ?? null;
  const iconUrl = account?.extra?.iconUrl || account?.player?.iconUrl || null;

  // Frosted glass strip
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, HEADER_H - 1, W, 1);

  // ── Avatar ────────────────────────────────────────────────────────────────
  const AV = 44;
  const ax = 12, ay = (HEADER_H - AV) / 2;
  const avatar = iconUrl ? await loadCached(iconUrl) : null;
  ctx.save();
  roundedRect(ctx, ax, ay, AV, AV, 6);
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, ax, ay, AV, AV);
  } else {
    ctx.fillStyle = '#333';
    ctx.fillRect(ax, ay, AV, AV);
  }
  ctx.restore();
  // thin border
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  roundedRect(ctx, ax, ay, AV, AV, 6);
  ctx.stroke();
  ctx.restore();

  // ── Name + title ──────────────────────────────────────────────────────────
  const textX = ax + AV + 10;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur  = 6;
  if (title) {
    ctx.font = `400 12px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, textX, ay + 14);
  }
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, textX, ay + AV - 3);
  ctx.restore();

  // ── Dan rank badge ────────────────────────────────────────────────────────
  let ratingX = W - 14;   // will be updated once we place rating frame

  const daniFile = getDaniFile(danRank);
  if (daniFile) {
    const daniImg = await loadCached(join(DANI_ASSET, daniFile));
    if (daniImg) {
      const dh = 34;
      const dw = daniImg.width * (dh / daniImg.height);
      ratingX -= dw + 8;
      ctx.drawImage(daniImg, ratingX + 8, (HEADER_H - dh) / 2, dw, dh);
    }
  }

  // ── Rating frame + number ─────────────────────────────────────────────────
  const frameFile = getRatingFrame(rating);
  const frameImg  = await loadCached(join(SCORE_ASSET, frameFile));
  const ratingStr = String(rating);

  if (frameImg) {
    const fh = 36;
    const fw = frameImg.width * (fh / frameImg.height);  // 176/40*36 = 158.4
    const fx = ratingX - fw - (daniFile ? 0 : 0) - 6;
    const fy = (HEADER_H - fh) / 2;
    ctx.drawImage(frameImg, fx, fy, fw, fh);
    // Rating number centered on frame
    ctx.save();
    ctx.font = `700 16px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur  = 4;
    const rw = ctx.measureText(ratingStr).width;
    ctx.fillText(ratingStr, fx + fw / 2 - rw / 2, fy + fh / 2);
    ctx.restore();
  } else {
    // Fallback colored pill
    ctx.save();
    ctx.font = `700 15px ${FONT}`;
    ctx.textBaseline = 'middle';
    const rw = ctx.measureText(ratingStr).width + 22;
    const fx = ratingX - rw - 6;
    const fy = (HEADER_H - 28) / 2;
    ctx.fillStyle = rating >= 15000 ? '#f0c040' : rating >= 14000 ? '#c0c0d8' : '#4ade80';
    roundedRect(ctx, fx, fy, rw, 28, 5);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillText(ratingStr, fx + rw / 2 - ctx.measureText(ratingStr).width / 2, fy + 14);
    ctx.restore();
  }
}

async function drawJacket(ctx, jacketImg, song, score, diff) {
  const jx = J_PAD;
  const jy = HEADER_H + J_PAD;
  const js = J_SZ;

  // ── Jacket art ───────────────────────────────────────────────────────────
  ctx.save();
  roundedRect(ctx, jx, jy, js, js, 8);
  ctx.clip();
  if (jacketImg) {
    const src = Math.min(jacketImg.width, jacketImg.height);
    const sx  = (jacketImg.width - src) / 2;
    const sy  = (jacketImg.height - src) / 2;
    ctx.drawImage(jacketImg, sx, sy, src, src, jx, jy, js, js);
  } else {
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(jx, jy, js, js);
  }
  ctx.restore();

  // ── Difficulty label overlay (from game assets, covers top band of jacket)
  // label_*.png is 180×101 with the solid colored band in the top ~27px.
  // We scale it to jacket width and draw it at the top of the jacket so the
  // colored difficulty strip sits across the top edge.
  const labelImg = await loadCached(join(SCORE_ASSET, getLabelFile(diff)));
  if (labelImg) {
    const scale  = js / labelImg.width;           // 262/180 = 1.456
    const destH  = labelImg.height * scale;       // 101*1.456 ≈ 147
    // Draw scaled label starting from top of jacket
    ctx.save();
    roundedRect(ctx, jx, jy, js, js, 8);
    ctx.clip();
    ctx.drawImage(labelImg, jx, jy, js, destH);
    ctx.restore();

    // Level text on the label — right side, vertically centered on the solid band
    const solidH = 27 * scale;  // ≈ 39px
    const levelText = score?.internalLevelValue != null
      ? Number(score.internalLevelValue).toFixed(1)
      : score?.level ?? '?';
    ctx.save();
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur   = 3;
    const lw = ctx.measureText(levelText).width;
    ctx.fillText(levelText, jx + js - lw - 8, jy + solidH / 2);
    ctx.restore();
  }

  // ── Type badge (DX / SD) — top-right of jacket, below label band ─────────
  const typeFile = String(score?.type || '').toLowerCase() === 'dx' ? 'type_dx.png' : 'type_sd.png';
  const typeImg  = await loadCached(join(SCORE_ASSET, typeFile));
  if (typeImg) {
    const solidH = labelImg ? 27 * (js / 180) : 0;
    const th = typeImg.height;
    const tw = typeImg.width;
    ctx.drawImage(typeImg, jx + js - tw - 5, jy + solidH + 4, tw, th);
  }

  // ── Version logo — bottom-left of jacket ─────────────────────────────────
  const verFile = versionNameToFile(song?.version);
  if (verFile) {
    const verImg = await loadCached(join(VERSION_ASSET, verFile));
    if (verImg) {
      const maxW = js * 0.52;
      const s    = Math.min(maxW / verImg.width, 26 / verImg.height);
      const vw   = verImg.width * s;
      const vh   = verImg.height * s;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur  = 5;
      ctx.drawImage(verImg, jx + 6, jy + js - vh - 6, vw, vh);
      ctx.restore();
    }
  }

  // ── Jacket border ─────────────────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth   = 1.5;
  roundedRect(ctx, jx, jy, js, js, 8);
  ctx.stroke();
  ctx.restore();
}

async function drawSongInfo(ctx, song, score, diff) {
  const rx = LEFT_W + 16;
  const rw = W - rx - 14;
  const ry = HEADER_H + 14;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur  = 6;

  // ── Song title ────────────────────────────────────────────────────────────
  const titleText = song?.title || score?.title || 'Unknown Song';
  ctx.font = `700 24px ${FONT}`;
  ctx.fillStyle   = '#ffffff';
  ctx.textBaseline = 'top';

  const titleW = ctx.measureText(titleText).width;
  if (titleW <= rw) {
    ctx.fillText(titleText, rx, ry);
  } else {
    // Find break point to split into two lines
    let l1 = '', l2 = '';
    for (let i = 1; i <= titleText.length; i++) {
      if (ctx.measureText(titleText.slice(0, i) + '…').width > rw) {
        l1 = titleText.slice(0, i - 1);
        l2 = titleText.slice(i - 1);
        break;
      }
      l1 = titleText.slice(0, i);
    }
    ctx.fillText(l1 + (l2 ? '' : ''), rx, ry);
    if (l2) {
      ctx.font = `700 20px ${FONT}`;
      ctx.fillText(trimToWidth(ctx, l2, rw), rx, ry + 30);
    }
  }

  // ── Artist ────────────────────────────────────────────────────────────────
  ctx.font = `400 15px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(trimToWidth(ctx, song?.artist || '', rw), rx, ry + 62);

  // ── Genre pill ────────────────────────────────────────────────────────────
  let pillBottom = ry + 62 + 20;
  if (song?.genre) {
    const gText = song.genre;
    ctx.font = `500 12px ${FONT}`;
    const gw = ctx.measureText(gText).width + 16;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.shadowBlur = 0;
    roundedRect(ctx, rx, ry + 87, gw, 20, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textBaseline = 'middle';
    ctx.fillText(gText, rx + 8, ry + 87 + 10);
    pillBottom = ry + 87 + 26;
    ctx.textBaseline = 'top';
    ctx.shadowBlur = 6;
  }

  // ── Divider ───────────────────────────────────────────────────────────────
  const divY = Math.max(pillBottom + 6, ry + 118);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(rx, divY, rw, 1);
  ctx.shadowBlur = 0;

  // ── Rank icon ─────────────────────────────────────────────────────────────
  const rankImg = await loadCached(join(SCORE_ASSET, getRankIconFile(score?.achievement)));
  let rankRight = rx;
  if (rankImg) {
    const rh = 44;
    const rw2 = rankImg.width * (rh / rankImg.height);   // 120/48*44 = 110
    ctx.drawImage(rankImg, rx, divY + 10, rw2, rh);
    rankRight = rx + rw2 + 8;
  }

  // ── FC / FS icons ─────────────────────────────────────────────────────────
  let comboX = rankRight;
  for (const getter of [getFcIconFile(score?.fc), getFsIconFile(score?.fs)]) {
    if (!getter) continue;
    const img = await loadCached(join(SCORE_ASSET, getter));
    if (img) {
      const ih = 36;
      const iw = img.width * (ih / img.height);
      ctx.drawImage(img, comboX, divY + 14, iw, ih);
      comboX += iw + 6;
    }
  }

  // ── Achievement % (right-aligned, large) ─────────────────────────────────
  const achText = formatAchievement(score?.achievement);
  ctx.save();
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle    = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.shadowColor  = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur   = 5;
  const achW = ctx.measureText(achText).width;
  ctx.fillText(achText, W - achW - 14, divY + 8);
  ctx.restore();

  // ── DX score ──────────────────────────────────────────────────────────────
  if (score?.dxScore != null) {
    const maxTxt = score.maxDxScore != null ? ` / ${score.maxDxScore.toLocaleString()}` : '';
    const pctTxt = (score.maxDxScore > 0) ? `  (${((score.dxScore / score.maxDxScore) * 100).toFixed(1)}%)` : '';
    const dxLine = `DX  ${score.dxScore.toLocaleString()}${maxTxt}${pctTxt}`;
    ctx.save();
    ctx.font = `400 13px ${FONT}`;
    ctx.fillStyle    = 'rgba(255,255,255,0.6)';
    ctx.textBaseline = 'top';
    ctx.shadowColor  = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur   = 3;
    const dxW = ctx.measureText(dxLine).width;
    ctx.fillText(dxLine, W - dxW - 14, divY + 46);
    ctx.restore();
  }

  // ── Date + play count ─────────────────────────────────────────────────────
  const dateText  = formatDate(score?.playedAtIso ?? score?.playedAt ?? null);
  const countText = score?.playCount != null ? `${score.playCount} plays` : null;
  const metaY     = divY + 68;
  ctx.save();
  ctx.font = `400 12px ${FONT}`;
  ctx.fillStyle    = 'rgba(255,255,255,0.42)';
  ctx.textBaseline = 'top';
  ctx.shadowBlur   = 0;
  if (dateText)  ctx.fillText(dateText, rx, metaY);
  if (countText) {
    const cw = ctx.measureText(countText).width;
    ctx.fillText(countText, W - cw - 14, metaY);
  }
  ctx.restore();

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
  await drawJacket(ctx, jacketImg, song, score, diff);
  await drawSongInfo(ctx, song, score, diff);

  const buffer   = await canvas.toBuffer('png');
  const songSlug = sanitizeFileName(song?.title || score?.title || 'song');
  return { buffer, fileName: `${songSlug}-${diff}-score.png` };
}
