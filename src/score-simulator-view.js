import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';
import {
  formatSimulatedAchievement,
  simulateAchievement,
  summarizeEnteredJudgments
} from './score-simulator.js';

export const SCORE_SIMULATOR_TTL_MS = 15 * 60 * 1000;

const NOTE_TYPES = Object.freeze(['tap', 'hold', 'slide', 'touch', 'break']);
const JUDGMENTS = Object.freeze(['perfect', 'great', 'good', 'miss']);
const DIFFICULTY_ORDER = Object.freeze(['basic', 'advanced', 'expert', 'master', 'remaster']);

function customId(sessionId, action) {
  return `score-sim:${sessionId}:${action}`;
}

export function parseScoreSimulatorCustomId(value) {
  const match = String(value || '').match(
    /^score-sim:([A-Za-z0-9_-]{8,32}):(chart|type|judgment|minus10|minus1|plus1|plus10|reset|clear|done)$/
  );
  return match ? { sessionId: match[1], action: match[2] } : null;
}

function chartType(chart) {
  return String(chart?.type || chart?.chartType || 'unknown').toLowerCase();
}

function formatDifficulty(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized === 'remaster' ? 'Re:MASTER' : normalized.toUpperCase();
}

function totalNotes(noteCounts) {
  return NOTE_TYPES.reduce((total, type) => total + Number(noteCounts?.[type] || 0), 0);
}

function isSimulatableChart(chart) {
  try {
    simulateAchievement(chart?.noteCounts, {});
    return Boolean(chart?.level);
  } catch {
    return false;
  }
}

export function simulatableChartsForSong(song) {
  const difficultyRank = new Map(DIFFICULTY_ORDER.map((difficulty, index) => [difficulty, index]));
  return (Array.isArray(song?.difficultyLevels) ? song.difficultyLevels : [])
    .filter(isSimulatableChart)
    .sort((left, right) => {
      const byDifficulty = (difficultyRank.get(String(left.difficulty).toLowerCase()) ?? 99)
        - (difficultyRank.get(String(right.difficulty).toLowerCase()) ?? 99);
      if (byDifficulty !== 0) return byDifficulty;
      return chartType(left).localeCompare(chartType(right));
    })
    .slice(0, 25);
}

function judgmentsFor(session) {
  const key = String(session.chartIndex);
  session.judgmentsByChart[key] ||= {};
  return session.judgmentsByChart[key];
}

function judgmentCount(judgments, type, judgment) {
  return Number(judgments?.[type]?.[judgment] || 0);
}

function enteredForType(judgments, type) {
  return JUDGMENTS.reduce((total, judgment) => total + judgmentCount(judgments, type, judgment), 0);
}

export class ScoreSimulatorSessions {
  constructor({ ttlMs = SCORE_SIMULATOR_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.sessions = new Map();
  }

  create(id, value) {
    this.prune();
    const session = {
      ...value,
      chartIndex: Number.isInteger(value.chartIndex) ? value.chartIndex : 0,
      noteType: 'tap',
      judgment: 'great',
      judgmentsByChart: {},
      completed: false,
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

  apply(id, action, value = null) {
    const session = this.get(id);
    if (!session || session.completed) return session;

    if (action === 'chart') {
      const index = Number(value);
      if (Number.isInteger(index) && index >= 0 && index < session.charts.length) {
        session.chartIndex = index;
      }
      return session;
    }
    if (action === 'type' && NOTE_TYPES.includes(value)) {
      session.noteType = value;
      return session;
    }
    if (action === 'judgment' && JUDGMENTS.includes(value)) {
      session.judgment = value;
      return session;
    }
    if (action === 'clear') {
      session.judgmentsByChart[String(session.chartIndex)] = {};
      return session;
    }
    if (action === 'done') {
      session.completed = true;
      return session;
    }

    const judgments = judgmentsFor(session);
    judgments[session.noteType] ||= {};
    if (action === 'reset') {
      judgments[session.noteType][session.judgment] = 0;
      return session;
    }

    const delta = { minus10: -10, minus1: -1, plus1: 1, plus10: 10 }[action];
    if (!delta) return session;
    const chart = session.charts[session.chartIndex];
    const available = Math.max(
      0,
      Number(chart.noteCounts[session.noteType])
        - enteredForType(judgments, session.noteType)
        + judgmentCount(judgments, session.noteType, session.judgment)
    );
    const current = judgmentCount(judgments, session.noteType, session.judgment);
    judgments[session.noteType][session.judgment] = Math.min(available, Math.max(0, current + delta));
    return session;
  }

  prune() {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }
}

function chartOption(chart, index, selectedIndex) {
  const count = totalNotes(chart.noteCounts);
  return new StringSelectMenuOptionBuilder()
    .setLabel(`${chartType(chart).toUpperCase()} ${formatDifficulty(chart.difficulty)} • Lv ${chart.level}`)
    .setDescription(`${count} notes`)
    .setValue(String(index))
    .setDefault(index === selectedIndex);
}

function buildComponents(sessionId, session) {
  if (session.completed) return [];
  const chart = session.charts[session.chartIndex];
  const judgments = judgmentsFor(session);
  const current = judgmentCount(judgments, session.noteType, session.judgment);
  const entered = enteredForType(judgments, session.noteType);
  const maximum = Number(chart.noteCounts[session.noteType]);
  const remaining = maximum - entered;

  const chartRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId(sessionId, 'chart'))
      .setPlaceholder('Choose a chart')
      .addOptions(session.charts.map((entry, index) => chartOption(entry, index, session.chartIndex)))
  );
  const typeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId(sessionId, 'type'))
      .setPlaceholder('Choose a note type')
      .addOptions(NOTE_TYPES.map((type) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(type.toUpperCase())
          .setDescription(`${chart.noteCounts[type]} notes in this chart`)
          .setValue(type)
          .setDefault(type === session.noteType)
      ))
  );
  const judgmentRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId(sessionId, 'judgment'))
      .setPlaceholder('Choose a judgment')
      .addOptions(JUDGMENTS.map((judgment) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(judgment.toUpperCase())
          .setValue(judgment)
          .setDefault(judgment === session.judgment)
      ))
  );
  const adjustmentRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId(sessionId, 'minus10')).setLabel('−10').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId(customId(sessionId, 'minus1')).setLabel('−1').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId(customId(sessionId, 'plus1')).setLabel('+1').setStyle(ButtonStyle.Primary).setDisabled(remaining === 0),
    new ButtonBuilder().setCustomId(customId(sessionId, 'plus10')).setLabel('+10').setStyle(ButtonStyle.Primary).setDisabled(remaining === 0),
    new ButtonBuilder().setCustomId(customId(sessionId, 'reset')).setLabel('Reset').setStyle(ButtonStyle.Danger).setDisabled(current === 0)
  );
  const finishRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId(sessionId, 'clear')).setLabel('Clear chart').setStyle(ButtonStyle.Secondary).setDisabled(entered === 0 && summarizeEnteredJudgments(simulateAchievement(chart.noteCounts, judgments)).length === 0),
    new ButtonBuilder().setCustomId(customId(sessionId, 'done')).setLabel('Done').setStyle(ButtonStyle.Success)
  );
  return [chartRow, typeRow, judgmentRow, adjustmentRow, finishRow];
}

