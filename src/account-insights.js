const PLATE_TYPES = ['kiwami', 'shou', 'shin', 'maimai'];
const PLATE_LABELS = {
  kiwami: '極',
  shou: '将',
  shin: '神',
  maimai: '舞舞'
};
const MAIN_DIFFICULTIES = ['basic', 'advanced', 'expert', 'master'];

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeDifficulty(value) {
  return normalizeText(value).replace(/^re:master$/, 'remaster');
}

function normalizeType(value) {
  const normalized = normalizeText(value);
  return normalized === 'sd' ? 'std' : normalized;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findScoreSong(score, songCatalog) {
  const storedId = score?.songId || score?.favoriteId;
  if (storedId) {
    const direct = songCatalog.getByStoredId(storedId);
    if (direct) return direct;
  }
  return songCatalog.getUniqueByNormalizedTitle(score?.title) || songCatalog.getByAlias(score?.title);
}

function chartKey(songId, type, difficulty) {
  return `${songId}::${normalizeType(type)}::${normalizeDifficulty(difficulty)}`;
}

function buildPlayerScoreMap(scores, songCatalog) {
  const byChart = new Map();
  for (const score of Array.isArray(scores) ? scores : []) {
    const achievement = finiteNumber(score?.achievement);
    if (achievement == null) continue;
    const song = findScoreSong(score, songCatalog);
    if (!song) continue;
    const type = normalizeType(score.type || score.chartType || 'std');
    const difficulty = normalizeDifficulty(score.difficulty);
    const chart = (song.difficultyLevels || []).find((entry) =>
      normalizeType(entry.type) === type && normalizeDifficulty(entry.difficulty) === difficulty
    );
    if (!chart) continue;
    const key = chartKey(song.songId, type, difficulty);
    const candidate = { ...score, song, chart, type, difficulty, achievement, key };
    const existing = byChart.get(key);
    if (!existing || candidate.achievement > existing.achievement) {
      byChart.set(key, candidate);
    }
  }
  return byChart;
}

function plateSatisfied(score, plateType) {
  if (!score) return false;
  const fc = normalizeText(score.fc).replace(/p$/, '+');
  const fs = normalizeText(score.fs).replace(/p$/, '+');
  if (plateType === 'kiwami') return ['fc', 'fc+', 'ap', 'ap+'].includes(fc);
  if (plateType === 'shou') return Number(score.achievement) >= 1_000_000;
  if (plateType === 'shin') return ['ap', 'ap+'].includes(fc);
  if (plateType === 'maimai') return ['fdx', 'fdx+'].includes(fs);
  return false;
}

function resolveVersion(versions, requested) {
  const query = normalizeText(requested);
  if (!query) return null;
  const exact = versions.find((version) => normalizeText(version) === query);
  if (exact) return exact;
  const partial = versions.filter((version) => normalizeText(version).includes(query));
  return partial.length === 1 ? partial[0] : null;
}

export function buildAccountProgress(scores, songCatalog, options = {}) {
  if (!songCatalog?.available) {
    throw new Error('Song catalog is unavailable.');
  }
  const requestedDifficulty = options.difficulty ? normalizeDifficulty(options.difficulty) : null;
  const requestedPlate = options.plate ? normalizeText(options.plate) : null;
  if (requestedDifficulty && !MAIN_DIFFICULTIES.includes(requestedDifficulty)) {
    throw new Error('Difficulty must be BASIC, ADVANCED, EXPERT, or MASTER.');
  }
  if (requestedPlate && !PLATE_TYPES.includes(requestedPlate)) {
    throw new Error('Plate must be kiwami, shou, shin, or maimai.');
  }

  const catalogCharts = [];
  for (const song of songCatalog.songs) {
    if (song.regions && !song.regions.intl) continue;
    for (const chart of song.difficultyLevels || []) {
      const difficulty = normalizeDifficulty(chart.difficulty);
      if (!MAIN_DIFFICULTIES.includes(difficulty) || !chart.version) continue;
      catalogCharts.push({
        key: chartKey(song.songId, chart.type, difficulty),
        song,
        chart,
        difficulty,
        type: normalizeType(chart.type),
        version: chart.version,
        releaseDate: chart.releaseDate || ''
      });
    }
  }

  const versions = [...new Set(catalogCharts.map((entry) => entry.version))];
  const selectedVersion = resolveVersion(versions, options.version);
  if (options.version && !selectedVersion) {
    throw new Error(`Unknown or ambiguous version: ${options.version}`);
  }

  const playerScores = buildPlayerScoreMap(scores, songCatalog);
  const filtered = catalogCharts.filter((entry) =>
    (!selectedVersion || entry.version === selectedVersion) &&
    (!requestedDifficulty || entry.difficulty === requestedDifficulty)
  );

  const byVersion = new Map();
  for (const entry of filtered) {
    if (!byVersion.has(entry.version)) {
      byVersion.set(entry.version, {
        version: entry.version,
        releaseDate: entry.releaseDate,
        total: 0,
        played: 0,
        plates: Object.fromEntries(PLATE_TYPES.map((plate) => [plate, 0]))
      });
    }
    const row = byVersion.get(entry.version);
    row.total += 1;
    if (entry.releaseDate > row.releaseDate) row.releaseDate = entry.releaseDate;
    const score = playerScores.get(entry.key);
    if (score) row.played += 1;
    for (const plate of PLATE_TYPES) {
      if (plateSatisfied(score, plate)) row.plates[plate] += 1;
    }
  }

  const rows = [...byVersion.values()].sort((a, b) =>
    b.releaseDate.localeCompare(a.releaseDate) || a.version.localeCompare(b.version)
  );
  const missing = selectedVersion && requestedPlate
    ? filtered
        .filter((entry) => !plateSatisfied(playerScores.get(entry.key), requestedPlate))
        .map((entry) => ({
          title: entry.song.title,
          difficulty: entry.difficulty,
          type: entry.type,
          level: entry.chart.level,
          internalLevelValue: entry.chart.internalLevelValue
        }))
        .sort((a, b) =>
          Number(a.internalLevelValue || 0) - Number(b.internalLevelValue || 0) ||
          a.title.localeCompare(b.title)
        )
    : [];

  return {
    selectedVersion,
    difficulty: requestedDifficulty,
    plate: requestedPlate,
    plateLabel: requestedPlate ? PLATE_LABELS[requestedPlate] : null,
    rows,
    missing
  };
}

export function filterRatingRecommendations(suggestions, options = {}) {
  const bucket = normalizeText(options.bucket || 'all');
  const difficulty = options.difficulty ? normalizeDifficulty(options.difficulty) : null;
  const type = options.type ? normalizeType(options.type) : null;
  const level = normalizeText(options.level);
  const sort = normalizeText(options.sort || 'efficiency');
  const count = Math.max(1, Math.min(20, Number(options.count) || 10));

  const filtered = (Array.isArray(suggestions) ? suggestions : []).filter((entry) => {
    if (bucket === 'new' && entry.bucket !== 'new') return false;
    if (bucket === 'old' && entry.bucket !== 'old') return false;
    if (bucket === 'best' && !entry.isInBest) return false;
    if (difficulty && normalizeDifficulty(entry.difficulty) !== difficulty) return false;
    if (type && normalizeType(entry.type) !== type) return false;
    if (level) {
      const displayed = normalizeText(entry.level);
      const precise = finiteNumber(entry.internalLevelValue);
      if (displayed !== level && String(precise) !== level) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'gain') {
      return b.ratingGain - a.ratingGain || b.efficiency - a.efficiency || a.title.localeCompare(b.title);
    }
    return b.efficiency - a.efficiency || b.ratingGain - a.ratingGain || a.title.localeCompare(b.title);
  });
  return { total: filtered.length, shown: filtered.slice(0, count), sort, count };
}

const ROASTS = [
  ({ player, scores }) => `${player} has ${scores} recorded charts and every one of them has notes for improvement.`,
  ({ player, plays }) => `${player} logged ${plays} plays. Quantity has submitted its application; quality is still filling out the form.`,
  ({ rating }) => `${rating} rating: close enough to look impressive from across the arcade.`,
  ({ ap, scores }) => `${ap} APs out of ${scores} charts. The remaining charts have formed a support group.`,
  ({ fc, scores }) => `${fc} full combos across ${scores} charts. The sliders would like a word.`,
  ({ player }) => `I analyzed ${player}'s profile. The strongest stat is commitment to the bit.`
];

export function buildAccountRoast(account, scores, seedDate = new Date().toISOString().slice(0, 10)) {
  const list = Array.isArray(scores) ? scores.filter((score) => finiteNumber(score?.achievement) != null) : [];
  const context = {
    player: account?.player?.name || 'This player',
    rating: Number(account?.metrics?.rating) || 0,
    plays: Number(account?.metrics?.playCount) || 0,
    scores: list.length,
    ap: list.filter((score) => ['ap', 'ap+'].includes(normalizeText(score.fc).replace(/p$/, '+'))).length,
    fc: list.filter((score) => ['fc', 'fc+', 'ap', 'ap+'].includes(normalizeText(score.fc).replace(/p$/, '+'))).length
  };
  const seed = `${context.player}:${context.rating}:${context.scores}:${seedDate}`;
  const index = [...seed].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) >>> 0, 0) % ROASTS.length;
  return { text: ROASTS[index](context), context };
}

