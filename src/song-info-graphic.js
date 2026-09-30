import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';
import { drawMaiDeckWatermark } from './graphic-watermark.js';
import { calculateChartRating, getCurrentIntlVersionId } from './maimai-intl.js';

const W = 1000;
const MARGIN = 26;
const HEADER_H = 400;
const ROW_H = 225;
const GAP = 22;
const BOTTOM_PAD = 42;
const FONT = 'Inter, Murecho, "Noto Sans JP", sans-serif';

const TOMOMAI = join(process.cwd(), 'data', 'assets', 'tomomai', 'res');
const THEME_DIR = join(process.cwd(), 'data', 'theme', 'tomomai');
const VERSION_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'version');
const CATEGORY_ASSET = join(process.cwd(), 'data', 'assets', 'maimai-ui', 'category');

const DIFFICULTIES = ['basic', 'advanced', 'expert', 'master', 'remaster', 'utage'];
const DIFF_COLOR = {
  basic: '#20bf6b', advanced: '#ff9f1c', expert: '#ff3f61',
  master: '#9238e6', remaster: '#d991ff', utage: '#ef5b9c'
};
const DIFF_LABEL = {
  basic: 'BASIC', advanced: 'ADVANCED', expert: 'EXPERT',
  master: 'MASTER', remaster: 'Re:MASTER', utage: 'U·TA·GE'
};
const IMAGE_CACHE = new Map();
let fontsReady = false;

const VERSION_SETTINGS = {
  10: { charScale: 0.47, charLeft: 515, charTop: -84 },
  11: { charScale: 0.58, charLeft: 565, charTop: -84 },
  12: { charScale: 0.50, charLeft: 550, charTop: -25 },
  13: { charScale: 0.54, charLeft: 550, charTop: -25 },
  14: { charScale: 0.83, charLeft: 585, charTop: -67 }
};

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function image(path) {
  if (!path) return null;
  if (!IMAGE_CACHE.has(path)) {
    IMAGE_CACHE.set(path, (async () => {
      try { return await exists(path) ? await loadImage(path) : null; } catch { return null; }
    })());
  }
  return IMAGE_CACHE.get(path);
}

