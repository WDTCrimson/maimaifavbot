import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';
import { drawMaiDeckWatermark } from './graphic-watermark.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const TOMOMAI    = join(process.cwd(), 'data', 'assets', 'tomomai', 'res');
const THEME_DIR  = join(process.cwd(), 'data', 'theme', 'tomomai');
const DANI_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'dani');
const RANK_ASSET = join(process.cwd(), 'data', 'assets', 'dxrating', 'rank', 'circle-plus');

// ─── Layout ───────────────────────────────────────────────────────────────────

const W            = 1200;
const MARGIN       = 36;
const IW           = W - MARGIN * 2;
const PLAYER_H     = 160;
const DIFF_BAR_H   = 44;
const LEVEL_H      = 44;
const CARD_SZ      = 108;
const CARD_GAP     = 10;
const RANK_COL     = 68;
const CARD_START   = MARGIN + RANK_COL;
const CARD_AREA_W  = IW - RANK_COL;
const CARDS_PER_ROW = Math.floor((CARD_AREA_W + CARD_GAP) / (CARD_SZ + CARD_GAP));
const ROW_PAD_V    = 10;
const SECTION_GAP  = 20;
const GAP          = 8;
const BOTTOM_PAD   = 40;

const FONT      = 'Inter, Murecho, "Noto Sans JP", sans-serif';
const FONT_MONO = '"Geist Mono", monospace';

// ─── Difficulty meta ──────────────────────────────────────────────────────────

const DIFF_COLOR = {
  basic: '#22c55e', advanced: '#f97316', expert: '#ef4444',
  master: '#a855f7', remaster: '#e879f9',
};

const DIFF_LABEL = {
  basic: 'BASIC', advanced: 'ADVANCED', expert: 'EXPERT',
  master: 'MASTER', remaster: 'Re:MASTER',
};

// ─── Rank tiers ───────────────────────────────────────────────────────────────

const RANK_TIERS = [
  { name: 'SSS+', min: 1005000, color: '#FFD700' },
  { name: 'SSS',  min: 1000000, color: '#FFC000' },
  { name: 'SS+',  min:  995000, color: '#E8D060' },
  { name: 'SS',   min:  990000, color: '#D0D0D0' },
  { name: 'S+',   min:  980000, color: '#B8B8C8' },
  { name: 'S',    min:  970000, color: '#A0A0A0' },
  { name: 'AAA',  min:  940000, color: '#88AAFF' },
  { name: 'AA',   min:  900000, color: '#6688EE' },
  { name: 'A',    min:  800000, color: '#55AA66' },
  { name: 'BBB',  min:  750000, color: '#888888' },
  { name: 'BB',   min:  700000, color: '#777777' },
  { name: 'B',    min:  600000, color: '#666666' },
  { name: 'C',    min:  500000, color: '#555555' },
  { name: 'D',    min:       0, color: '#444444' },
];

// ─── Version settings (for background character) ──────────────────────────────

