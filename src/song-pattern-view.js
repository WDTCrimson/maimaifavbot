import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { canonicalChartKey } from './recommendation-schema.js';
import { resolvePlayerScores } from './recommendation-engine.js';

export const PATTERN_PAGE_SIZE = 25;
export const PATTERN_SESSION_TTL_MS = 15 * 60 * 1000;

function safe(value, limit = 64) {
  const text = String(value || '').trim();
  const clipped = text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
  return escapeMarkdown(clipped);
}

function chartKey(entry) {
  return canonicalChartKey(entry.song.songId, entry.chart.type, entry.chart.difficulty);
}

function formatScore(score) {
  if (!score) return 'unplayed';
  return `${(Number(score.achievement) / 10000).toFixed(4)}%`;
}

function controls(sessionId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pattern:${sessionId}:previous`).setStyle(ButtonStyle.Primary).setEmoji('◀️').setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`pattern:${sessionId}:page`).setStyle(ButtonStyle.Secondary).setLabel(`${page + 1}/${totalPages}`).setDisabled(true),
    new ButtonBuilder().setCustomId(`pattern:${sessionId}:next`).setStyle(ButtonStyle.Primary).setEmoji('▶️').setDisabled(page === totalPages - 1)
  );
}

export function parsePatternCustomId(customId) {
  const match = String(customId || '').match(/^pattern:([A-Za-z0-9_-]{8,32}):(previous|next)$/);
  return match ? { sessionId: match[1], action: match[2] } : null;
}

export function buildPatternPage({ sessionId, tag, label, charts, scores = [], songCatalog, playerName = null, page = 0 }) {
  const entries = Array.isArray(charts) ? charts : [];
  const totalPages = Math.max(1, Math.ceil(entries.length / PATTERN_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const start = safePage * PATTERN_PAGE_SIZE;
  const shown = entries.slice(start, start + PATTERN_PAGE_SIZE);
  const resolvedScores = resolvePlayerScores(scores, songCatalog);
  const scoreByKey = new Map(resolvedScores.map((score) => [score.key, score]));
  const lines = shown.map((entry, index) => {
    const chart = entry.chart;
    const constant = Number(chart.internalLevelValue);
    const level = Number.isFinite(constant) ? constant.toFixed(1) : String(chart.level || '?');
    const score = scoreByKey.get(chartKey(entry));
    return `${start + index + 1}. **${safe(entry.song.title)}** — ${String(chart.type || '').toUpperCase()} ${safe(chart.difficulty).toUpperCase()} ${level} · ${formatScore(score)}`;
  });
  const end = Math.min(start + shown.length, entries.length);
  const description = lines.length ? lines.join('\n') : 'No charts match those filters.';
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(`Pattern: ${safe(label || tag, 100)}`)
    .setDescription(description)
    .setFooter({ text: `Showing ${entries.length ? start + 1 : 0}–${end} of ${entries.length}${playerName ? ` · scores for ${safe(playerName)}` : ''}` });
  return {
    embeds: [embed],
    components: totalPages > 1 ? [controls(sessionId, safePage, totalPages)] : [],
    page: safePage,
    totalPages,
    start,
    end
  };
}

export class PatternSessions {
  constructor({ ttlMs = PATTERN_SESSION_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.sessions = new Map();
  }
  create(id, value) {
    this.prune();
    const session = { ...value, page: 0, expiresAt: this.now() + this.ttlMs };
    this.sessions.set(id, session);
    return session;
  }
  get(id) {
    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }
  move(id, action) {
    const session = this.get(id);
    if (!session) return null;
    const last = Math.max(0, Math.ceil(session.charts.length / PATTERN_PAGE_SIZE) - 1);
    if (action === 'previous') session.page = Math.max(0, session.page - 1);
    if (action === 'next') session.page = Math.min(last, session.page + 1);
    return session;
  }
  prune() {
    for (const [id, session] of this.sessions) if (session.expiresAt <= this.now()) this.sessions.delete(id);
  }
}
