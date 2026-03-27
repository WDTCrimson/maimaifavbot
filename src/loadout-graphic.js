import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

function escapeXml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function trimText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function levelToNumber(value) {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number.parseFloat(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : -1;
}

function formatInternal(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toFixed(1) : String(value);
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return '?';
  }
  if (/^-?\d+$/.test(text)) {
    return `${text}.0`;
  }
  return text;
}

function buildDifficultyLines(song) {
  const order = ['basic', 'advanced', 'expert', 'master', 'remaster'];
  const labels = {
    basic: 'BSC',
    advanced: 'ADV',
    expert: 'EXP',
    master: 'MAS',
    remaster: 'ReM'
  };

  const byDifficulty = new Map(order.map((difficulty) => [difficulty, null]));
  const charts = Array.isArray(song.difficultyLevels) ? song.difficultyLevels : [];

  for (const chart of charts) {
    const difficulty = String(chart.difficulty || '').toLowerCase();
    if (!byDifficulty.has(difficulty) || !chart.level) {
      continue;
    }

    const existing = byDifficulty.get(difficulty);
    if (!existing || levelToNumber(chart.internalLevelValue) > levelToNumber(existing.internalLevelValue)) {
      byDifficulty.set(difficulty, chart);
    }
  }

  const lines = [];
  for (const difficulty of order) {
    const chart = byDifficulty.get(difficulty);
    if (!chart) {
      continue;
    }
    lines.push(
      `${labels[difficulty]}  Lvl ${chart.level} [${formatInternal(chart.internalLevelValue)}]`
    );
  }

  if (!lines.length) {
    return ['No chart data'];
  }

  return lines.slice(0, 5);
}

function getPrimaryVersion(song) {
  const charts = Array.isArray(song.difficultyLevels) ? song.difficultyLevels : [];
  const withVersion = charts.filter((chart) => chart.version).map((chart) => chart.version);
  if (!withVersion.length) {
    return null;
  }
  return withVersion[withVersion.length - 1];
}

async function fileExists(path) {
  try {
    const fileStat = await stat(path);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function getSongImageDataUri(song) {
  const candidates = [
    song?.jacket?.dxratingFile
      ? join(process.cwd(), 'data', 'assets', 'jacket', 'dxrating', song.jacket.dxratingFile)
      : null,
    song?.jacket?.otogeFile
      ? join(process.cwd(), 'data', 'assets', 'jacket', 'otoge-db', song.jacket.otogeFile)
      : null
  ].filter(Boolean);

  for (const path of candidates) {
    if (!(await fileExists(path))) {
      continue;
    }

    const ext = extname(path).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const buffer = await readFile(path);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }

  return null;
}

function sanitizeFileName(text) {
  const value = String(text || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return value || 'loadout';
}

export async function renderLoadoutGraphic({ loadoutName, songs }) {
  const cards = await Promise.all(
    songs.map(async (song) => ({
      title: song?.title || 'Unknown Song',
      artist: song?.artist || 'Unknown Artist',
      lines: buildDifficultyLines(song || {}),
      version: getPrimaryVersion(song || {}),
      imageDataUri: await getSongImageDataUri(song || {})
    }))
  );

  const cardCount = cards.length;
  const columns = cardCount <= 8 ? 2 : cardCount <= 18 ? 3 : 4;
  const cardWidth = 360;
  const cardHeight = 170;
  const gap = 16;
  const margin = 24;
  const headerHeight = 120;
  const rows = Math.max(1, Math.ceil(cardCount / columns));
  const width = margin * 2 + columns * cardWidth + (columns - 1) * gap;
  const height = headerHeight + margin + rows * cardHeight + (rows - 1) * gap + margin;

  const dateText = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date());

  const cardSvg = cards
    .map((card, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + col * (cardWidth + gap);
      const y = headerHeight + margin + row * (cardHeight + gap);

      const textX = x + 122;
      const lineStartY = y + 78;

      const lineSvg = card.lines
        .map(
          (line, lineIndex) =>
            `<text x="${textX}" y="${lineStartY + lineIndex * 20}" fill="#f1e6ff" font-size="16" font-family="Arial, sans-serif">${escapeXml(line)}</text>`
        )
        .join('');

      const versionSvg = card.version
        ? `<text x="${x + cardWidth - 14}" y="${y + 28}" text-anchor="end" fill="#fbcfe8" font-size="13" font-family="Arial, sans-serif">${escapeXml(card.version)}</text>`
        : '';

      const imageSvg = card.imageDataUri
        ? `<image x="${x + 14}" y="${y + 44}" width="96" height="96" preserveAspectRatio="xMidYMid slice" href="${card.imageDataUri}" clip-path="url(#jacketClip${index})" />
           <clipPath id="jacketClip${index}"><rect x="${x + 14}" y="${y + 44}" width="96" height="96" rx="12" ry="12"/></clipPath>`
        : `<rect x="${x + 14}" y="${y + 44}" width="96" height="96" rx="12" ry="12" fill="#2b2f55"/>
           <text x="${x + 62}" y="${y + 100}" text-anchor="middle" fill="#b8bfd8" font-size="12" font-family="Arial, sans-serif">NO</text>
           <text x="${x + 62}" y="${y + 116}" text-anchor="middle" fill="#b8bfd8" font-size="12" font-family="Arial, sans-serif">IMAGE</text>`;

      return `
        <g>
          <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="16" ry="16" fill="#3e1f53" stroke="#8b5cf6" stroke-opacity="0.35" stroke-width="2"/>
          <rect x="${x + 14}" y="${y + 12}" width="${cardWidth - 28}" height="24" rx="8" ry="8" fill="#5b286f"/>
          <text x="${textX}" y="${y + 29}" fill="#ffffff" font-size="18" font-family="Arial, sans-serif">${escapeXml(trimText(card.title, 26))}</text>
          <text x="${textX}" y="${y + 52}" fill="#ddd6fe" font-size="14" font-family="Arial, sans-serif">${escapeXml(trimText(card.artist, 30))}</text>
          ${versionSvg}
          ${imageSvg}
          ${lineSvg}
        </g>
      `;
    })
    .join('');

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#6c2f82" />
          <stop offset="100%" stop-color="#1f1635" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bgGrad)" />
      <rect x="${margin}" y="26" width="${width - margin * 2}" height="78" rx="18" ry="18" fill="#2b1538" fill-opacity="0.72" />
      <text x="${margin + 24}" y="66" fill="#ffffff" font-size="42" font-family="Arial, sans-serif">${escapeXml(trimText(loadoutName, 24))}</text>
      <text x="${margin + 24}" y="92" fill="#f9a8d4" font-size="20" font-family="Arial, sans-serif">Favorite Loadout</text>
      <text x="${width - margin - 24}" y="92" text-anchor="end" fill="#fbcfe8" font-size="22" font-family="Arial, sans-serif">${escapeXml(
        dateText
      )}</text>
      ${cardSvg}
    </svg>
  `;

  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'original'
    }
  });

  const png = resvg.render().asPng();
  return {
    buffer: png,
    fileName: `${sanitizeFileName(loadoutName)}-loadout.png`
  };
}
