const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const INTL_LOGIN_URL =
  'https://lng-tgk-aime-gw.am-all.net/common_auth/login?site_id=maimaidxex&redirect_url=https://maimaidx-eng.com/maimai-mobile/&back_url=https://maimai.sega.com/';
const INTL_PLAYER_DATA_URL = 'https://maimaidx-eng.com/maimai-mobile/playerData/';
const INTL_RECORD_URL = 'https://maimaidx-eng.com/maimai-mobile/record/';
const INTL_SCORE_SEARCH_URL =
  'https://maimaidx-eng.com/maimai-mobile/record/musicGenre/search/?genre=99&diff=';

const CONFUSABLE_CHAR_MAP = new Map([
  ['Α', 'A'], ['α', 'a'], ['Β', 'B'], ['β', 'b'], ['Ε', 'E'], ['ε', 'e'], ['Ζ', 'Z'], ['ζ', 'z'],
  ['Η', 'H'], ['η', 'h'], ['Ι', 'I'], ['ι', 'i'], ['Κ', 'K'], ['κ', 'k'], ['Μ', 'M'], ['μ', 'm'],
  ['Ν', 'N'], ['ν', 'n'], ['Ο', 'O'], ['ο', 'o'], ['Ρ', 'P'], ['ρ', 'p'], ['Τ', 'T'], ['τ', 't'],
  ['Υ', 'Y'], ['υ', 'y'], ['Χ', 'X'], ['χ', 'x'], ['Λ', 'A'], ['λ', 'a'], ['Δ', 'A'], ['δ', 'a'],
  ['Φ', 'O'], ['φ', 'o'], ['Ω', 'O'], ['ω', 'o'],
  ['А', 'A'], ['а', 'a'], ['В', 'B'], ['Е', 'E'], ['е', 'e'], ['К', 'K'], ['М', 'M'], ['Н', 'H'],
  ['О', 'O'], ['о', 'o'], ['Р', 'P'], ['р', 'p'], ['С', 'C'], ['с', 'c'], ['Т', 'T'], ['Х', 'X'],
  ['х', 'x'], ['У', 'Y'], ['у', 'y'], ['І', 'I'], ['і', 'i'], ['Ј', 'J'], ['ј', 'j']
]);

const difficultyNames = ['basic', 'advanced', 'expert', 'master', 'remaster'];
const difficultySelectors = [
  '.music_basic_score_back',
  '.music_advanced_score_back',
  '.music_expert_score_back',
  '.music_master_score_back',
  '.music_remaster_score_back'
];

async function loadCheerio() {
  const mod = await import('cheerio');
  return mod.load;
}

function foldConfusableChars(value) {
  return Array.from(String(value || ''), (char) => CONFUSABLE_CHAR_MAP.get(char) || char).join('');
}

