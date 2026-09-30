import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { canonicalChartKey } from './recommendation-schema.js';
import { resolvePlayerScores } from './recommendation-engine.js';

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

export function buildRandomChartPayload(entry) {
  const constant = Number(entry.chart.internalLevelValue);
  const level = Number.isFinite(constant) ? constant.toFixed(1) : String(entry.chart.level || '?');
  const title = escapeMarkdown(String(entry.song.title || '').slice(0, 100));
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(title)
    .setDescription(`${String(entry.chart.type || '').toUpperCase()} ${String(entry.chart.difficulty || '').toUpperCase()} · Lv ${level}`)
    .setFooter({ text: `Random pick from ${entry.candidateCount} matching chart${entry.candidateCount === 1 ? '' : 's'}` });
  return { embeds: [embed] };
}
