const NOTE_WEIGHTS = Object.freeze({
  tap: 1,
  hold: 2,
  slide: 3,
  touch: 1,
  break: 5
});

const NOTE_TYPES = Object.freeze(Object.keys(NOTE_WEIGHTS));

const JUDGMENTS_BY_TYPE = Object.freeze({
  tap: Object.freeze(['perfect', 'great', 'good', 'miss']),
  hold: Object.freeze(['perfect', 'great', 'good', 'miss']),
  slide: Object.freeze(['perfect', 'great', 'good', 'miss']),
  touch: Object.freeze(['perfect', 'great', 'good', 'miss']),
  break: Object.freeze(['perfect', 'great', 'good', 'miss'])
});

function integerCount(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
  return number;
}

function normalizeNoteCounts(noteCounts) {
  if (!noteCounts || typeof noteCounts !== 'object') {
    throw new Error('This chart is missing its note breakdown, so its achievement cannot be simulated.');
  }

  const normalized = {};
  for (const type of NOTE_TYPES) {
    if (noteCounts[type] == null) {
      throw new Error('This chart is missing its complete note breakdown, so its achievement cannot be simulated.');
    }
    normalized[type] = integerCount(noteCounts[type], `${type.toUpperCase()} note count`);
  }
  normalized.total = NOTE_TYPES.reduce((total, type) => total + normalized[type], 0);

  if (normalized.total <= 0) {
    throw new Error('This chart has no playable notes to simulate.');
  }
  return normalized;
}

function normalizeJudgments(judgments, noteCounts) {
  const normalized = {};
  for (const type of NOTE_TYPES) {
    normalized[type] = {};
    let entered = 0;
    for (const judgment of JUDGMENTS_BY_TYPE[type]) {
      const count = integerCount(judgments?.[type]?.[judgment] ?? 0, `${type.toUpperCase()} ${judgment.toUpperCase()}`);
      normalized[type][judgment] = count;
      entered += count;
    }
    if (entered > noteCounts[type]) {
      throw new Error(
        `${type.toUpperCase()} judgments total ${entered}, but this chart only has ${noteCounts[type]} ${type.toUpperCase()} notes.`
      );
    }
    normalized[type].critical = noteCounts[type] - entered;
  }
  return normalized;
}

function achievementRank(value) {
  if (value >= 100.5) return 'SSS+';
  if (value >= 100) return 'SSS';
  if (value >= 99.5) return 'SS+';
  if (value >= 99) return 'SS';
  if (value >= 98) return 'S+';
  if (value >= 97) return 'S';
  if (value >= 94) return 'AAA';
  if (value >= 90) return 'AA';
  if (value >= 80) return 'A';
  if (value >= 75) return 'BBB';
  if (value >= 70) return 'BB';
  if (value >= 60) return 'B';
  if (value >= 50) return 'C';
  return 'D';
}

function displayedAchievement(value) {
  // The game stores/displays achievement to four decimal places without
  // allowing floating-point noise to push an exact boundary downward.
  return Math.floor((Number(value) + 1e-10) * 10_000) / 10_000;
}

export function formatSimulatedAchievement(value) {
  return `${displayedAchievement(value).toFixed(4)}%`;
}

export function simulateAchievement(rawNoteCounts, rawJudgments = {}) {
  const noteCounts = normalizeNoteCounts(rawNoteCounts);
  const judgments = normalizeJudgments(rawJudgments, noteCounts);
  const maximumBase = NOTE_TYPES.reduce(
    (total, type) => total + noteCounts[type] * NOTE_WEIGHTS[type],
    0
  );

  let minimumBase = maximumBase;
  let maximumEarnedBase = maximumBase;

  for (const type of ['tap', 'hold', 'slide', 'touch']) {
    const weight = NOTE_WEIGHTS[type];
    minimumBase -= judgments[type].great * weight * 0.2;
    minimumBase -= judgments[type].good * weight * 0.5;
    minimumBase -= judgments[type].miss * weight;
  }
  maximumEarnedBase = minimumBase;

  const breakJudgments = judgments.break;
  // BREAK GREAT has three hidden base-score tiers: 80%, 60%, and 50%.
  minimumBase -= breakJudgments.great * 2.5;
  maximumEarnedBase -= breakJudgments.great;
  minimumBase -= breakJudgments.good * 3;
  maximumEarnedBase -= breakJudgments.good * 3;
  minimumBase -= breakJudgments.miss * 5;
  maximumEarnedBase -= breakJudgments.miss * 5;

  let minimumBonus = 0;
  let maximumBonus = 0;
  if (noteCounts.break > 0) {
    // Unlisted BREAKs are CRITICAL PERFECT. PERFECT has 50%/75% bonus tiers;
    // GREAT has one 40% bonus value regardless of its base-score tier.
    minimumBonus = (
      breakJudgments.critical +
      breakJudgments.perfect * 0.5 +
      breakJudgments.great * 0.4 +
      breakJudgments.good * 0.3
    ) / noteCounts.break;
    maximumBonus = (
      breakJudgments.critical +
      breakJudgments.perfect * 0.75 +
      breakJudgments.great * 0.4 +
      breakJudgments.good * 0.3
    ) / noteCounts.break;
  }

  const minimum = (minimumBase / maximumBase) * 100 + minimumBonus;
  const maximum = (maximumEarnedBase / maximumBase) * 100 + maximumBonus;
  const exact = Math.abs(maximum - minimum) < 1e-10;

  let dxScore = noteCounts.total * 3;
  for (const type of NOTE_TYPES) {
    dxScore -= (judgments[type].perfect ?? 0);
    dxScore -= judgments[type].great * 2;
    dxScore -= judgments[type].good * 3;
    dxScore -= judgments[type].miss * 3;
  }

  return {
    noteCounts,
    judgments,
    achievement: {
      minimum,
      maximum,
      exact,
      minimumDisplayed: displayedAchievement(minimum),
      maximumDisplayed: displayedAchievement(maximum),
      minimumRank: achievementRank(displayedAchievement(minimum)),
      maximumRank: achievementRank(displayedAchievement(maximum))
    },
    dxScore,
    maximumDxScore: noteCounts.total * 3,
    hasBreakAmbiguity: breakJudgments.perfect > 0 || breakJudgments.great > 0
  };
}

export function summarizeEnteredJudgments(simulation) {
  const lines = [];
  for (const type of NOTE_TYPES) {
    const values = JUDGMENTS_BY_TYPE[type]
      .filter((judgment) => simulation.judgments[type][judgment] > 0)
      .map((judgment) => `${simulation.judgments[type][judgment]} ${judgment.toUpperCase()}`);
    if (values.length) {
      lines.push(`${type.toUpperCase()}: ${values.join(' · ')}`);
    }
  }
  return lines;
}
