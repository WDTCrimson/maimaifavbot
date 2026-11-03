import { EmbedBuilder } from 'discord.js';
import { formatOdds, normalizeSkillModelChartRow, RANK_THRESHOLDS } from './skill-model.js';

const DIFFICULTY_LABELS = Object.freeze({
  basic: 'BASIC',
  advanced: 'ADVANCED',
  expert: 'EXPERT',
  master: 'MASTER',
  remaster: 'Re:MASTER'
});

function normalizePart(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/^re:master$/, 'remaster');
}

function formatAchievement(value) {
  return `${Number(value).toFixed(4)}%`;
}

function formatInternalLevel(chart) {
  const value = Number(chart?.internalLevelValue);
  return Number.isFinite(value) ? value.toFixed(1) : String(chart?.internalLevel || chart?.level || '?');
}

function titleCase(value) {
  const text = String(value || '');
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

export function findPredictionChart(song, type, difficulty) {
  const normalizedType = normalizePart(type);
  const normalizedDifficulty = normalizePart(difficulty);
  return (song?.difficultyLevels || []).find((chart) =>
    normalizePart(chart.type) === normalizedType
      && normalizePart(chart.difficulty) === normalizedDifficulty
  ) || null;
}

export function findPredictionBest(scores, catalog, song, chart) {
  const targetType = normalizePart(chart?.type);
  const targetDifficulty = normalizePart(chart?.difficulty);
  return (Array.isArray(scores) ? scores : [])
    .map((score) => normalizeSkillModelChartRow(score, catalog))
    .filter(Boolean)
    .find((score) => score.songId === song?.songId
      && score.type === targetType
      && score.difficulty === targetDifficulty) || null;
}

export function buildSkillPredictionEmbed({ song, chart, best, prediction, imageUrl = null }) {
  const source = prediction.modelSource === 'rasmai-repeat'
    ? 'Hybrid repeat model (Rasmai-derived)'
    : prediction.modelSource === 'maideck-fallback'
      ? 'MaiDeck fallback model'
      : 'MaiDeck first-pass model';
  const chartLabel = `${String(chart.type || '').toUpperCase()} ${DIFFICULTY_LABELS[normalizePart(chart.difficulty)] || chart.difficulty} ${chart.internalLevel || chart.level || '?'} · internal ${formatInternalLevel(chart)}`;
  const targets = RANK_THRESHOLDS
    .map(({ name }) => `**${name}** — ${titleCase(formatOdds(prediction.oddsByRank[name], false))}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(`Next-play estimate · ${song.title}`)
    .setDescription(chartLabel)
    .addFields(
      {
        name: 'Current best',
        value: best ? `${formatAchievement(best.achievement)} · ${best.playCount || 1} recorded play${best.playCount === 1 ? '' : 's'}` : 'Unplayed',
        inline: true
      },
      {
        name: 'Predicted next run',
        value: `About **${formatAchievement(prediction.expected)}** · **${prediction.rank}**`,
        inline: true
      },
      { name: 'Target outlook', value: targets },
      { name: 'Model', value: source }
    )
    .setFooter({ text: 'Qualitative preview — estimates are not guarantees. Exact odds stay hidden until calibration passes.' });

  if (imageUrl) embed.setThumbnail(imageUrl);
  return embed;
}
