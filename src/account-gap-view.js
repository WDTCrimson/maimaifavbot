import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export const GAP_RECOMMENDATION_PAGE_SIZE = 5;
export const GAP_RECOMMENDATION_TTL_MS = 15 * 60 * 1000;

const DIFFICULTY_COLORS = Object.freeze({
  basic: 0x37b24d,
  advanced: 0xf5c400,
  expert: 0xef4444,
  master: 0x8b5cf6,
  remaster: 0xdfc8ff
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function truncate(value, limit) {
  const text = String(value || '').trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function formatDifficulty(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'remaster') return 'Re:MASTER';
  return normalized ? normalized.toUpperCase() : 'UNKNOWN';
}

function formatAchievement(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric / 10000).toFixed(4)}%` : 'Unknown';
}

function formatInternalLevel(value, fallback = '?') {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : String(fallback || '?');
}

function recommendationCustomId(sessionId, action) {
  return `gap:${sessionId}:${action}`;
}

export function parseGapRecommendationCustomId(customId) {
  const match = String(customId || '').match(/^gap:([A-Za-z0-9_-]{8,32}):(first|previous|next|last)$/);
  return match ? { sessionId: match[1], action: match[2] } : null;
}

function buildNavigationRow(sessionId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(recommendationCustomId(sessionId, 'first'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⏮️')
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(recommendationCustomId(sessionId, 'previous'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('◀️')
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(recommendationCustomId(sessionId, 'page'))
      .setStyle(ButtonStyle.Secondary)
      .setLabel(`${page + 1}/${totalPages}`)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(recommendationCustomId(sessionId, 'next'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('▶️')
      .setDisabled(page === totalPages - 1),
    new ButtonBuilder()
      .setCustomId(recommendationCustomId(sessionId, 'last'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⏭️')
      .setDisabled(page === totalPages - 1)
  );
}

export function buildGapRecommendationPage({
  sessionId,
  playerName,
  suggestions,
  page = 0,
  imageUrls = new Map()
}) {
  const entries = Array.isArray(suggestions) ? suggestions : [];
  const totalPages = Math.max(1, Math.ceil(entries.length / GAP_RECOMMENDATION_PAGE_SIZE));
  const safePage = clamp(Number(page) || 0, 0, totalPages - 1);
  const start = safePage * GAP_RECOMMENDATION_PAGE_SIZE;
  const shown = entries.slice(start, start + GAP_RECOMMENDATION_PAGE_SIZE);
  const embeds = shown.map((entry, pageIndex) => {
    const globalIndex = start + pageIndex;
    const targetScore = entry.targetLabel === 'AP'
      ? `AP · ${formatAchievement(entry.targetAchievement)}`
      : formatAchievement(entry.targetAchievement);
    const embed = new EmbedBuilder()
      .setColor(DIFFICULTY_COLORS[String(entry.difficulty || '').toLowerCase()] || 0x5865f2)
      .setTitle(`${globalIndex + 1}. ${truncate(entry.title || 'Unknown song', 90)}`)
      .setDescription(
        `${String(entry.type || 'UNK').toUpperCase()} ${formatDifficulty(entry.difficulty)} • Lv ${formatInternalLevel(entry.internalLevelValue, entry.level)}`
      )
      .addFields(
        {
          name: 'Current',
          value: `${formatAchievement(entry.achievement)} (${Math.round(Number(entry.rating) || 0)})`,
          inline: true
        },
        {
          name: 'Target',
          value: `${targetScore} (${Math.round(Number(entry.targetRating) || 0)})\n**+${Math.round(Number(entry.ratingGain) || 0)} rating**`,
          inline: true
        }
      );
    const imageUrl = imageUrls.get(globalIndex);
    if (imageUrl) embed.setThumbnail(imageUrl);
    return embed;
  });

  return {
    content: `Rating recommendations for **${truncate(playerName || 'your account', 80)}**`,
    embeds,
    components: totalPages > 1 ? [buildNavigationRow(sessionId, safePage, totalPages)] : [],
    page: safePage,
    totalPages,
    start,
    shown
  };
}

export class GapRecommendationSessions {
  constructor({ ttlMs = GAP_RECOMMENDATION_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.sessions = new Map();
  }

  create(id, value) {
    this.prune();
    const session = {
      ...value,
      page: 0,
      expiresAt: this.now() + this.ttlMs
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  move(id, action) {
    const session = this.get(id);
    if (!session) return null;
    const totalPages = Math.max(1, Math.ceil(session.suggestions.length / GAP_RECOMMENDATION_PAGE_SIZE));
    if (action === 'first') session.page = 0;
    if (action === 'previous') session.page = Math.max(0, session.page - 1);
    if (action === 'next') session.page = Math.min(totalPages - 1, session.page + 1);
    if (action === 'last') session.page = totalPages - 1;
    return session;
  }

  prune() {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }
}