function normalizeTitle(value) {
  return foldConfusableChars(String(value || ''))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitleLoose(value) {
  const base = normalizeTitle(value)
    .replace(/[|｜].*$/u, '')
    .replace(/[\(\)（）\[\]【】「」『』〈〉<>]/gu, ' ');

  return base
    .replace(/[ーｰ]/gu, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function normalizeIntlClalToken(value) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error('Missing International maimai auth token.');
  }

  const withoutPrefix = text.startsWith('clal=') ? text.slice(5) : text;
  if (!/^[A-Za-z0-9]{32,128}$/.test(withoutPrefix)) {
    throw new Error('Invalid International maimai auth token format.');
  }

  return withoutPrefix;
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }

  const single = response.headers.get('set-cookie');
  if (!single) {
    return [];
  }

  return single
    .split(/,(?=[^;]+=[^;]+)/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function mergeCookies(...cookieCollections) {
  const map = new Map();

  for (const cookies of cookieCollections) {
    for (const cookie of cookies || []) {
      const part = String(cookie || '').split(';')[0].trim();
      const index = part.indexOf('=');
      if (index <= 0) {
        continue;
      }
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (!name) {
        continue;
      }
      map.set(name, value);
    }
  }

  return Array.from(map.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function getRatingFactor(accuracy) {
  if (accuracy >= 100.5) return 0.224;
  if (accuracy >= 100) return 0.216;
  if (accuracy >= 99.5) return 0.211;
  if (accuracy >= 99) return 0.208;
  if (accuracy >= 98) return 0.203;
  if (accuracy >= 97) return 0.2;
  if (accuracy >= 94) return 0.168;
  if (accuracy >= 90) return 0.152;
  if (accuracy >= 80) return 0.136;
  if (accuracy >= 75) return 0.12;
  if (accuracy >= 70) return 0.112;
  if (accuracy >= 60) return 0.096;
  if (accuracy >= 50) return 0.08;
  return 0.05;
}

function calculateChartRating({ achievement, fc, internalLevelValue }) {
  const accuracy = achievement / 10000;
  const factor = getRatingFactor(accuracy);
  const extra = fc === 'ap' || fc === 'ap+' ? 1 : 0;
  return Math.floor(factor * Math.min(accuracy, 100.5) * internalLevelValue / 10 + extra);
}

const VERSION_ID_BY_NAME = new Map(
  [
    ['maimai', -13],
    ['maimai plus', -12],
    ['green', -11],
    ['green plus', -10],
    ['orange', -9],
    ['orange plus', -8],
    ['pink', -7],
    ['pink plus', -6],
    ['murasaki', -5],
    ['murasaki plus', -4],
    ['milk', -3],
    ['milk plus', -2],
    ['finale', -1],
    ['maimaiでらっくす', 0],
    ['maimai dx', 0],
    ['dx', 0],
    ['maimaiでらっくす plus', 1],
    ['maimai dx plus', 1],
    ['dx plus', 1],
    ['splash', 2],
    ['splash plus', 3],
    ['universe', 4],
    ['universe plus', 5],
    ['festival', 6],
    ['festival plus', 7],
    ['buddies', 8],
    ['buddies plus', 9],
    ['prism', 10],
    ['prism plus', 11],
    ['circle', 12],
    ['circle plus', 13]
  ].map(([name, id]) => [normalizeVersionName(name), id])
);

const INTL_VERSION_RELEASES = [
  { id: -13, releaseDate: '2012/07/11' },
  { id: -12, releaseDate: '2012/12/13' },
  { id: -11, releaseDate: '2013/07/11' },
  { id: -10, releaseDate: '2014/02/26' },
  { id: -9, releaseDate: '2014/09/18' },
  { id: -8, releaseDate: '2015/03/19' },
  { id: -7, releaseDate: '2015/12/09' },
  { id: -6, releaseDate: '2016/06/30' },
  { id: -5, releaseDate: '2016/12/15' },
  { id: -4, releaseDate: '2017/06/22' },
  { id: -3, releaseDate: '2017/12/14' },
  { id: -2, releaseDate: '2018/06/21' },
  { id: -1, releaseDate: '2018/12/13' },
  { id: 0, releaseDate: '2019/11/25' },
  { id: 1, releaseDate: '2020/07/29' },
  { id: 2, releaseDate: '2021/01/29' },
  { id: 3, releaseDate: '2021/07/30' },
  { id: 4, releaseDate: '2022/01/27' },
  { id: 5, releaseDate: '2022/07/28' },
  { id: 6, releaseDate: '2023/01/19' },
  { id: 7, releaseDate: '2023/07/27' },
  { id: 8, releaseDate: '2024/01/18' },
  { id: 9, releaseDate: '2024/07/25' },
  { id: 10, releaseDate: '2025/01/16' },
  { id: 11, releaseDate: '2025/07/24' },
  { id: 12, releaseDate: '2026/01/22' }
];

function normalizeVersionName(version) {
  return String(version || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIntlReleaseDate(value) {
  const [year, month, day] = String(value || '')
    .split('/')
    .map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    return Number.NaN;
  }
  return Date.parse(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+09:00`);
}

function resolveChartVersionId(version) {
  const normalized = normalizeVersionName(version);
  if (!normalized) {
    return null;
  }
  return VERSION_ID_BY_NAME.get(normalized) ?? null;
}

function getCurrentIntlVersionId(now = Date.now()) {
  let currentVersionId = null;

  for (const version of INTL_VERSION_RELEASES) {
    const releaseTime = parseIntlReleaseDate(version.releaseDate);
    if (!Number.isFinite(releaseTime) || releaseTime > now) {
      continue;
    }
    if (currentVersionId == null || version.id > currentVersionId) {
      currentVersionId = version.id;
    }
  }

  return currentVersionId;
}

function buildChartMatcher(songCatalog) {
  const exact = new Map();
  const loose = new Map();

  for (const song of songCatalog?.songs || []) {
    const norm = normalizeTitle(song.title);
    const soft = normalizeTitleLoose(song.title);
    if (norm) {
      if (!exact.has(norm)) {
        exact.set(norm, []);
      }
      exact.get(norm).push(song);
    }
    if (soft) {
      if (!loose.has(soft)) {
        loose.set(soft, []);
      }
      loose.get(soft).push(song);
    }
  }

  function resolve(rawTitle, type, difficulty, level) {
    const norm = normalizeTitle(rawTitle);
    const soft = normalizeTitleLoose(rawTitle);
    const candidates = [
      ...(exact.get(norm) || []),
      ...(loose.get(soft) || [])
    ];

    const uniqueCandidates = [...new Map(candidates.map((song) => [song.favoriteId, song])).values()];
    let best = null;

    for (const song of uniqueCandidates) {
      for (const chart of Array.isArray(song.difficultyLevels) ? song.difficultyLevels : []) {
        const chartType = String(chart.type || '').trim().toLowerCase();
        const chartDifficulty = String(chart.difficulty || '').trim().toLowerCase();
        if (chartType !== type || chartDifficulty !== difficulty) {
          continue;
        }

        let score = 0;
        if (normalizeTitle(song.title) === norm) score += 50;
        if (normalizeTitleLoose(song.title) === soft) score += 20;
        if (String(chart.level || '').trim() === String(level || '').trim()) score += 10;

        const candidate = { song, chart, score };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      }
    }

    return best ? { song: best.song, chart: best.chart } : null;
  }

  return { resolve };
}

function mapMusicTypeFromIcon(iconSrc) {
  const src = String(iconSrc || '');
  if (src.includes('music_dx.png')) {
    return 'dx';
  }
  if (src.includes('music_standard.png')) {
    return 'std';
  }
  return null;
}

function parseFcFsFromIcons(srcList) {
  let fs = 'none';
  let fc = 'none';

  const first = String(srcList[0] || '');
  if (first.includes('_fdxp.png')) fs = 'fdx+';
  else if (first.includes('_fdx.png')) fs = 'fdx';
  else if (first.includes('_fsp.png')) fs = 'fs+';
  else if (first.includes('_fs.png')) fs = 'fs';
  else if (first.includes('_sync.png')) fs = 'sync';

  const second = String(srcList[1] || '');
  if (second.includes('_app.png')) fc = 'ap+';
  else if (second.includes('_ap.png')) fc = 'ap';
  else if (second.includes('_fcp.png')) fc = 'fc+';
  else if (second.includes('_fc.png')) fc = 'fc';

  return { fc, fs };
}

async function validateInternationalCookie(clalToken) {
  const response = await fetch(INTL_LOGIN_URL, {
    method: 'GET',
    headers: {
      Cookie: `clal=${clalToken}`,
      'User-Agent': USER_AGENT
    },
    redirect: 'manual'
  });

  if (response.status === 302) {
    return {
      redirectUrl: response.headers.get('location') || 'https://maimaidx-eng.com/maimai-mobile/'
    };
  }

  if (response.status === 200) {
    throw new Error('The saved maimai login cookie is expired or invalid. Re-link the account.');
  }

  throw new Error(`Unexpected response while validating the saved maimai cookie: HTTP ${response.status}`);
}

async function getCookiesFromRedirect(redirectUrl, clalToken) {
  const response = await fetch(redirectUrl, {
    method: 'GET',
    headers: {
      Cookie: `clal=${clalToken}`,
      'User-Agent': USER_AGENT
    },
    redirect: 'manual'
  });

  const cookies = mergeCookies([`clal=${clalToken}`], getSetCookieHeaders(response));
  if (!cookies) {
    throw new Error('Could not establish a maimai web session from the saved login cookie.');
  }

  return cookies;
}

async function fetchText(url, { cookies, referer }) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Cookie: cookies,
      Referer: referer,
      'User-Agent': USER_AGENT
    }
  });

  if (response.status !== 200) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchPlayerDataHtml(cookies, refererUrl) {
  const html = await fetchText(INTL_PLAYER_DATA_URL, {
    cookies,
    referer: refererUrl
  });

  if (html.includes('ERROR CODE：100001') || html.includes('Please login again')) {
    throw new Error('The maimai web session expired before player data could be fetched.');
  }

  return html;
}

async function extractPlayerSnapshot(html) {
  const load = await loadCheerio();
  const $ = load(html);
  const block = $('.see_through_block').first();
  if (!block.length) {
    throw new Error('Could not locate the maimai player profile block.');
  }

  const name = block.find('.name_block').first().text().trim();
  if (!name) {
    throw new Error('Could not extract the maimai player name.');
  }

  const ratingText = block.find('.rating_block').first().text().trim();
  const rating = Number.parseInt(ratingText.replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(rating)) {
    throw new Error(`Could not parse the maimai rating from: ${ratingText}`);
  }

  const playCountText = block.find('.t_r.f_12').first().text().replace(/\s+/g, ' ').trim();
  const currentMatch = playCountText.match(/play count of current version[：:]\s*([\d,]+)/i);
  const totalMatch = playCountText.match(/maimaiDX total play count[：:]\s*([\d,]+)/i);
  const currentVersionPlayCount = currentMatch
    ? Number.parseInt(currentMatch[1].replaceAll(',', ''), 10)
    : null;
  const totalPlayCount = totalMatch
    ? Number.parseInt(totalMatch[1].replaceAll(',', ''), 10)
    : null;
  const title = block.find('.trophy_block').first().text().trim() || null;

  return {
    player: {
      name,
      region: 'intl',
      title
    },
    metrics: {
      rating,
      playCount: Number.isFinite(totalPlayCount) ? totalPlayCount : currentVersionPlayCount
    },
    extra: {
      currentVersionPlayCount,
      totalPlayCount,
      title
    }
  };
}

async function fetchRecentPlays(cookies) {
  const html = await fetchText(INTL_RECORD_URL, {
    cookies,
    referer: 'https://maimaidx-eng.com/maimai-mobile/'
  });
  const load = await loadCheerio();
  const $ = load(html);
  const records = $('form[action*="playlogDetail/"]');
  const recent = [];

  records.each((index, element) => {
    try {
      const record = $(element);
      const songName = record.find('.basic_block.p_10.f_13.break').text().trim();
      if (!songName) {
        return;
      }

      const diffImg = record.find('img.playlog_diff').attr('src') || '';
      let difficulty = null;
      if (diffImg.includes('basic')) difficulty = 'basic';
      else if (diffImg.includes('advanced')) difficulty = 'advanced';
      else if (diffImg.includes('expert')) difficulty = 'expert';
      else if (diffImg.includes('master')) difficulty = 'master';
      else if (diffImg.includes('remaster')) difficulty = 'remaster';
      if (!difficulty) {
        return;
      }

      const level = record.find('.playlog_score_block > .f_r.f_14').first().text().trim();
      const achievementText = record.find('.playlog_achievement_txt').text().trim();
      const achievementMatch = achievementText.match(/(\d+\.?\d*)%/);
      if (!achievementMatch) {
        return;
      }

      const dxScoreText = record.find('.playlog_score_block > .f_15').text().trim();
      const dxScoreMatch = dxScoreText.match(/(\d+)\s*\/\s*(\d+)/);
      if (!dxScoreMatch) {
        return;
      }

      const resultImages = record
        .find('.playlog_result_innerblock > img')
        .map((_, img) => $(img).attr('src') || '')
        .get();
      const { fc, fs } = parseFcFsFromIcons(resultImages);

      const track = Number.parseInt(record.find('.playlog_track_num').text().trim(), 10) || index + 1;
      const playedAtText = record.find('.sub_title').text().trim();
      const playedAt = playedAtText ? playedAtText : null;

      const musicKindIcon = record.find('img.playlog_music_kind_icon').attr('src') || '';
      const musicType = musicKindIcon.includes('music_dx.png') ? 'dx' : 'std';

      recent.push({
        title: songName,
        difficulty,
        level,
        type: musicType,
        achievement: Math.round(Number.parseFloat(achievementMatch[1]) * 10000),
        dxScore: Number.parseInt(dxScoreMatch[1], 10),
        maxDxScore: Number.parseInt(dxScoreMatch[2], 10),
        fc,
        fs,
        track,
        playedAt,
        sortIndex: index
      });
    } catch {
      // ignore individual parse failures
    }
  });

  return recent;
}

async function fetchScoresForDifficulty(cookies, difficultyNumber) {
  const selector = difficultySelectors[difficultyNumber];
  const difficultyName = difficultyNames[difficultyNumber];
  const html = await fetchText(`${INTL_SCORE_SEARCH_URL}${difficultyNumber}`, {
    cookies,
    referer: 'https://maimaidx-eng.com/maimai-mobile/'
  });
  const load = await loadCheerio();
  const $ = load(html);
  const blocks = $(selector);
  const scores = [];

  blocks.each((_, element) => {
    try {
      const block = $(element);
      const scoreBlocks = block.find('.music_score_block');
      if (scoreBlocks.length < 2) {
        return;
      }

      const parent = block.parent();
      const musicType = mapMusicTypeFromIcon(parent.find('img.music_kind_icon').attr('src') || '');
      if (!musicType) {
        return;
      }

      const songName = block.find('.music_name_block').text().trim();
      const level = block.find('.music_lv_block').text().trim();
      if (!songName) {
        return;
      }

      const achievementText = scoreBlocks.eq(0).text().trim();
      const achievementMatch = achievementText.match(/(\d+\.?\d*)%/);
      if (!achievementMatch) {
        return;
      }

      const dxScoreText = scoreBlocks.eq(1).text().trim();
      const dxScoreMatch = dxScoreText.match(/(\d+)\s*\/\s*(\d+)/);
      if (!dxScoreMatch) {
        return;
      }

      const h30Sources = block
        .find('.h_30')
        .map((_, img) => $(img).attr('src') || '')
        .get();
      const { fc, fs } = parseFcFsFromIcons(h30Sources);

      scores.push({
        title: songName,
        difficulty: difficultyName,
        level,
        type: musicType,
        achievement: Math.round(Number.parseFloat(achievementMatch[1]) * 10000),
        dxScore: Number.parseInt(dxScoreMatch[1], 10),
        maxDxScore: Number.parseInt(dxScoreMatch[2], 10),
        fc,
        fs
      });
    } catch {
      // ignore individual parse failures
    }
  });

  return scores;
}

async function fetchAllScores(cookies) {
  const pages = await Promise.all(
    difficultyNames.map((_, difficultyNumber) => fetchScoresForDifficulty(cookies, difficultyNumber))
  );
  return pages.flat();
}

function buildBest50(scores, songCatalog) {
  if (!songCatalog?.available) {
    return null;
  }

  const matcher = buildChartMatcher(songCatalog);
  const currentVersionId = getCurrentIntlVersionId();
  const versionAboveIsNew =
    currentVersionId != null ? (currentVersionId >= 12 ? currentVersionId - 1 : currentVersionId) : null;
  const rated = [];

  for (const score of scores) {
    const matched = matcher.resolve(score.title, score.type, score.difficulty, score.level);
    if (!matched) {
      continue;
    }

    const internalLevelValue = Number.parseFloat(String(matched.chart.internalLevelValue));
    if (!Number.isFinite(internalLevelValue)) {
      continue;
    }

    const rating = calculateChartRating({
      achievement: score.achievement,
      fc: score.fc,
      internalLevelValue
    });

    const addedVersion = resolveChartVersionId(matched.chart.version);
    rated.push({
      favoriteId: matched.song.favoriteId,
      title: matched.song.title,
      artist: matched.song.artist,
      type: score.type,
      difficulty: score.difficulty,
      level: score.level,
      achievement: score.achievement,
      dxScore: score.dxScore,
      maxDxScore: score.maxDxScore,
      fc: score.fc,
      fs: score.fs,
      internalLevelValue,
      version: matched.chart.version || null,
      addedVersion,
      rating,
      bucket:
        versionAboveIsNew != null && addedVersion != null && addedVersion >= versionAboveIsNew
          ? 'new'
          : 'old'
    });
  }

  rated.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return b.achievement - a.achievement;
  });

  const b15 = rated.filter((entry) => entry.bucket === 'new').slice(0, 15);
  const b35 = rated.filter((entry) => entry.bucket === 'old').slice(0, 35);
  const top50 = [...b15, ...b35].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return b.achievement - a.achievement;
  });

  return {
    b15,
    b35,
    top50,
    currentVersionId,
    versionAboveIsNew,
    totalRating: top50.reduce((sum, entry) => sum + entry.rating, 0),
    songCount: top50.length
  };
}

function enrichRecentPlays(recentPlays, songCatalog) {
  if (!songCatalog?.available) {
    return recentPlays.slice(0, 15);
  }

  const matcher = buildChartMatcher(songCatalog);
  return recentPlays.slice(0, 15).map((play) => {
    const matched = matcher.resolve(play.title, play.type, play.difficulty, play.level);
    if (!matched) {
      return play;
    }

    const internalLevelValue = Number.parseFloat(String(matched.chart.internalLevelValue));
    const rating = Number.isFinite(internalLevelValue)
      ? calculateChartRating({
          achievement: play.achievement,
          fc: play.fc,
          internalLevelValue
        })
      : null;

    return {
      ...play,
      favoriteId: matched.song.favoriteId,
      artist: matched.song.artist,
      internalLevelValue: Number.isFinite(internalLevelValue) ? internalLevelValue : null,
      rating
    };
  });
}

export async function fetchIntlAccountDataFromClal(rawToken, songCatalog = null) {
  const clalToken = normalizeIntlClalToken(rawToken);
  const validation = await validateInternationalCookie(clalToken);
  const cookies = await getCookiesFromRedirect(validation.redirectUrl, clalToken);

  const [playerDataHtml, recentPlays, scoreEntries] = await Promise.all([
    fetchPlayerDataHtml(cookies, validation.redirectUrl),
    fetchRecentPlays(cookies),
    fetchAllScores(cookies)
  ]);

  const profile = await extractPlayerSnapshot(playerDataHtml);
  const best50 = buildBest50(scoreEntries, songCatalog);
  const recentSessions = enrichRecentPlays(recentPlays, songCatalog);

  return {
    token: clalToken,
    snapshot: {
      provider: 'manual',
      linkMethod: 'web',
      player: profile.player,
      metrics: {
        ...profile.metrics,
        bestCount: best50 ? best50.top50.length : null,
        recentCount: recentSessions.length
      },
      sourceFetchedAt: new Date().toISOString(),
      best50,
      recentSessions,
      extra: profile.extra
    }
  };
}

export async function fetchIntlAccountSnapshotFromClal(rawToken, songCatalog = null) {
  const result = await fetchIntlAccountDataFromClal(rawToken, songCatalog);
  return {
    token: result.token,
    snapshot: result.snapshot
  };
}