export function buildScoreSimulatorView(sessionId, session) {
  const chart = session.charts[session.chartIndex];
  const judgments = judgmentsFor(session);
  const simulation = simulateAchievement(chart.noteCounts, judgments);
  const achievement = simulation.achievement;
  const achievementText = achievement.exact
    ? formatSimulatedAchievement(achievement.minimum)
    : `${formatSimulatedAchievement(achievement.minimum)} – ${formatSimulatedAchievement(achievement.maximum)}`;
  const rankText = achievement.minimumRank === achievement.maximumRank
    ? achievement.minimumRank
    : `${achievement.minimumRank} – ${achievement.maximumRank}`;
  const enteredLines = summarizeEnteredJudgments(simulation);
  const activeCount = judgmentCount(judgments, session.noteType, session.judgment);
  const entered = enteredForType(judgments, session.noteType);
  const available = Number(chart.noteCounts[session.noteType]) - entered;

  const embed = new EmbedBuilder()
    .setColor(session.completed ? 0x22c55e : 0xf59e0b)
    .setTitle(`${session.completed ? 'Score simulation' : 'Interactive score simulator'}: ${session.song.title}`)
    .setDescription(session.completed
      ? 'Final simulated result.'
      : 'Choose a chart, note type, and judgment, then use the buttons to change its count. The result updates immediately.')
    .addFields(
      {
        name: 'Chart',
        value: [
          `${chartType(chart).toUpperCase()} ${formatDifficulty(chart.difficulty)} • Lv ${chart.level}`,
          `TAP ${simulation.noteCounts.tap} · HOLD ${simulation.noteCounts.hold} · SLIDE ${simulation.noteCounts.slide}`,
          `TOUCH ${simulation.noteCounts.touch} · BREAK ${simulation.noteCounts.break}`
        ].join('\n')
      },
      {
        name: session.completed ? 'Entered judgments' : 'Currently editing',
        value: session.completed
          ? (enteredLines.join('\n') || 'All notes CRITICAL PERFECT.')
          : `${session.noteType.toUpperCase()} → ${session.judgment.toUpperCase()}: **${activeCount}**\n${available} ${session.noteType.toUpperCase()} notes still unassigned`
      },
      ...(!session.completed ? [{
        name: 'All entered judgments',
        value: enteredLines.join('\n') || 'None yet — all notes are currently CRITICAL PERFECT.'
      }] : []),
      {
        name: 'Live result',
        value: [
          `Achievement: **${achievementText}**`,
          `Rank: **${rankText}**`,
          `DX Score: **${simulation.dxScore.toLocaleString()} / ${simulation.maximumDxScore.toLocaleString()}**`
        ].join('\n')
      }
    )
    .setFooter({
      text: simulation.hasBreakAmbiguity
        ? 'Unlisted notes are CRITICAL PERFECT • BREAK sub-tiers make this a range'
        : 'Unlisted notes are CRITICAL PERFECT • Controls expire after 15 minutes'
    });

  return {
    embeds: [embed],
    components: buildComponents(sessionId, session),
    simulation
  };
}