const VERSION_SETTINGS = {
  10: { charScale: 0.56, charLeft: 620, charTop: -100 },
  11: { charScale: 0.70, charLeft: 680, charTop: -100 },
  12: { charScale: 0.60, charLeft: 660, charTop: -30  },
  13: { charScale: 0.65, charLeft: 660, charTop: -30  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function resolveSongImagePath(song) {
  if (song?.jacket?.dxratingFile)
    return join(process.cwd(), 'data', 'assets', 'jacket', 'dxrating', song.jacket.dxratingFile);
  if (song?.jacket?.otogeFile)
    return join(process.cwd(), 'data', 'assets', 'jacket', 'otoge-db', song.jacket.otogeFile);
  return null;
}

function resolveFcBadgePath(v, fc) {
  return join(TOMOMAI, 'badge', String(v), `${String(fc || 'none').toLowerCase()}.png`);
}

function resolveFsBadgePath(v, fs) {
  return join(TOMOMAI, 'badge', String(v), `${String(fs || 'none').toLowerCase()}.png`);
}

function getRankTier(achievement) {
  const a = Number(achievement) || 0;
  return RANK_TIERS.find(t => a >= t.min) ?? RANK_TIERS[RANK_TIERS.length - 1];
}

function getRankIconPath(achievement) {
  const a = Number(achievement) || 0;
  if (a >= 1005000) return join(RANK_ASSET, 'sssp.png');
  if (a >= 1000000) return join(RANK_ASSET, 'sss.png');
  if (a >=  995000) return join(RANK_ASSET, 'ssp.png');
  if (a >=  990000) return join(RANK_ASSET, 'ss.png');
  if (a >=  980000) return join(RANK_ASSET, 'sp.png');
  if (a >=  970000) return join(RANK_ASSET, 's.png');
  if (a >=  940000) return join(RANK_ASSET, 'aaa.png');
  if (a >=  900000) return join(RANK_ASSET, 'aa.png');
  if (a >=  800000) return join(RANK_ASSET, 'a.png');
  if (a >=  750000) return join(RANK_ASSET, 'bbb.png');
  if (a >=  700000) return join(RANK_ASSET, 'bb.png');
  if (a >=  600000) return join(RANK_ASSET, 'b.png');
  if (a >=  500000) return join(RANK_ASSET, 'c.png');
  return join(RANK_ASSET, 'd.png');
}

function parseLevelBracket(bracket) {
  const isPlus = String(bracket).endsWith('+');
  const base = parseInt(bracket, 10);
  if (isPlus) return v => v >= base + 0.6 - 0.001 && v < base + 1.0;
  return v => v >= base - 0.001 && v < base + 0.6;
}

function rankRowHeight(cardCount) {
  const rows = Math.ceil(cardCount / CARDS_PER_ROW);
  return ROW_PAD_V + rows * CARD_SZ + (rows - 1) * CARD_GAP + ROW_PAD_V;
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

  const vs = VERSION_SETTINGS[v] || VERSION_SETTINGS[13];
  const charImg = await loadCached(join(THEME_DIR, `character-${v}.png`));
  if (charImg) {
    ctx.save();
    ctx.globalAlpha = 0.90;
    ctx.drawImage(charImg, vs.charLeft, vs.charTop, charImg.width * vs.charScale, charImg.height * vs.charScale);
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
  const classRankUrl    = account?.extra?.classRankUrl ?? null;
  const iconUrl = account?.extra?.iconUrl || account?.player?.iconUrl || null;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, PLAYER_H);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, PLAYER_H - 1, W, 1);

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

  // Right cluster: logo → class rank → dani → rating frame
  let rx = W - 22;

  const logoImg = await loadCached(join(THEME_DIR, `logo-${v}.png`));
  if (logoImg) {
    const lh = 54, lw = logoImg.width * (lh / logoImg.height);
    rx -= lw;
    ctx.drawImage(logoImg, rx, (PLAYER_H - lh) / 2, lw, lh);
    rx -= 16;
  }

  if (classRankUrl) {
    const ci = await loadCached(classRankUrl);
    if (ci) {
      const ch = 48, cw = ci.width * (ch / ci.height);
      rx -= cw;
      ctx.drawImage(ci, rx, (PLAYER_H - ch) / 2, cw, ch);
      rx -= 14;
    }
  }

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

// ─── Difficulty bar ───────────────────────────────────────────────────────────

function drawDiffBar(ctx, y, difficulty, count) {
  const color = DIFF_COLOR[difficulty] || '#888';
  const label = DIFF_LABEL[difficulty] || difficulty.toUpperCase();

  ctx.fillStyle = 'rgba(0,0,0,0.50)';
  ctx.fillRect(0, y, W, DIFF_BAR_H);
  ctx.fillStyle = color;
  ctx.fillRect(0, y, 4, DIFF_BAR_H);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, y + DIFF_BAR_H - 1, W, 1);

  ctx.save();
  ctx.font = `700 18px ${FONT}`; ctx.fillStyle = color;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(label, MARGIN + 12, y + DIFF_BAR_H / 2);

  ctx.font = `500 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.textAlign = 'right';
  ctx.fillText(`${count} song${count !== 1 ? 's' : ''}`, W - MARGIN, y + DIFF_BAR_H / 2);
  ctx.restore();
}

// ─── Level section header ─────────────────────────────────────────────────────

function drawLevelHeader(ctx, y, levelKey, count) {
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, y, W, LEVEL_H);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, y + LEVEL_H - 1, W, 1);

  ctx.save();
  ctx.font = `700 20px ${FONT_MONO}`; ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(levelKey, MARGIN, y + LEVEL_H / 2);

  ctx.font = `500 12px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.textAlign = 'right';
  ctx.fillText(`${count} song${count !== 1 ? 's' : ''}`, W - MARGIN, y + LEVEL_H / 2);
  ctx.restore();
}

// ─── Song card ────────────────────────────────────────────────────────────────

async function drawCard(ctx, entry, x, y, v) {
  const diff  = String(entry.difficulty || 'master').toLowerCase();
  const color = DIFF_COLOR[diff] || '#888';

  const jacketImg = entry.imagePath ? await loadCached(entry.imagePath) : null;
  ctx.save();
  rr(ctx, x, y, CARD_SZ, CARD_SZ, 8); ctx.clip();
  if (jacketImg) {
    const ratio = Math.max(CARD_SZ / jacketImg.width, CARD_SZ / jacketImg.height);
    const dw = jacketImg.width * ratio, dh = jacketImg.height * ratio;
    ctx.drawImage(jacketImg, x + (CARD_SZ - dw) / 2, y + (CARD_SZ - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = '#2a1640'; ctx.fillRect(x, y, CARD_SZ, CARD_SZ);
  }
  ctx.restore();

  ctx.save();
  rr(ctx, x, y, CARD_SZ, CARD_SZ, 8); ctx.clip();
  const grad = ctx.createLinearGradient(0, y, 0, y + CARD_SZ);
  grad.addColorStop(0,    'rgba(0,0,0,0.00)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.15)');
  grad.addColorStop(1,    'rgba(0,0,0,0.80)');
  ctx.fillStyle = grad; ctx.fillRect(x, y, CARD_SZ, CARD_SZ);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.60;
  rr(ctx, x, y, CARD_SZ, CARD_SZ, 8); ctx.stroke();
  ctx.restore();

  // DX / STD badge top-left
  const isDx = String(entry.type || '').toLowerCase() === 'dx';
  const typeBadge = await loadCached(
    join(process.cwd(), 'data', 'assets', 'logo', 'otoge-db', isDx ? 'chart_badge_dx.png' : 'chart_badge_std.png')
  );
  if (typeBadge) {
    const th = 16, tw = typeBadge.width * (th / typeBadge.height);
    ctx.drawImage(typeBadge, x + 6, y + 6, tw, th);
  }

  // FC / FS badges middle-left
  const fcBadge = entry.fc ? await loadCached(resolveFcBadgePath(v, entry.fc)) : null;
  const fsBadge = entry.fs ? await loadCached(resolveFsBadgePath(v, entry.fs)) : null;
  const bs = 0.48, badgeY = y + CARD_SZ / 2 - 10;
  let badgeX = x + 6;
  if (fcBadge) { ctx.drawImage(fcBadge, badgeX, badgeY, fcBadge.width * bs, fcBadge.height * bs); badgeX += fcBadge.width * bs - 2; }
  if (fsBadge) { ctx.drawImage(fsBadge, badgeX, badgeY, fsBadge.width * bs, fsBadge.height * bs); }

  // Achievement bottom
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 6;
  ctx.font = `600 12px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
  ctx.fillText(formatAchievement(entry.achievement), x + 6, y + CARD_SZ - 5);
  ctx.restore();
}

// ─── Rank row ─────────────────────────────────────────────────────────────────

async function drawRankRow(ctx, y, tier, cards, v) {
  const rowH = rankRowHeight(cards.length);

  // Rank image — centered horizontally in RANK_COL, aligned to top of first card row
  const rankImg = await loadCached(getRankIconPath(tier.min));
  if (rankImg) {
    const rh = 24, rw = rankImg.width * (rh / rankImg.height);
    const rx = MARGIN + (RANK_COL - rw) / 2;
    const ry = y + ROW_PAD_V + (CARD_SZ - rh) / 2;
    ctx.drawImage(rankImg, rx, ry, rw, rh);
  } else {
    ctx.save();
    ctx.font = `700 12px ${FONT}`; ctx.fillStyle = tier.color;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(tier.name, MARGIN + RANK_COL / 2, y + ROW_PAD_V + CARD_SZ / 2);
    ctx.restore();
  }

  // Cards
  await Promise.all(cards.map(async (entry, i) => {
    const col = i % CARDS_PER_ROW;
    const row = Math.floor(i / CARDS_PER_ROW);
    const cx = CARD_START + col * (CARD_SZ + CARD_GAP);
    const cy = y + ROW_PAD_V + row * (CARD_SZ + CARD_GAP);
    await drawCard(ctx, entry, cx, cy, v);
  }));

  return rowH;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderLevelSummaryGraphic({ account, scores, difficulty, levelBracket, songCatalog }) {
  await registerFonts();

  const gameVersion = Number(account?.gameVersion) || 13;
  const v = Math.min(Math.max(Math.floor(gameVersion), 10), 13);

  const inBracket = parseLevelBracket(levelBracket);
  const diff = String(difficulty || 'master').toLowerCase();

  // Filter scores to this difficulty + level bracket and enrich with jacket paths
  const filtered = scores
    .filter(s => {
      const d = String(s.difficulty || '').toLowerCase();
      const ilv = Number(s.internalLevelValue);
      return d === diff && Number.isFinite(ilv) && inBracket(ilv);
    })
    .map(s => {
      const song = s.favoriteId
        ? songCatalog.getByFavoriteId(s.favoriteId)
        : songCatalog.getByTitle?.(s.title);
      return { ...s, imagePath: resolveSongImagePath(song) };
    });

  if (filtered.length === 0) {
    const label = DIFF_LABEL[diff] || diff.toUpperCase();
    throw new Error(`No ${label} scores found for level ${levelBracket}. Make sure your account is synced.`);
  }

  // Group by internal level descending, then by rank tier within each level
  const byLevel = new Map();
  for (const entry of filtered) {
    const levelKey = Number(entry.internalLevelValue).toFixed(1);
    if (!byLevel.has(levelKey)) byLevel.set(levelKey, []);
    byLevel.get(levelKey).push(entry);
  }

  const sortedLevels = [...byLevel.keys()].sort((a, b) => Number(b) - Number(a));
  const tierOrder = RANK_TIERS.map(t => t.name);

  const sections = sortedLevels.map(levelKey => {
    const entries = byLevel.get(levelKey);
    const byRank = new Map();
    for (const entry of entries) {
      const tierName = getRankTier(entry.achievement).name;
      if (!byRank.has(tierName)) byRank.set(tierName, []);
      byRank.get(tierName).push(entry);
    }
    const sortedTiers = [...byRank.keys()]
      .sort((a, b) => tierOrder.indexOf(a) - tierOrder.indexOf(b))
      .map(name => ({
        tier: RANK_TIERS.find(t => t.name === name),
        cards: byRank.get(name).sort((a, b) => Number(b.achievement) - Number(a.achievement)),
      }));
    return { levelKey, sortedTiers };
  });

  // Compute total canvas height
  const contentH = sections.reduce((sum, { sortedTiers }, i) => {
    const sectionH = LEVEL_H + sortedTiers.reduce((s, { cards }) => s + rankRowHeight(cards.length), 0);
    return sum + sectionH + (i < sections.length - 1 ? SECTION_GAP : 0);
  }, 0);
  const totalH = PLAYER_H + DIFF_BAR_H + GAP + contentH + BOTTOM_PAD;

  const canvas = new Canvas(W, totalH);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, v, totalH);
  await drawPlayerHeader(ctx, account, v);

  let cy = PLAYER_H;
  drawDiffBar(ctx, cy, diff, filtered.length);
  cy += DIFF_BAR_H + GAP;

  for (let si = 0; si < sections.length; si++) {
    const { levelKey, sortedTiers } = sections[si];
    const totalInSection = sortedTiers.reduce((sum, { cards }) => sum + cards.length, 0);

    drawLevelHeader(ctx, cy, levelKey, totalInSection);
    cy += LEVEL_H;

    for (const { tier, cards } of sortedTiers) {
      await drawRankRow(ctx, cy, tier, cards, v);
      cy += rankRowHeight(cards.length);
    }

    if (si < sections.length - 1) cy += SECTION_GAP;
  }

  drawMaiDeckWatermark(ctx, { width: W, height: totalH, fontFamily: FONT });

  const slug = String(account?.player?.name || 'account').trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'account';
  const bracketSlug = String(levelBracket).replace('+', 'plus');
  return { buffer: await canvas.toBuffer('png'), fileName: `${slug}-level-${bracketSlug}-${diff}.png` };
}
