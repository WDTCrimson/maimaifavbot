import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

// ─── Paths ────────────────────────────────────────────────────────────────────

const TOMOMAI    = join(process.cwd(), 'data', 'assets', 'tomomai', 'res');
const THEME_DIR  = join(process.cwd(), 'data', 'theme', 'tomomai');
const DANI_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'dani');

// ─── Layout ───────────────────────────────────────────────────────────────────

const W           = 1200;
const MARGIN      = 36;
const IW          = W - MARGIN * 2;
const PLAYER_H    = 160;
const SECTION_H   = 48;
const CARD_GAP    = 14;
const SECTION_GAP = 28;
const GAP         = 12;
const BOTTOM_PAD  = 40;
const COLUMNS     = 5;
const CARD_W      = (IW - CARD_GAP * (COLUMNS - 1)) / COLUMNS;
const CARD_H      = Math.round((CARD_W / 16) * 11);

const FONT      = 'Inter, Murecho, "Noto Sans JP", sans-serif';
const FONT_MONO = '"Geist Mono", monospace';

// ─── Difficulty colors ────────────────────────────────────────────────────────

const DIFF_COLOR = {
  basic: '#22c55e', advanced: '#f97316', expert: '#ef4444',
  master: '#a855f7', remaster: '#e879f9', utage: '#f59e0b'
};

// ─── Character/logo positioning per version ───────────────────────────────────

const VERSION_SETTINGS = {
  10: { charScale: 0.56, charLeft: 620, charTop: -100 },
  11: { charScale: 0.70, charLeft: 680, charTop: -100 },
  12: { charScale: 0.60, charLeft: 660, charTop: -30  },
  13: { charScale: 0.65, charLeft: 660, charTop: -30  },
};

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
    ['Inter',        'Inter-VariableFont_opsz,wght.woff2'],
    ['Murecho',      'Murecho-VariableFont_wght.woff2'],
    ['Noto Sans JP', 'NotoSansJP-VariableFont_wght.woff2'],
    ['Geist Mono',   'GeistMono-VariableFont_wght.woff2'],
  ]) {
    const path = join(fontDir, file);
    if (await fileExists(path)) { FontLibrary.use(family, [path]); REGISTERED_FONTS.add(family); }
  }
}

// ─── Asset helpers ────────────────────────────────────────────────────────────

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

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

function formatAchievement(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?.????%';
  return `${(n / 10000).toFixed(4)}%`;
}

function formatConstant(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return Number.isInteger(n) ? n.toFixed(1) : String(n);
  const t = String(value || '').trim();
  return t ? (/^-?\d+$/.test(t) ? `${t}.0` : t) : '?';
}

function trimToWidth(ctx, text, maxW) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function resolveSongImagePath(song) {
  if (song?.jacket?.dxratingFile)
    return join(process.cwd(), 'data', 'assets', 'jacket', 'dxrating', song.jacket.dxratingFile);
  if (song?.jacket?.otogeFile)
    return join(process.cwd(), 'data', 'assets', 'jacket', 'otoge-db', song.jacket.otogeFile);
  return null;
}

function resolveFcBadgePath(gameVersion, fc) {
  return join(TOMOMAI, 'badge', String(gameVersion), `${String(fc || 'none').toLowerCase()}.png`);
}

function resolveFsBadgePath(gameVersion, fs) {
  return join(TOMOMAI, 'badge', String(gameVersion), `${String(fs || 'none').toLowerCase()}.png`);
}

// ─── Background ───────────────────────────────────────────────────────────────

async function drawBackground(ctx, v, totalH) {
  const bgImg = await loadCached(join(TOMOMAI, 'bg', `${v}.png`));
  if (bgImg) {
    const scale = W / bgImg.width;
    ctx.drawImage(bgImg, 0, 0, bgImg.width, Math.ceil(totalH / scale), 0, 0, W, totalH);
  } else {
    ctx.fillStyle = '#180826';
    ctx.fillRect(0, 0, W, totalH);
  }

  // Ghost character — drawn before the dark overlay so it reads as subtle flavour
  const vs = VERSION_SETTINGS[v] || VERSION_SETTINGS[13];
  const charImg = await loadCached(join(THEME_DIR, `character-${v}.png`));
  if (charImg) {
    ctx.save();
    ctx.globalAlpha = 0.90;
    ctx.drawImage(
      charImg,
      vs.charLeft, vs.charTop,
      charImg.width  * vs.charScale,
      charImg.height * vs.charScale
    );
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, totalH);
}