export function buildAccountHistorySummary(snapshots, limit = 10) {
  const ordered = (Array.isArray(snapshots) ? snapshots : [])
    .slice()
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
  const shown = ordered.slice(0, Math.max(2, Math.min(20, Number(limit) || 10)));
  return shown.map((snapshot, index) => {
    const older = ordered[index + 1];
    return {
      ...snapshot,
      ratingDelta: older && snapshot.rating != null && older.rating != null
        ? Number(snapshot.rating) - Number(older.rating)
        : null,
      playCountDelta: older && snapshot.playCount != null && older.playCount != null
        ? Number(snapshot.playCount) - Number(older.playCount)
        : null
    };
  });
}

export function buildDailyPlaySummary(plays, date) {
  const list = (Array.isArray(plays) ? plays : [])
    .slice()
    .sort((a, b) => String(a.playedAtIso || a.playedAt).localeCompare(String(b.playedAtIso || b.playedAt)));
  const scored = list.filter((play) => finiteNumber(play.achievement) != null);
  const bySong = new Map();
  for (const play of list) {
    const title = play.title || 'Unknown Song';
    bySong.set(title, (bySong.get(title) || 0) + 1);
  }
  const favorite = [...bySong.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
  const best = scored.slice().sort((a, b) => Number(b.achievement) - Number(a.achievement))[0] || null;
  let sessions = 0;
  let previousTrack = null;
  for (const play of list) {
    const track = Number(play.track);
    if (previousTrack == null || !Number.isFinite(track) || track <= previousTrack) sessions += 1;
    previousTrack = Number.isFinite(track) ? track : null;
  }
  return {
    date,
    plays: list.length,
    sessions,
    averageAchievement: scored.length
      ? scored.reduce((sum, play) => sum + Number(play.achievement), 0) / scored.length
      : null,
    best,
    favorite: favorite ? { title: favorite[0], count: favorite[1] } : null,
    entries: list
  };
}

export { MAIN_DIFFICULTIES, PLATE_LABELS, PLATE_TYPES };
