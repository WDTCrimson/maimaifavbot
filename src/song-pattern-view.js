import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { canonicalChartKey } from './recommendation-schema.js';
import { resolvePlayerScores } from './recommendation-engine.js';

export const PATTERN_PAGE_SIZE = 5;
export const PATTERN_SESSION_TTL_MS = 15 * 60 * 1000;

const DIFFICULTY_COLORS = Object.freeze({
  basic: 0x37b24d,
  advanced: 0xf5c400,
  expert: 0xef4444,
  master: 0x8b5cf6,
  remaster: 0xdfc8ff
});

function safe(value, limit = 64) {
  const text = String(value || '').trim();
  const clipped = text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
  return escapeMarkdown(clipped);
}

function chartKey(entry) {
  return canonicalChartKey(entry.song.songId, entry.chart.type, entry.chart.difficulty);
}

function formatScore(score) {
  if (!score) return 'Not played';
  return `${(Number(score.achievement) / 10000).toFixed(4)}%`;
}

function formatDifficulty(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'remaster') return 'Re:MASTER';
  return normalized ? normalized.toUpperCase() : 'UNKNOWN';
}

function patternCustomId(sessionId, action) {
  return `pattern:${sessionId}:${action}`;
}

function controls(sessionId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(patternCustomId(sessionId, 'first')).setStyle(ButtonStyle.Primary).setEmoji('⏮️').setDisabled(page === 0),
    new ButtonBuilder().setCustomId(patternCustomId(sessionId, 'previous')).setStyle(ButtonStyle.Primary).setEmoji('◀️').setDisabled(page === 0),
    new ButtonBuilder().setCustomId(patternCustomId(sessionId, 'page')).setStyle(ButtonStyle.Secondary).setLabel(`${page + 1}/${totalPages}`).setDisabled(true),
    new ButtonBuilder().setCustomId(patternCustomId(sessionId, 'next')).setStyle(ButtonStyle.Primary).setEmoji('▶️').setDisabled(page === totalPages - 1),
    new ButtonBuilder().setCustomId(patternCustomId(sessionId, 'last')).setStyle(ButtonStyle.Primary).setEmoji('⏭️').setDisabled(page === totalPages - 1)
  );
}

export function parsePatternCustomId(customId) {
  const match = String(customId || '').match(/^pattern:([A-Za-z0-9_-]{8,32}):(first|previous|next|last)$/);
  return match ? { sessionId: match[1], action: match[2] } : null;
}

export function buildPatternPage({ sessionId, tag, label, charts, scores = [], songCatalog, playerName = null, showScores = false, page = 0, imageUrls = new Map() }) {
  const entries = Array.isArray(charts) ? charts : [];
  const totalPages = Math.max(1, Math.ceil(entries.length / PATTERN_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const start = safePage * PATTERN_PAGE_SIZE;
  const shown = entries.slice(start, start + PATTERN_PAGE_SIZE);
  const resolvedScores = resolvePlayerScores(scores, songCatalog);
  const scoreByKey = new Map(resolvedScores.map((score) => [score.key, score]));
  const embeds = shown.map((entry, index) => {
    const chart = entry.chart;
    const globalIndex = start + index;
    const constant = Number(chart.internalLevelValue);
    const level = Number.isFinite(constant) ? constant.toFixed(1) : String(chart.level || '?');
    const score = scoreByKey.get(chartKey(entry));
    const fields = [{
      name: 'Chart',
      value: `${String(chart.type || 'UNK').toUpperCase()} ${formatDifficulty(chart.difficulty)} · Lv ${level}`,
      inline: true
    }];
    if (showScores) {
      fields.push({
        name: 'Your score',
        value: formatScore(score),
        inline: true
      });
    }
    const embed = new EmbedBuilder()
      .setColor(DIFFICULTY_COLORS[String(chart.difficulty || '').toLowerCase()] || 0x5865f2)
      .setTitle(`${globalIndex + 1}. ${safe(entry.song.title, 90)}`)
      .setDescription(safe(entry.song.artist || 'Unknown artist', 100))
      .addFields(fields);
    const imageUrl = imageUrls.get(globalIndex);
    if (imageUrl) embed.setThumbnail(imageUrl);
    return embed;
  });
  const end = Math.min(start + shown.length, entries.length);
  if (!embeds.length) {
    embeds.push(
      new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`Pattern: ${safe(label || tag, 100)}`)
        .setDescription('No charts match those filters.')
    );
  }
  const range = entries.length ? `${start + 1}–${end}` : '0';
  return {
    content: `### ${safe(label || tag, 100)}\nShowing **${range}** of **${entries.length}** chart${entries.length === 1 ? '' : 's'}${playerName ? ` · scores for **${safe(playerName)}**` : ''}`,
    embeds,
    components: totalPages > 1 ? [controls(sessionId, safePage, totalPages)] : [],
    page: safePage,
    totalPages,
    start,
    end,
    shown
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
    if (action === 'first') session.page = 0;
    if (action === 'previous') session.page = Math.max(0, session.page - 1);
    if (action === 'next') session.page = Math.min(last, session.page + 1);
    if (action === 'last') session.page = last;
    return session;
  }
  prune() {
    for (const [id, session] of this.sessions) if (session.expiresAt <= this.now()) this.sessions.delete(id);
  }
}