// ─── Player header ────────────────────────────────────────────────────────────

async function drawPlayerHeader(ctx, account, v) {
  const name    = account?.player?.name || 'Player';
  const title   = account?.extra?.title || '';
  const rating  = Number(account?.metrics?.rating) || 0;
  const gameVer = Number(account?.gameVersion) || 13;
  const courseRankIndex = account?.extra?.courseRankIndex ?? null;
  const courseRankUrl   = account?.extra?.courseRankUrl ?? null;
  const iconUrl = account?.extra?.iconUrl || account?.player?.iconUrl || null;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, PLAYER_H);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, PLAYER_H - 1, W, 1);

  // Avatar
  const AV = 100, ax = 22, ay = (PLAYER_H - AV) / 2;
  const avatar = iconUrl ? await loadCached(iconUrl) : null;
  ctx.save();
  rr(ctx, ax, ay, AV, AV, 10); ctx.clip();
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(ax, ay, AV, AV);
  if (avatar) ctx.drawImage(avatar, ax, ay, AV, AV);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
  rr(ctx, ax, ay, AV, AV, 10); ctx.stroke();
  ctx.restore();

  // Title + name
  const tx = ax + AV + 18;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;

  if (title) {
    ctx.font = `500 14px ${FONT}`; ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(title).width;
    const pH = 24, pY = PLAYER_H / 2 - 50;
    ctx.fillStyle = 'rgba(255,220,80,0.18)'; ctx.shadowBlur = 0;
    rr(ctx, tx, pY, tw + 20, pH, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,80,0.38)'; ctx.lineWidth = 1;
    rr(ctx, tx, pY, tw + 20, pH, 3); ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,100,0.9)'; ctx.shadowBlur = 5;
    ctx.fillText(title, tx + 10, pY + pH - 5);
  }

  ctx.font = `700 32px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, tx, PLAYER_H / 2 + 14);

  const totalPlays = account?.metrics?.playCount;
  if (totalPlays != null) {
    ctx.font = `500 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`${Number(totalPlays).toLocaleString()} plays`, tx, PLAYER_H / 2 + 34);
  }
  ctx.restore();

  // Right cluster built right-to-left: logo (rightmost) → dani → rating frame
  let rx = W - 22;

  // Version logo (rightmost)
  const logoImg = await loadCached(join(THEME_DIR, `logo-${v}.png`));
  if (logoImg) {
    const lh = 54, lw = logoImg.width * (lh / logoImg.height);
    rx -= lw;
    ctx.drawImage(logoImg, rx, (PLAYER_H - lh) / 2, lw, lh);
    rx -= 16;
  }

  // Dani badge
  const daniSrc = courseRankIndex != null
    ? join(DANI_ASSET, `dani_${String(courseRankIndex).padStart(2, '0')}.png`)
    : courseRankUrl;
  if (daniSrc) {
    const di = await loadCached(daniSrc);
    if (di) {
      const dh = 48, dw = di.width * (dh / di.height);
      rx -= dw;
      ctx.drawImage(di, rx, (PLAYER_H - dh) / 2, dw, dh);
      rx -= 14;
    }
  }

  // Rating frame
  const frameImg = await loadCached(join(TOMOMAI, 'rating', `${ratingVariant(rating, gameVer)}.png`));
  const FRAME_SCALE = 0.80;
  if (frameImg) {
    const fw = frameImg.width  * FRAME_SCALE;
    const fh = frameImg.height * FRAME_SCALE;
    rx -= fw;
    const fy = (PLAYER_H - fh) / 2;
    ctx.drawImage(frameImg, rx, fy, fw, fh);
    ctx.save();
    ctx.font = `600 ${Math.round(fh * 0.53)}px ${FONT_MONO}`;
    ctx.fillStyle = '#f9f0f4';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
    let dx = rx + fw * 0.43;
    const dy = fy + fh * 0.19 + fh * 0.53;
    for (const ch of String(rating)) {
      ctx.fillText(ch, dx, dy);
      dx += 23 * FRAME_SCALE / 0.75;
    }
    ctx.restore();
  }
}

// ─── Section label bar ────────────────────────────────────────────────────────

