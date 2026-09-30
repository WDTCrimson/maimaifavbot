import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { canonicalChartKey } from './recommendation-schema.js';
import { resolvePlayerScores } from './recommendation-engine.js';

const DIFFICULTY_COLORS = Object.freeze({
  basic: 0x37b24d,
  advanced: 0xf5c400,
  expert: 0xef4444,
  master: 0x8b5cf6,
  remaster: 0xdfc8ff
});

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/^re:master$/, 'remaster');
}

export function selectRandomChart({ songCatalog, scores = [], level = null, difficulty = null, unplayed = false, rng = Math.random }) {
  const played = new Set(resolvePlayerScores(scores, songCatalog).map((score) => score.key));
  const wantedLevel = normalize(level);
  const wantedDifficulty = normalize(difficulty);
  const candidates = [];
  for (const song of songCatalog.songs) {
    if (song.regions && !song.regions.intl) continue;
    for (const chart of song.difficultyLevels || []) {
      if (wantedDifficulty && normalize(chart.difficulty) !== wantedDifficulty) continue;
      const constant = Number(chart.internalLevelValue);
      if (wantedLevel && normalize(chart.level) !== wantedLevel && (!Number.isFinite(constant) || constant.toFixed(1) !== wantedLevel)) continue;
      const key = canonicalChartKey(song.songId, normalize(chart.type), normalize(chart.difficulty));
      if (unplayed && played.has(key)) continue;
      candidates.push({ song, chart, key });
    }
  }
  if (!candidates.length) return null;
  const roll = Number(rng());
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * candidates.length)));
  return { ...candidates[index], candidateCount: candidates.length };
}

function formatDifficulty(value) {
  const normalized = normalize(value);
  if (normalized === 'remaster') return 'Re:MASTER';
  return normalized ? normalized.toUpperCase() : 'UNKNOWN';
}

export function buildRandomChartPayload(entry, { imageUrl = null, patternLabels = [] } = {}) {
  const constant = Number(entry.chart.internalLevelValue);
  const level = Number.isFinite(constant) ? constant.toFixed(1) : String(entry.chart.level || '?');
  const title = escapeMarkdown(String(entry.song.title || '').slice(0, 100));
  const embed = new EmbedBuilder()
    .setColor(DIFFICULTY_COLORS[normalize(entry.chart.difficulty)] || 0x22c55e)
    .setTitle(title)
    .setDescription(escapeMarkdown(String(entry.song.artist || 'Unknown artist').slice(0, 100)))
    .addFields(
      {
        name: 'Chart',
        value: `${String(entry.chart.type || 'UNK').toUpperCase()} ${formatDifficulty(entry.chart.difficulty)} · Lv ${level}`,
        inline: true
      },
      {
        name: 'Category',
        value: escapeMarkdown(String(entry.song.category || 'Unknown').slice(0, 100)),
        inline: true
      }
    )
    .setFooter({ text: `Random pick from ${entry.candidateCount} matching chart${entry.candidateCount === 1 ? '' : 's'}` });
  if (patternLabels.length) {
    embed.addFields({
      name: 'Patterns',
      value: patternLabels.map((value) => escapeMarkdown(String(value).slice(0, 64))).join(' · ').slice(0, 1024)
    });
  }
  if (imageUrl) embed.setThumbnail(imageUrl);
  return { embeds: [embed] };
}