async function registerFonts() {
  if (fontsReady) return;
  for (const [family, file] of [
    ['Inter', 'Inter-VariableFont_opsz,wght.woff2'],
    ['Murecho', 'Murecho-VariableFont_wght.woff2'],
    ['Noto Sans JP', 'NotoSansJP-VariableFont_wght.woff2']
  ]) {
    const path = join(TOMOMAI, 'fonts', file);
    if (await exists(path)) FontLibrary.use(family, [path]);
  }
  fontsReady = true;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fitText(ctx, value, maxWidth) {
  const text = String(value || '');
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
  return `${clipped}…`;
}

function cover(ctx, source, x, y, w, h) {
  if (!source) return;
  const scale = Math.max(w / source.width, h / source.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (source.width - sw) / 2;
  const sy = (source.height - sh) / 2;
  ctx.drawImage(source, sx, sy, sw, sh, x, y, w, h);
}

function resolveJacket(song) {
  if (song?.jacket?.dxratingFile) return join(process.cwd(), 'data', 'assets', 'jacket', 'dxrating', song.jacket.dxratingFile);
  if (song?.jacket?.otogeFile) return join(process.cwd(), 'data', 'assets', 'jacket', 'otoge-db', song.jacket.otogeFile);
  return null;
}

export function resolveSongInfoVersion(version) {
  const value = String(version || '').normalize('NFKC').toLowerCase();
  if (value.includes('magical')) return { themeNumber: 14, logoFile: '14.png' };
  if (value.includes('circle') && value.includes('plus')) return { themeNumber: 13, logoFile: '13.png' };
  if (value.includes('circle')) return { themeNumber: 12, logoFile: '12.png' };
  if (value.includes('prism') && value.includes('plus')) return { themeNumber: 11, logoFile: '11.png' };
  if (value.includes('prism')) return { themeNumber: 10, logoFile: '10.png' };
  return { themeNumber: null, logoFile: null };
}

export function songInfoVersionFile(version) {
  if (!version) return null;
  const raw = String(version).normalize('NFKC').toLowerCase().trim();
  const exactAlias = {
    'maimaiでらっくす': 'maimai_deluxe',
    'maimaiでらっくす plus': 'maimai_deluxe_plus',
    'maimai dx': 'maimai_deluxe',
    'maimai dx plus': 'maimai_deluxe_plus'
  };
  if (exactAlias[raw]) return `${exactAlias[raw]}.png`;

  const normalized = raw
    .replace(/maimaiでらっくす/g, 'maimai_deluxe')
    .replace(/でらっくす/g, 'deluxe')
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const alias = {
    maimai_dx: 'maimai_deluxe',
    maimai_dx_plus: 'maimai_deluxe_plus'
  };
  return normalized ? `${alias[normalized] || normalized}.png` : null;
}

function categoryFile(category) {
  const value = String(category || '').normalize('NFKC').toLowerCase();
  if (value.includes('original') || value === 'maimai') return 'category_original.png';
  if (value.includes('pops') || value.includes('anime') || value.includes('アニメ')) return 'category_popsanime.png';
  if (value.includes('niconico') || value.includes('vocaloid') || value.includes('ボーカロイド')) return 'category_niconico.png';
  if (value.includes('touhou') || value.includes('東方')) return 'category_touhou.png';
  if (value.includes('chunithm') || value.includes('ongeki') || value.includes('オンゲキ')) return 'category_chugeki.png';
  return 'category_variety.png';
}

function chartOrder(chart) {
  const difficulty = DIFFICULTIES.indexOf(String(chart?.difficulty || '').toLowerCase());
  const type = String(chart?.type || '').toLowerCase() === 'dx' ? 0 : 1;
  return (difficulty < 0 ? 99 : difficulty) * 2 + type;
}

function normalizeCharts(song, chartFacts = null) {
  return [...(song?.difficultyLevels || [])]
    .filter((chart) => chart?.level || Number.isFinite(Number(chart?.internalLevelValue)))
    .map((chart) => ({
      ...chart,
      patternLabels: chartFacts?.available
        ? chartFacts.tagsFor(song, chart).map((tag) => chartFacts.labelFor(tag))
        : chartFacts ? [chartFacts.unavailableMessage()] : []
    }))
    .sort((a, b) => chartOrder(a) - chartOrder(b));
}

function formatConstant(chart) {
  const value = Number(chart?.internalLevelValue);
  if (Number.isFinite(value)) return value.toFixed(1);
  return String(chart?.level || '?');
}

function dxThresholds(totalNotes) {
  const maximum = Number(totalNotes) * 3;
  if (!Number.isFinite(maximum) || maximum <= 0) return [];
  return [
    ['★7', 1], ['★6', 0.99], ['★5.5', 0.98], ['★5', 0.97],
    ['★4', 0.95], ['★3', 0.93], ['★2', 0.90], ['★1', 0.85]
  ].map(([label, ratio]) => ({ label, value: Math.ceil(maximum * ratio) }));
}

function regions(song) {
  return [
    song?.regions?.jp ? 'JP' : null,
    song?.regions?.intl ? 'INTL' : null,
    song?.regions?.usa ? 'USA' : null,
    song?.regions?.cn ? 'CN' : null
  ].filter(Boolean);
}

function sanitize(value) {
  return String(value || 'song').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'song';
}

async function drawBackground(ctx, totalH, gameVersion) {
  const themeNumber = Math.min(Math.max(Math.floor(Number(gameVersion) || 13), 10), 14);
  const background = await image(join(TOMOMAI, 'bg', `${themeNumber}.png`));
  if (background) {
    const tileH = Math.round(background.height * (W / background.width));
    for (let y = 0; y < totalH; y += tileH) {
      ctx.drawImage(background, 0, y, W, tileH);
    }
  }
  else {
    const gradient = ctx.createLinearGradient(0, 0, W, totalH);
    gradient.addColorStop(0, '#2b0b35');
    gradient.addColorStop(1, '#081a38');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, totalH);
  }

  const character = await image(join(THEME_DIR, `character-${themeNumber}.png`));
  const settings = VERSION_SETTINGS[themeNumber] || VERSION_SETTINGS[13];
  if (character) {
    ctx.save();
    ctx.globalAlpha = 0.90;
    ctx.drawImage(
      character,
      settings.charLeft,
      settings.charTop,
      character.width * settings.charScale,
      character.height * settings.charScale
    );
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, totalH);
}

async function drawHeader(ctx, song, charts, y, jacket, version) {
  const x = MARGIN;
  const width = W - MARGIN * 2;
  ctx.save();
  roundRect(ctx, x, y, width, HEADER_H, 34);
  ctx.clip();
  ctx.fillStyle = 'rgba(17, 17, 31, 0.91)';
  ctx.fillRect(x, y, width, HEADER_H);

  const jacketSize = HEADER_H;
  if (jacket) cover(ctx, jacket, x, y, jacketSize, jacketSize);
  else {
    const placeholder = ctx.createLinearGradient(x, y, x + jacketSize, y + jacketSize);
    placeholder.addColorStop(0, '#6d2850');
    placeholder.addColorStop(1, '#261422');
    ctx.fillStyle = placeholder;
    ctx.fillRect(x, y, jacketSize, jacketSize);
  }

  const infoX = x + jacketSize + 28;
  const infoW = width - jacketSize - 52;
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 39px ${FONT}`;
  ctx.fillText(fitText(ctx, song.title, infoW), infoX, y + 94);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(fitText(ctx, song.artist || 'Unknown artist', infoW), infoX, y + 128);

  ctx.fillStyle = 'rgba(255,255,255,0.68)';
  ctx.font = `600 17px ${FONT}`;
  ctx.fillText('BPM', infoX, y + 176);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 27px ${FONT}`;
  ctx.fillText(String(song.bpm ?? '—'), infoX, y + 205);

  const designers = [...new Set(charts.map((chart) => String(chart.noteDesigner || '').trim()).filter((value) => value && value !== '-'))];
  ctx.fillStyle = 'rgba(255,255,255,0.68)';
  ctx.font = `600 17px ${FONT}`;
  ctx.fillText('NOTES DESIGNER', infoX, y + 248);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 19px ${FONT}`;
  ctx.fillText(fitText(ctx, designers.join(' · ') || 'Not listed', infoW), infoX, y + 276);

  let pillX = infoX;
  for (const label of regions(song)) {
    ctx.font = `800 14px ${FONT}`;
    const pillW = ctx.measureText(label).width + 22;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, pillX, y + 302, pillW, 29, 14);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, pillX + 11, y + 322);
    pillX += pillW + 8;
  }

  const alias = song.displayAliases?.[0] || song.aliases?.[0] || null;
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = `500 15px ${FONT}`;
  ctx.fillText(fitText(ctx, alias ? `Alias: ${alias}` : `Category: ${song.category || 'Unknown'}`, infoW), infoX, y + 363);
  ctx.restore();

  const category = await image(join(CATEGORY_ASSET, categoryFile(song.category)));
  if (category) {
    const scale = Math.min(155 / category.width, 48 / category.height);
    ctx.drawImage(category, x + width - category.width * scale - 18, y + 18, category.width * scale, category.height * scale);
  }
  const logoName = resolveSongInfoVersion(version).logoFile;
  const legacyLogoName = songInfoVersionFile(version);
  const logo = logoName
    ? await image(join(TOMOMAI, 'logo', logoName))
    : legacyLogoName
      ? await image(join(VERSION_ASSET, legacyLogoName))
      : null;
  if (logo) {
    const scale = Math.min(185 / logo.width, 82 / logo.height);
    ctx.drawImage(logo, x + width - logo.width * scale - 18, y + HEADER_H - logo.height * scale - 16, logo.width * scale, logo.height * scale);
  }
}

function drawChartRow(ctx, chart, y, gameVersion) {
  const x = MARGIN;
  const width = W - MARGIN * 2;
  const leftW = 245;
  const difficulty = String(chart.difficulty || '').toLowerCase();
  const color = DIFF_COLOR[difficulty] || '#64748b';

  ctx.save();
  roundRect(ctx, x, y, width, ROW_H, 32);
  ctx.clip();
  ctx.fillStyle = 'rgba(18, 17, 31, 0.89)';
  ctx.fillRect(x, y, width, ROW_H);

  ctx.fillStyle = 'rgba(5,8,18,0.67)';
  roundRect(ctx, x + 28, y + 76, 102, 61, 15);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 33px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(formatConstant(chart), x + 79, y + 117);

  const typeLabel = String(chart.type || '').toLowerCase() === 'dx' ? 'DX' : 'STD';
  ctx.fillStyle = 'rgba(5,8,18,0.67)';
  roundRect(ctx, x + 143, y + 82, 72, 31, 15);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 15px ${FONT}`;
  ctx.fillText(typeLabel, x + 179, y + 103);

  const rating = calculateChartRating({
    achievement: 1_005_000,
    fc: null,
    internalLevelValue: Number(chart.internalLevelValue) || Number.parseFloat(chart.level) || 0,
    gameVersion
  });
  ctx.fillStyle = 'rgba(5,8,18,0.67)';
  roundRect(ctx, x + 28, y + 146, 187, 32, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText(`SSS+ RATING  »  ${rating}`, x + 121.5, y + 168);
  ctx.textAlign = 'left';

  const bodyX = x + leftW + 16;
  const bodyW = width - leftW - 32;
  ctx.fillStyle = 'rgba(4,7,16,0.72)';
  roundRect(ctx, bodyX, y + 18, bodyW, 74, 16);
  ctx.fill();
  const fadeStart = x + leftW - 64;
  const fadeEnd = bodyX - 10;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, fadeStart - x, 62);
  const railFade = ctx.createLinearGradient(fadeStart, y, fadeEnd, y);
  railFade.addColorStop(0, color);
  railFade.addColorStop(0.45, `${color}e8`);
  railFade.addColorStop(1, `${color}00`);
  ctx.fillStyle = railFade;
  ctx.fillRect(fadeStart, y, fadeEnd - fadeStart, 62);
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 29px ${FONT}`;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 3;
  ctx.fillText(DIFF_LABEL[difficulty] || difficulty.toUpperCase(), x + 25, y + 41);
  ctx.shadowBlur = 0;
  const notes = chart.noteCounts || {};
  const noteItems = [
    ['Total Notes', notes.total], ['Tap', notes.tap], ['Hold', notes.hold],
    ['Slide', notes.slide], ['Touch', notes.touch], ['Break', notes.break]
  ];
  const columnW = bodyW / noteItems.length;
  ctx.textAlign = 'center';
  noteItems.forEach(([label, value], index) => {
    const cx = bodyX + columnW * index + columnW / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = `700 15px ${FONT}`;
    ctx.fillText(label, cx, y + 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 24px ${FONT}`;
    ctx.fillText(Number.isFinite(Number(value)) ? String(value) : '—', cx, y + 76);
  });

  ctx.fillStyle = 'rgba(4,7,16,0.72)';
  roundRect(ctx, bodyX, y + 105, bodyW, 67, 16);
  ctx.fill();
  const thresholds = dxThresholds(notes.total);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#35d052';
  ctx.font = `900 18px ${FONT}`;
  ctx.fillText('DX SCORE', bodyX + 15, y + 145);
  if (thresholds.length) {
    const startX = bodyX + 130;
    const thresholdW = (bodyW - 140) / thresholds.length;
    ctx.textAlign = 'center';
    thresholds.forEach((threshold, index) => {
      const cx = startX + thresholdW * index + thresholdW / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.84)';
      ctx.font = `700 14px ${FONT}`;
      ctx.fillText(threshold.label, cx, y + 132);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 20px ${FONT}`;
      ctx.fillText(String(threshold.value), cx, y + 158);
    });
  } else {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText('Thresholds unavailable', bodyX + 132, y + 145);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `600 15px ${FONT}`;
  const patterns = Array.isArray(chart.patternLabels) && chart.patternLabels.length
    ? chart.patternLabels.join(' · ')
    : 'None listed';
  ctx.fillText(fitText(ctx, `Patterns: ${patterns}`, width - 56), x + 28, y + 207);
  ctx.restore();
}

export async function renderSongInfoGraphic({ song, chartFacts = null }) {
  await registerFonts();
  const charts = normalizeCharts(song, chartFacts);
  if (!song || !charts.length) throw new Error('No chart metadata to render.');

  const version = charts.find((chart) => chart.version)?.version || null;
  const gameVersion = getCurrentIntlVersionId() ?? 13;
  const totalH = MARGIN + HEADER_H + GAP + charts.length * ROW_H + Math.max(0, charts.length - 1) * GAP + BOTTOM_PAD;
  const canvas = new Canvas(W, totalH);
  const ctx = canvas.getContext('2d');
  const jacket = await image(resolveJacket(song));

  await drawBackground(ctx, totalH, gameVersion);
  await drawHeader(ctx, song, charts, MARGIN, jacket, version);
  let y = MARGIN + HEADER_H + GAP;
  for (const chart of charts) {
    drawChartRow(ctx, chart, y, gameVersion);
    y += ROW_H + GAP;
  }
  drawMaiDeckWatermark(ctx, { width: W, height: totalH, fontFamily: FONT });

  return {
    buffer: await canvas.toBuffer('png'),
    fileName: `${sanitize(song.title)}-info.png`,
    chartCount: charts.length
  };
}