async function drawSectionBar(ctx, y, bucket, entries) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, y, W, SECTION_H);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, y + SECTION_H - 1, W, 1);
  ctx.restore();

  const labelImg = await loadCached(join(TOMOMAI, 'label', `${bucket}.png`));
  let textX = MARGIN;

  if (labelImg) {
    const lh = SECTION_H - 14;
    const lw = labelImg.width * (lh / labelImg.height);
    ctx.drawImage(labelImg, MARGIN, y + 7, lw, lh);
    textX = MARGIN + lw + 14;
  }

  const total = entries.reduce((s, e) => s + (Number.isFinite(Number(e?.rating)) ? Number(e.rating) : 0), 0);
  const avg   = entries.length ? (total / entries.length).toFixed(1) : '0.0';
  ctx.save();
  ctx.font = `500 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${entries.length} songs • ${total} total • ${avg} avg`, textX, y + SECTION_H / 2);
  ctx.restore();
}

// ─── Song card ────────────────────────────────────────────────────────────────

async function drawSongCard(ctx, entry, x, y, v) {
  const diff  = String(entry.difficulty || 'master').toLowerCase();
  const color = DIFF_COLOR[diff] || '#888';

  // Jacket — cover-fill clipped to rounded rect
  const jacketImg = entry.imagePath ? await loadCached(entry.imagePath) : null;
  ctx.save();
  rr(ctx, x, y, CARD_W, CARD_H, 10); ctx.clip();
  if (jacketImg) {
    const ratio = Math.max(CARD_W / jacketImg.width, CARD_H / jacketImg.height);
    const dw = jacketImg.width * ratio, dh = jacketImg.height * ratio;
    ctx.drawImage(jacketImg, x + (CARD_W - dw) / 2, y + (CARD_H - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = '#2a1640';
    ctx.fillRect(x, y, CARD_W, CARD_H);
  }
  ctx.restore();

  // Gradient overlay (heavier bottom for text contrast)
  ctx.save();
  rr(ctx, x, y, CARD_W, CARD_H, 10); ctx.clip();
  const grad = ctx.createLinearGradient(0, y, 0, y + CARD_H);
  grad.addColorStop(0,    'rgba(0,0,0,0.05)');
  grad.addColorStop(0.35, 'rgba(0,0,0,0.20)');
  grad.addColorStop(1,    'rgba(0,0,0,0.82)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.restore();

  // Difficulty-colored border
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.65;
  rr(ctx, x, y, CARD_W, CARD_H, 10); ctx.stroke();
  ctx.restore();

  // ── Top-left: DX / STD badge
  const isDx = String(entry.type || '').toLowerCase() === 'dx';
  const typeBadge = await loadCached(
    join(process.cwd(), 'data', 'assets', 'logo', 'otoge-db', isDx ? 'chart_badge_dx.png' : 'chart_badge_std.png')
  );
  if (typeBadge) {
    const th = 20, tw = typeBadge.width * (th / typeBadge.height);
    ctx.drawImage(typeBadge, x + 8, y + 8, tw, th);
  }

  // ── Top-right: internal level chip
  ctx.save();
  const levelStr = formatConstant(entry.internalLevelValue);
  ctx.font = `600 13px ${FONT}`;
  const chipW = ctx.measureText(levelStr).width + 20;
  ctx.beginPath(); ctx.roundRect(x + CARD_W - chipW, y, chipW, 28, [0, 10, 0, 10]);
  ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = diff === 'remaster' ? '#591a8b' : '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(levelStr, x + CARD_W - chipW / 2, y + 14);
  ctx.restore();

  // ── Middle-left: FC + FS badges
  const fcBadge = await loadCached(resolveFcBadgePath(v, entry.fc));
  const fsBadge = await loadCached(resolveFsBadgePath(v, entry.fs));
  const bs = 0.58, badgeY = y + CARD_H / 2 - 12;
  let badgeX = x + 8;
  if (fcBadge) {
    ctx.drawImage(fcBadge, badgeX, badgeY, fcBadge.width * bs, fcBadge.height * bs);
    badgeX += fcBadge.width * bs - 2;
  }
  if (fsBadge) {
    ctx.drawImage(fsBadge, badgeX, badgeY, fsBadge.width * bs, fsBadge.height * bs);
  }

  // ── Bottom: title, achievement, rating
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 8;

  ctx.font = `700 16px ${FONT}`; ctx.fillStyle = '#f5f5f5';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(trimToWidth(ctx, entry.title || 'Unknown', CARD_W - 16), x + 8, y + CARD_H - 36);

  ctx.font = `500 14px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(formatAchievement(entry.achievement), x + 8, y + CARD_H - 10);

  ctx.font = `700 22px ${FONT_MONO}`; ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.fillText(String(entry.rating || 0), x + CARD_W - 8, y + CARD_H - 8);
  ctx.restore();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderAccountB50Graphic({ account, songCatalog, themeDir: _themeDir }) {
  await registerFonts();

  const best50 = account?.best50;
  if (!best50 || !Array.isArray(best50.b15) || !Array.isArray(best50.b35)) {
    throw new Error('This account snapshot does not include B50 data yet. Run `/account sync` first.');
  }

  const gameVersion = Number(account?.gameVersion) || 13;
  const v = Math.min(Math.max(Math.floor(gameVersion), 10), 13);

  async function buildEntries(list) {
    return Promise.all(list.map(async entry => {
      const song = entry.favoriteId ? songCatalog.getByFavoriteId(entry.favoriteId) : null;
      return { ...entry, imagePath: resolveSongImagePath(song) };
    }));
  }

  const DIFF_ORDER = { remaster: 5, master: 4, expert: 3, advanced: 2, basic: 1, utage: 0 };

  function sortEntries(entries) {
    return [...entries].sort((a, b) => {
      const rDiff = Number(b.rating) - Number(a.rating);
      if (rDiff !== 0) return rDiff;
      const dDiff = (DIFF_ORDER[String(b.difficulty).toLowerCase()] ?? -1)
                  - (DIFF_ORDER[String(a.difficulty).toLowerCase()] ?? -1);
      if (dDiff !== 0) return dDiff;
      const cDiff = Number(b.internalLevelValue) - Number(a.internalLevelValue);
      if (cDiff !== 0) return cDiff;
      return String(a.title ?? '').localeCompare(String(b.title ?? ''));
    });
  }

  const b15 = sortEntries(await buildEntries(best50.b15));
  const b35 = sortEntries(await buildEntries(best50.b35));

  const b15Rows   = Math.ceil(b15.length / COLUMNS);
  const b35Rows   = Math.ceil(b35.length / COLUMNS);
  const b15BlockH = b15Rows > 0 ? b15Rows * CARD_H + (b15Rows - 1) * CARD_GAP : 0;
  const b35BlockH = b35Rows > 0 ? b35Rows * CARD_H + (b35Rows - 1) * CARD_GAP : 0;

  const totalH = PLAYER_H + GAP
               + SECTION_H + GAP + b15BlockH
               + SECTION_GAP
               + SECTION_H + GAP + b35BlockH
               + BOTTOM_PAD;

  const canvas = new Canvas(W, totalH);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, v, totalH);
  await drawPlayerHeader(ctx, account, v);

  let cy = PLAYER_H + GAP;

  // B15
  await drawSectionBar(ctx, cy, 'new', b15);
  cy += SECTION_H + GAP;
  for (let i = 0; i < b15.length; i++) {
    const col = i % COLUMNS, row = Math.floor(i / COLUMNS);
    await drawSongCard(ctx, b15[i], MARGIN + col * (CARD_W + CARD_GAP), cy + row * (CARD_H + CARD_GAP), v);
  }
  cy += b15BlockH + SECTION_GAP;

  // B35
  await drawSectionBar(ctx, cy, 'old', b35);
  cy += SECTION_H + GAP;
  for (let i = 0; i < b35.length; i++) {
    const col = i % COLUMNS, row = Math.floor(i / COLUMNS);
    await drawSongCard(ctx, b35[i], MARGIN + col * (CARD_W + CARD_GAP), cy + row * (CARD_H + CARD_GAP), v);
  }

  // Watermark
  ctx.save();
  ctx.font = `500 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(`Generated ${new Date().toLocaleString('en-GB')} • maimai Favorite Bot`, W - MARGIN, totalH - 12);
  ctx.restore();

  const slug = String(account?.player?.name || 'account').trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'account';
  return { buffer: await canvas.toBuffer('png'), fileName: `${slug}-b50.png` };
}
