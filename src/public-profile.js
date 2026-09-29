const DIFFICULTY_ORDER = new Map([
  ['basic', 0],
  ['advanced', 1],
  ['expert', 2],
  ['master', 3],
  ['remaster', 4]
]);

function normalizeText(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function normalizeDifficulty(value) {
  const normalized = normalizeText(value).replace(/^re:master$/, 'remaster');
  return DIFFICULTY_ORDER.has(normalized) ? normalized : null;
}

function normalizeChartType(value) {
  const normalized = normalizeText(value);
  if (normalized === 'dx' || normalized === 'deluxe') return 'dx';
  if (normalized === 'std' || normalized === 'sd' || normalized === 'standard') return 'std';
  return null;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function achievementRank(achievement) {
  if (achievement == null) return null;
  if (achievement >= 1005000) return 'SSS+';
  if (achievement >= 1000000) return 'SSS';
  if (achievement >= 995000) return 'SS+';
  if (achievement >= 990000) return 'SS';
  if (achievement >= 980000) return 'S+';
  if (achievement >= 970000) return 'S';
  if (achievement >= 940000) return 'AAA';
  if (achievement >= 900000) return 'AA';
  if (achievement >= 800000) return 'A';
  if (achievement >= 750000) return 'BBB';
  if (achievement >= 700000) return 'BB';
  if (achievement >= 600000) return 'B';
  if (achievement >= 500000) return 'C';
  return 'D';
}

function chartKey(type, difficulty) {
  return `${type}:${difficulty}`;
}

function findSong(songCatalog, score) {
  if (!songCatalog?.available) return null;
  if (score?.favoriteId) {
    const byId = songCatalog.getByFavoriteId(score.favoriteId);
    if (byId) return byId;
  }
  return songCatalog.getUniqueByNormalizedTitle(score?.title) || null;
}

function findCatalogChart(song, type, difficulty) {
  return (song?.difficultyLevels || []).find((chart) =>
    normalizeChartType(chart?.type) === type && normalizeDifficulty(chart?.difficulty) === difficulty
  ) || null;
}

function publicAvatarUrl(account) {
  const value = account?.extra?.iconUrl || account?.player?.iconUrl;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['maimaidx-eng.com', 'www.maimaidx-eng.com'].includes(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function publicSearchAliases(song) {
  const aliases = Array.isArray(song?.normAliases)
    ? song.normAliases
    : (Array.isArray(song?.aliases) ? song.aliases : []).map((alias) => normalizeText(alias));
  return [...new Set(aliases.map((alias) => normalizeText(alias)).filter(Boolean))];
}

function publicRecentPlay(play, songCatalog) {
  const type = normalizeChartType(play?.type);
  const difficulty = normalizeDifficulty(play?.difficulty);
  const title = String(play?.title || '').trim();
  if (!type || !difficulty || !title) return null;
  const song = findSong(songCatalog, play);
  const chart = findCatalogChart(song, type, difficulty);
  const fastCount = finiteNumber(play?.details?.fastCount);
  const lateCount = finiteNumber(play?.details?.lateCount);
  return {
    songId: song?.songId || null,
    hasJacket: Boolean(song?.jacket?.dxratingFile || song?.jacket?.otogeFile),
    title: song?.title || title,
    artist: song?.artist || play?.artist || null,
    type,
    difficulty,
    level: chart?.level || play?.level || null,
    achievement: finiteNumber(play?.achievement),
    achievementRank: achievementRank(finiteNumber(play?.achievement)),
    dxScore: finiteNumber(play?.dxScore),
    maxDxScore: finiteNumber(play?.maxDxScore),
    fc: play?.fc || null,
    fs: play?.fs || null,
    track: finiteNumber(play?.track),
    playedAt: play?.playedAtIso || play?.playedAt || null,
    fastCount,
    lateCount,
    ratingChange: finiteNumber(play?.details?.ratingChange)
  };
}

function publicChart(score, fallback = {}) {
  const achievement = finiteNumber(score?.achievement);
  return {
    type: normalizeChartType(score?.type) || fallback.type,
    difficulty: normalizeDifficulty(score?.difficulty) || fallback.difficulty,
    level: fallback.level || score?.level || null,
    internalLevelValue: finiteNumber(fallback.internalLevelValue ?? score?.internalLevelValue),
    version: fallback.version || score?.version || null,
    played: true,
    achievement,
    achievementRank: achievementRank(achievement),
    dxScore: finiteNumber(score?.dxScore),
    maxDxScore: finiteNumber(score?.maxDxScore),
    fc: score?.fc || null,
    fs: score?.fs || null,
    playCount: finiteNumber(score?.playCount),
    rating: finiteNumber(score?.rating)
  };
}

function compareTimedPlays(left, right) {
  if (!right) return 1;
  if (left.achievement !== right.achievement) return left.achievement - right.achievement;
  const leftDx = left.dxScore ?? -1;
  const rightDx = right.dxScore ?? -1;
  if (leftDx !== rightDx) return leftDx - rightDx;
  const timeDifference = Date.parse(left.playedAtIso) - Date.parse(right.playedAtIso);
  if (timeDifference !== 0) return timeDifference;
  return String(left.playKey || '').localeCompare(String(right.playKey || ''));
}

function buildTimedLookup(bestTimedPlays, songCatalog) {
  const lookup = new Map();
  if (!songCatalog?.available) return lookup;
  for (const play of Array.isArray(bestTimedPlays) ? bestTimedPlays : []) {
    const type = normalizeChartType(play?.type);
    const difficulty = normalizeDifficulty(play?.difficulty);
    const song = findSong(songCatalog, play);
    const achievement = finiteNumber(play?.achievement);
    const fastCount = finiteNumber(play?.fastCount);
    const lateCount = finiteNumber(play?.lateCount);
    const playedAtIso = String(play?.playedAtIso || '').trim();
    if (!type || !difficulty || !song?.songId || !Number.isInteger(achievement) || achievement < 0 ||
        !Number.isInteger(fastCount) || fastCount < 0 || !Number.isInteger(lateCount) || lateCount < 0 ||
        !Number.isFinite(Date.parse(playedAtIso))) continue;
    const candidate = {
      achievement,
      dxScore: Number.isInteger(play?.dxScore) && play.dxScore >= 0 ? play.dxScore : null,
      fastCount,
      lateCount,
      playedAtIso: new Date(playedAtIso).toISOString(),
      playKey: String(play?.playKey || '')
    };
    const key = `${song.songId}\0${type}\0${difficulty}`;
    if (compareTimedPlays(candidate, lookup.get(key)) > 0) lookup.set(key, candidate);
  }
  return lookup;
}

function availableChart(chart) {
  return {
    type: normalizeChartType(chart?.type),
    difficulty: normalizeDifficulty(chart?.difficulty),
    level: chart?.level || null,
    internalLevelValue: finiteNumber(chart?.internalLevelValue),
    version: chart?.version || null,
    played: false,
    achievement: null,
    achievementRank: null,
    dxScore: null,
    maxDxScore: null,
    fc: null,
    fs: null,
    playCount: null,
    rating: null
  };
}

function compareCharts(a, b) {
  if (a.type !== b.type) return a.type === 'dx' ? -1 : 1;
  return (DIFFICULTY_ORDER.get(a.difficulty) ?? 99) - (DIFFICULTY_ORDER.get(b.difficulty) ?? 99);
}

export function buildPublicProfilePayload({ account, scores, recentPlays = [], bestTimedPlays = [], songCatalog }) {
  const groups = new Map();
  const timedLookup = buildTimedLookup(bestTimedPlays, songCatalog);

  for (const score of Array.isArray(scores) ? scores : []) {
    const type = normalizeChartType(score?.type);
    const difficulty = normalizeDifficulty(score?.difficulty);
    const title = String(score?.title || '').trim();
    if (!type || !difficulty || !title) continue;

    const song = findSong(songCatalog, score);
    const id = song?.songId || `title:${normalizeText(title)}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        songId: song?.songId || null,
        hasJacket: Boolean(song?.jacket?.dxratingFile || song?.jacket?.otogeFile),
        title: song?.title || title,
        artist: song?.artist || score?.artist || null,
        category: song?.category || null,
        searchAliases: publicSearchAliases(song),
        charts: new Map()
      };
      for (const chart of song?.difficultyLevels || []) {
        const available = availableChart(chart);
        if (available.type && available.difficulty) {
          group.charts.set(chartKey(available.type, available.difficulty), available);
        }
      }
      groups.set(id, group);
    }

    const key = chartKey(type, difficulty);
    const existing = group.charts.get(key);
    const candidate = publicChart(score, existing || { type, difficulty });
    if (!existing?.played || (candidate.achievement ?? -1) > (existing.achievement ?? -1)) {
      group.charts.set(key, candidate);
    }
  }

  const songs = [...groups.values()].map((group) => {
    const charts = [...group.charts.values()].map((chart) => {
      const timed = group.songId && chart.played
        ? timedLookup.get(`${group.songId}\0${chart.type}\0${chart.difficulty}`)
        : null;
      if (!timed) return chart;
      return {
        ...chart,
        bestTimedPlay: {
          achievement: timed.achievement,
          dxScore: timed.dxScore,
          fastCount: timed.fastCount,
          lateCount: timed.lateCount,
          playedAt: timed.playedAtIso,
          matchesBest: timed.achievement === chart.achievement
        }
      };
    }).sort(compareCharts);
    return {
      songId: group.songId,
      hasJacket: group.hasJacket,
      title: group.title,
      artist: group.artist,
      category: group.category,
      searchAliases: group.searchAliases,
      playedChartCount: charts.filter((chart) => chart.played).length,
      availableChartCount: charts.length,
      charts
    };
  }).sort((a, b) => a.title.localeCompare(b.title));

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    player: {
      name: account?.player?.name || 'Player',
      region: account?.player?.region || account?.region || null,
      title: account?.extra?.title || account?.player?.title || account?.title || null,
      avatarUrl: publicAvatarUrl(account)
    },
    gameVersion: finiteNumber(account?.gameVersion),
    metrics: {
      rating: finiteNumber(account?.metrics?.rating ?? account?.rating),
      playCount: finiteNumber(account?.metrics?.playCount ?? account?.playCount),
      songCount: songs.length,
      playedChartCount: songs.reduce((sum, song) => sum + song.playedChartCount, 0)
    },
    updatedAt: account?.sourceFetchedAt || account?.updatedAt || null,
    recentPlays: (Array.isArray(recentPlays) ? recentPlays : [])
      .map((play) => publicRecentPlay(play, songCatalog))
      .filter(Boolean)
      .slice(0, 24),
    songs
  };
}
