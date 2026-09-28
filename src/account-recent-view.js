import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const RECENT_CREDIT_TTL_MS = 15 * 60 * 1000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function recentCustomId(sessionId, action) {
  return `recent:${sessionId}:${action}`;
}

export function parseRecentCreditCustomId(customId) {
  const match = String(customId || '').match(
    /^recent:([A-Za-z0-9_-]{8,32}):(latest|newer|older|oldest)$/
  );
  return match ? { sessionId: match[1], action: match[2] } : null;
}

export function buildRecentCreditNavigation(sessionId, creditIndex, creditCount) {
  const total = Math.max(1, Number(creditCount) || 1);
  const index = clamp(Number(creditIndex) || 0, 0, total - 1);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(recentCustomId(sessionId, 'latest'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⏮️')
      .setDisabled(index === 0),
    new ButtonBuilder()
      .setCustomId(recentCustomId(sessionId, 'newer'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('◀️')
      .setDisabled(index === 0),
    new ButtonBuilder()
      .setCustomId(recentCustomId(sessionId, 'page'))
      .setStyle(ButtonStyle.Secondary)
      .setLabel(`${index + 1}/${total}`)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(recentCustomId(sessionId, 'older'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('▶️')
      .setDisabled(index === total - 1),
    new ButtonBuilder()
      .setCustomId(recentCustomId(sessionId, 'oldest'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⏭️')
      .setDisabled(index === total - 1)
  );
}

export class RecentCreditSessions {
  constructor({ ttlMs = RECENT_CREDIT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.sessions = new Map();
  }

  create(id, value) {
    this.prune();
    const session = {
      ...value,
      creditIndex: 0,
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
    const last = Math.max(0, Number(session.creditCount) - 1);
    if (action === 'latest') session.creditIndex = 0;
    if (action === 'newer') session.creditIndex = Math.max(0, session.creditIndex - 1);
    if (action === 'older') session.creditIndex = Math.min(last, session.creditIndex + 1);
    if (action === 'oldest') session.creditIndex = last;
    return session;
  }

  prune() {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }
}
