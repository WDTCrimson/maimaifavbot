import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

const CANVAS_WIDTH = 1200;
const TARGET_HEIGHT = 204;
const PADDING = 36;
const FONT_FAMILY_DEFAULT = 'Inter, Murecho, "Noto Sans JP", sans-serif';
const FONT_FAMILY_MONO_DEFAULT = 'Geist Mono, monospace';
const IMAGE_CACHE = new Map();
const REGISTERED_FONTS = new Set();
const ASSET_ROOT = join(process.cwd(), 'data', 'assets', 'tomomai', 'res');

const VERSION_SETTINGS = {
  10: { charScale: 0.56, charLeft: 620, charTop: -100 },
  11: { charScale: 0.70, charLeft: 680, charTop: -100 },
  12: { charScale: 0.60, charLeft: 660, charTop: -30  },
  13: { charScale: 0.65, charLeft: 660, charTop: -30  },
};

const BASE_SCORE_PER_TYPE = {
  tap: 500,
  hold: 1000,
  slide: 1500,
  touch: 500,
  break: 2500
};

const JUDGMENT_MULTIPLIERS = {
  perfect: 1.0,
  great: 0.8,
  good: 0.5,
  miss: 0.0
};

const BREAK_JUDGMENT_MULTIPLIERS = {
  criticalPerfect: 1.0,
  perfect: 1.0,
  great2000: 0.8,
  great1500: 0.6,
  great1250: 0.5,
  good: 0.4,
  miss: 0.0
};

const BREAK_BONUS_MULTIPLIER = {
  criticalPerfect: 1.0,
  perfect2550: 0.75,
  perfect2500: 0.5,
  great2000: 0.4,
  great1500: 0.4,
  great1250: 0.4,
  good: 0.3,
  miss: 0.0
};

function font(weight, size, mono = false) {
  return `${weight} ${size}px ${mono ? FONT_FAMILY_MONO_DEFAULT : FONT_FAMILY_DEFAULT}`;
}

async function fileExists(path) {
  try {
    const fileStat = await stat(path);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function measureTextWidth(ctx, text) {
  return ctx.measureText(text).width;
}

function getRatingPlateVariant(rating, gameVersion) {
  const value = Number(rating) || 0;
  const version = Number(gameVersion) || 0;
  if (value >= 16000 && version >= 13) return 'kiwami';
  if (value >= 15000) return 'rainbow';
  if (value >= 14500) return 'platinum';
  if (value >= 14000) return 'gold';
  if (value >= 13000) return 'silver';
  if (value >= 12000) return 'bronze';
  if (value >= 10000) return 'purple';
  if (value >= 7000) return 'red';
  if (value >= 4000) return 'orange';
  if (value >= 2000) return 'green';
  if (value >= 1) return 'blue';
  return 'normal';
}

function resolveRatingPlatePath(rating, gameVersion) {
  return join(ASSET_ROOT, 'rating', `${getRatingPlateVariant(rating, gameVersion)}.png`);
}

function resolveTrophyPath(titleType) {
  const key = String(titleType || 'normal').toLowerCase();
  return join(ASSET_ROOT, 'trophy', `${key}.png`);
}

function resolveLocalJacketPath(track) {
  const candidates = [
    track?.jacket?.dxratingFile ? join(process.cwd(), 'data', 'assets', 'jacket', 'dxrating', track.jacket.dxratingFile) : null,
    track?.jacket?.otogeFile ? join(process.cwd(), 'data', 'assets', 'jacket', 'otoge-db', track.jacket.otogeFile) : null
  ].filter(Boolean);
  return candidates;
}

function resolveLocalTypeBadgePath(track) {
  const normalized = String(track?.type || 'std').toLowerCase();
  const fileName = normalized === 'dx' ? 'music_dx.png' : 'music_standard.png';
  return join(process.cwd(), 'data', 'assets', 'maimai-ui', fileName);
}

function getRemoteTypeBadgeUrl(track) {
  if (track?.typeIconUrl) {
    return track.typeIconUrl;
  }
  return track?.type === 'dx'
    ? 'https://maimaidx-eng.com/maimai-mobile/img/music_dx.png'
    : 'https://maimaidx-eng.com/maimai-mobile/img/music_standard.png';
}


async function registerFonts() {
  if (REGISTERED_FONTS.size) {
    return;
  }

  const mappings = [
    ['FOT-NewRodin Pro', join(ASSET_ROOT, 'fonts', 'FOT-NewRodin Pro EB.woff2')],
    ['Inter', join(ASSET_ROOT, 'fonts', 'Inter-VariableFont_opsz,wght.woff2')],
    ['Murecho', join(ASSET_ROOT, 'fonts', 'Murecho-VariableFont_wght.woff2')],
    ['Noto Sans JP', join(ASSET_ROOT, 'fonts', 'NotoSansJP-VariableFont_wght.woff2')],
    ['Geist Mono', join(ASSET_ROOT, 'fonts', 'GeistMono-VariableFont_wght.woff2')]
  ];

  for (const [family, path] of mappings) {
    if (await fileExists(path)) {
      FontLibrary.use(family, [path]);
      REGISTERED_FONTS.add(family);
    }
  }
}

async function loadCachedImage(path) {
  const key = String(path || '');
  if (!key) {
    return null;
  }
  if (IMAGE_CACHE.has(key)) {
    return IMAGE_CACHE.get(key);
  }
  const promise = (async () => {
    if (/^https?:\/\//i.test(key) || /^data:/i.test(key)) {
      return loadImage(key);
    }
    if (!(await fileExists(key))) {
      return null;
    }
    return loadImage(key);
  })();
  IMAGE_CACHE.set(key, promise);
  return promise;
}

function pickGameVersion(gameVersion) {
  const version = Number(gameVersion);
  if (Number.isFinite(version) && version >= 10 && version <= 13) {
    return version;
  }
  return 13;
}

function createOverlayRect(canvasHeight) {
  const overlayTop = TARGET_HEIGHT + PADDING * 2;
  return {
    left: PADDING,
    top: overlayTop,
    width: CANVAS_WIDTH - PADDING * 2,
    height: canvasHeight - TARGET_HEIGHT - PADDING * 3
  };
}

function mapAccountToSnapshot(account) {
  return {
    displayName: account?.player?.name || 'Player',
    iconUrl: account?.extra?.iconUrl || account?.player?.iconUrl || null,
    title: account?.extra?.title || account?.player?.title || '',
    titleType: account?.extra?.titleType || 'normal',
    rating: Number(account?.metrics?.rating) || 0,
    playCount: account?.metrics?.playCount ?? null,
    classRankUrl: account?.extra?.classRankUrl || null,
    courseRankUrl: account?.extra?.courseRankUrl || null,
    gameVersion: pickGameVersion(account?.gameVersion)
  };
}

function groupRecentCredits(recentSessions) {
  const plays = Array.isArray(recentSessions)
    ? recentSessions
        .map((play, index) => ({ ...play, __index: index }))
        .filter((play) => Number.isFinite(Number(play.track)))
    : [];

  const credits = [];
  let current = [];

  for (let i = 0; i < plays.length; i += 1) {
    const play = plays[i];
    current.push(play);
    const next = plays[i + 1];
    const currentTrack = Number(play.track);
    const nextTrack = Number(next?.track);
    const isLastTrack = i === plays.length - 1 || nextTrack >= currentTrack;
    if (isLastTrack) {
      credits.push(current.slice());
      current = [];
    }
  }

  return credits;
}

function createTrackPayload(track) {
  const internalLevelValue = Number(track?.internalLevelValue);
  const parsedLevelPrecise = Number.isFinite(internalLevelValue)
    ? Math.round(internalLevelValue * 10)
    : (() => {
        const match = String(track?.level || '').match(/(\d+)(\+)?/);
        if (!match) return 0;
        return Number.parseInt(match[1], 10) * 10 + (match[2] ? 7 : 0);
      })();

  return {
    songName: track?.title || 'Unknown Song',
    coverCandidates: resolveLocalJacketPath(track),
    difficulty: String(track?.difficulty || 'master').toLowerCase(),
    level: String(track?.level || '?'),
    levelPrecise: parsedLevelPrecise,
    type: String(track?.type || 'std').toLowerCase(),
    typeIconUrl: track?.typeIconUrl || null,
    achievement: Number(track?.achievement) || 0,
    dxScore: Number(track?.dxScore) || 0,
    maxDxScore: Number(track?.maxDxScore) || 0,
    fc: track?.fc || 'none',
    fs: track?.fs || 'none',
    track: Number(track?.track) || 1,
    playedAtIso: track?.playedAtIso || null,
    details: track?.details || null
  };
}

function buildCreditPayload(account) {
  const credits = groupRecentCredits(account?.recentSessions || []);
  if (!credits.length) {
    return null;
  }

  const latest = credits[0]
    .slice()
    .sort((a, b) => Number(a.track) - Number(b.track));
  const playedAtIso = latest[0]?.playedAtIso || latest[0]?.playedAt || account?.sourceFetchedAt || new Date().toISOString();

  return {
    playedAt: new Date(playedAtIso),
    tracks: latest.map(createTrackPayload)
  };
}

function calculateDXStars(dxScore, maxDxScore) {
  if (!Number.isFinite(dxScore) || !Number.isFinite(maxDxScore) || maxDxScore <= 0) {
    return 0;
  }
  const percent = (dxScore / maxDxScore) * 100;
  if (percent >= 97) return 5;
  if (percent >= 95) return 4;
  if (percent >= 93) return 3;
  if (percent >= 90) return 2;
  if (percent >= 85) return 1;
  return 0;
}

function calculateAchievement(notes, breakDist) {
  const totalTap = notes.tap.criticalPerfect + notes.tap.perfect + notes.tap.great + notes.tap.good + notes.tap.miss;
  const totalHold = notes.hold.criticalPerfect + notes.hold.perfect + notes.hold.great + notes.hold.good + notes.hold.miss;
  const totalSlide = notes.slide.criticalPerfect + notes.slide.perfect + notes.slide.great + notes.slide.good + notes.slide.miss;
  const totalTouch = notes.touch.criticalPerfect + notes.touch.perfect + notes.touch.great + notes.touch.good + notes.touch.miss;
  const totalBreak = notes.break.criticalPerfect + notes.break.perfect + notes.break.great + notes.break.good + notes.break.miss;
  const totalBaseScore = totalTap * BASE_SCORE_PER_TYPE.tap + totalHold * BASE_SCORE_PER_TYPE.hold + totalSlide * BASE_SCORE_PER_TYPE.slide + totalTouch * BASE_SCORE_PER_TYPE.touch + totalBreak * BASE_SCORE_PER_TYPE.break;
  if (totalBaseScore === 0) return 0;

  let actualScore = 0;
  actualScore += notes.tap.criticalPerfect * BASE_SCORE_PER_TYPE.tap * JUDGMENT_MULTIPLIERS.perfect;
  actualScore += notes.tap.perfect * BASE_SCORE_PER_TYPE.tap * JUDGMENT_MULTIPLIERS.perfect;
  actualScore += notes.tap.great * BASE_SCORE_PER_TYPE.tap * JUDGMENT_MULTIPLIERS.great;
  actualScore += notes.tap.good * BASE_SCORE_PER_TYPE.tap * JUDGMENT_MULTIPLIERS.good;
  actualScore += notes.hold.criticalPerfect * BASE_SCORE_PER_TYPE.hold * JUDGMENT_MULTIPLIERS.perfect;
  actualScore += notes.hold.perfect * BASE_SCORE_PER_TYPE.hold * JUDGMENT_MULTIPLIERS.perfect;
  actualScore += notes.hold.great * BASE_SCORE_PER_TYPE.hold * JUDGMENT_MULTIPLIERS.great;
  actualScore += notes.hold.good * BASE_SCORE_PER_TYPE.hold * JUDGMENT_MULTIPLIERS.good;
  actualScore += notes.slide.criticalPerfect * BASE_SCORE_PER_TYPE.slide * JUDGMENT_MULTIPLIERS.perfect;
  actualScore += notes.slide.perfect * BASE_SCORE_PER_TYPE.slide * JUDGMENT_MULTIPLIERS.perfect;
  actualScore += notes.slide.great * BASE_SCORE_PER_TYPE.slide * JUDGMENT_MULTIPLIERS.great;
  actualScore += notes.slide.good * BASE_SCORE_PER_TYPE.slide * JUDGMENT_MULTIPLIERS.good;
  actualScore += notes.touch.criticalPerfect * BASE_SCORE_PER_TYPE.touch * JUDGMENT_MULTIPLIERS.perfect;
  actualScore += notes.touch.perfect * BASE_SCORE_PER_TYPE.touch * JUDGMENT_MULTIPLIERS.perfect;
  actualScore += notes.touch.great * BASE_SCORE_PER_TYPE.touch * JUDGMENT_MULTIPLIERS.great;
  actualScore += notes.touch.good * BASE_SCORE_PER_TYPE.touch * JUDGMENT_MULTIPLIERS.good;
  actualScore += notes.break.criticalPerfect * BASE_SCORE_PER_TYPE.break * BREAK_JUDGMENT_MULTIPLIERS.criticalPerfect;
  actualScore += notes.break.perfect * BASE_SCORE_PER_TYPE.break * BREAK_JUDGMENT_MULTIPLIERS.perfect;
  actualScore += breakDist.great2000 * BASE_SCORE_PER_TYPE.break * BREAK_JUDGMENT_MULTIPLIERS.great2000;
  actualScore += breakDist.great1500 * BASE_SCORE_PER_TYPE.break * BREAK_JUDGMENT_MULTIPLIERS.great1500;
  actualScore += breakDist.great1250 * BASE_SCORE_PER_TYPE.break * BREAK_JUDGMENT_MULTIPLIERS.great1250;
  actualScore += notes.break.good * BASE_SCORE_PER_TYPE.break * BREAK_JUDGMENT_MULTIPLIERS.good;

  let bonusPoints = 0;
  let totalBonusPoints = 0;
  bonusPoints += notes.break.criticalPerfect * BREAK_BONUS_MULTIPLIER.criticalPerfect;
  bonusPoints += breakDist.perfect2550 * BREAK_BONUS_MULTIPLIER.perfect2550;
  bonusPoints += breakDist.perfect2500 * BREAK_BONUS_MULTIPLIER.perfect2500;
  bonusPoints += breakDist.great2000 * BREAK_BONUS_MULTIPLIER.great2000;
  bonusPoints += breakDist.great1500 * BREAK_BONUS_MULTIPLIER.great1500;
  bonusPoints += breakDist.great1250 * BREAK_BONUS_MULTIPLIER.great1250;
  bonusPoints += notes.break.good * BREAK_BONUS_MULTIPLIER.good;
  totalBonusPoints += notes.break.criticalPerfect + notes.break.perfect + notes.break.great + notes.break.good + notes.break.miss;

  const scorePerPercentage = totalBaseScore / 100;
  return actualScore / scorePerPercentage + (totalBonusPoints ? bonusPoints / totalBonusPoints : 0);
}

function distributeBreaks(notes, actualAchievement, perfectCount, greatCount) {
  let bestDist = { perfect2550: perfectCount, perfect2500: 0, great2000: greatCount, great1500: 0, great1250: 0 };
  let bestDiff = Infinity;
  for (let p2550 = 0; p2550 <= perfectCount; p2550 += 1) {
    const p2500 = perfectCount - p2550;
    for (let g2000 = 0; g2000 <= greatCount; g2000 += 1) {
      for (let g1500 = 0; g1500 <= greatCount - g2000; g1500 += 1) {
        const g1250 = greatCount - g2000 - g1500;
        const dist = { perfect2550: p2550, perfect2500: p2500, great2000: g2000, great1500: g1500, great1250: g1250 };
        const diff = Math.abs(calculateAchievement(notes, dist) - actualAchievement);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestDist = dist;
        }
        if (diff < 0.00001) {
          return bestDist;
        }
      }
    }
  }
  return bestDist;
}

function calculateNoteLosses(notes, breakDist) {
  const totalTap = notes.tap.criticalPerfect + notes.tap.perfect + notes.tap.great + notes.tap.good + notes.tap.miss;
  const totalHold = notes.hold.criticalPerfect + notes.hold.perfect + notes.hold.great + notes.hold.good + notes.hold.miss;
  const totalSlide = notes.slide.criticalPerfect + notes.slide.perfect + notes.slide.great + notes.slide.good + notes.slide.miss;
  const totalTouch = notes.touch.criticalPerfect + notes.touch.perfect + notes.touch.great + notes.touch.good + notes.touch.miss;
  const totalBreak = notes.break.criticalPerfect + notes.break.perfect + notes.break.great + notes.break.good + notes.break.miss;
  const totalBaseScore = totalTap * BASE_SCORE_PER_TYPE.tap + totalHold * BASE_SCORE_PER_TYPE.hold + totalSlide * BASE_SCORE_PER_TYPE.slide + totalTouch * BASE_SCORE_PER_TYPE.touch + totalBreak * BASE_SCORE_PER_TYPE.break;
  const scorePerPercentage = totalBaseScore / 100;
  const calcRegularLoss = (count, baseScore, multiplier) => {
    if (scorePerPercentage === 0 || count === 0) return 0;
    return ((count * baseScore * JUDGMENT_MULTIPLIERS.perfect) - (count * baseScore * multiplier)) / scorePerPercentage;
  };
  const calcBreakPerfectLoss = () => {
    if (scorePerPercentage === 0 || totalBreak === 0 || notes.break.perfect === 0) return 0;
    const cpScore = notes.break.perfect * BASE_SCORE_PER_TYPE.break + notes.break.perfect * 100;
    const actualScore = breakDist.perfect2550 * 2550 + breakDist.perfect2500 * 2500;
    return (cpScore - actualScore) / scorePerPercentage;
  };
  const calcBreakGreatLoss = () => {
    if (scorePerPercentage === 0 || notes.break.great === 0) return 0;
    const cpScore = notes.break.great * BASE_SCORE_PER_TYPE.break + notes.break.great * 100;
    const actualScore = breakDist.great2000 * 2000 + breakDist.great1500 * 1500 + breakDist.great1250 * 1250;
    return (cpScore - actualScore) / scorePerPercentage;
  };
  return {
    tap: { great: calcRegularLoss(notes.tap.great, BASE_SCORE_PER_TYPE.tap, JUDGMENT_MULTIPLIERS.great), good: calcRegularLoss(notes.tap.good, BASE_SCORE_PER_TYPE.tap, JUDGMENT_MULTIPLIERS.good), miss: calcRegularLoss(notes.tap.miss, BASE_SCORE_PER_TYPE.tap, JUDGMENT_MULTIPLIERS.miss) },
    hold: { great: calcRegularLoss(notes.hold.great, BASE_SCORE_PER_TYPE.hold, JUDGMENT_MULTIPLIERS.great), good: calcRegularLoss(notes.hold.good, BASE_SCORE_PER_TYPE.hold, JUDGMENT_MULTIPLIERS.good), miss: calcRegularLoss(notes.hold.miss, BASE_SCORE_PER_TYPE.hold, JUDGMENT_MULTIPLIERS.miss) },
    slide: { great: calcRegularLoss(notes.slide.great, BASE_SCORE_PER_TYPE.slide, JUDGMENT_MULTIPLIERS.great), good: calcRegularLoss(notes.slide.good, BASE_SCORE_PER_TYPE.slide, JUDGMENT_MULTIPLIERS.good), miss: calcRegularLoss(notes.slide.miss, BASE_SCORE_PER_TYPE.slide, JUDGMENT_MULTIPLIERS.miss) },
    touch: { great: calcRegularLoss(notes.touch.great, BASE_SCORE_PER_TYPE.touch, JUDGMENT_MULTIPLIERS.great), good: calcRegularLoss(notes.touch.good, BASE_SCORE_PER_TYPE.touch, JUDGMENT_MULTIPLIERS.good), miss: calcRegularLoss(notes.touch.miss, BASE_SCORE_PER_TYPE.touch, JUDGMENT_MULTIPLIERS.miss) },
    break: { perfect: calcBreakPerfectLoss(), great: calcBreakGreatLoss(), good: calcRegularLoss(notes.break.good, BASE_SCORE_PER_TYPE.break, BREAK_JUDGMENT_MULTIPLIERS.good), miss: calcRegularLoss(notes.break.miss, BASE_SCORE_PER_TYPE.break, BREAK_JUDGMENT_MULTIPLIERS.miss) }
  };
}

async function getScoreTextSize(path) {
  const numberImg = await loadCachedImage(path);
  return numberImg ? { width: numberImg.width / 4, height: numberImg.height / 4 } : { width: 0, height: 0 };
}

async function renderScoreText(ctx, colorPath, text, x, y, scale, tintColor, borderColor, borderWidth = 2) {
  const numberImg = await loadCachedImage(colorPath);
  if (!numberImg) {
    return;
  }
  const textSlots = {
    '0': [0, 0], '1': [1, 0], '2': [2, 0], '3': [3, 0], '4': [0, 1], '5': [1, 1], '6': [2, 1], '7': [3, 1], '8': [0, 2], '9': [1, 2], '+': [2, 2], '-': [3, 2], ',': [0, 3], '.': [1, 3], lv: [2, 3]
  };
  const section = textSlots[text];
  if (!section) {
    return;
  }
  const [xSubsection, ySubsection] = section;
  const wSection = numberImg.width / 4;
  const hSection = numberImg.height / 4;

  if (tintColor || borderColor) {
    const padding = borderColor ? borderWidth : 0;
    const tempCanvas = new Canvas(wSection * scale + padding * 2, hSection * scale + padding * 2);
    const tempCtx = tempCanvas.getContext('2d');
    if (borderColor) {
      const borderCanvas = new Canvas(wSection * scale + padding * 2, hSection * scale + padding * 2);
      const borderCtx = borderCanvas.getContext('2d');
      const offsets = [];
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        offsets.push({ x: Math.cos(angle) * borderWidth, y: Math.sin(angle) * borderWidth });
      }
      for (const offset of offsets) {
        borderCtx.drawImage(numberImg, wSection * xSubsection, hSection * ySubsection, wSection, hSection, padding + offset.x, padding + offset.y, wSection * scale, hSection * scale);
      }
      borderCtx.globalCompositeOperation = 'source-in';
      borderCtx.fillStyle = borderColor;
      borderCtx.fillRect(0, 0, borderCanvas.width, borderCanvas.height);
      tempCtx.drawImage(borderCanvas, 0, 0);
    }
    const textCanvas = new Canvas(wSection * scale, hSection * scale);
    const textCtx = textCanvas.getContext('2d');
    textCtx.drawImage(numberImg, wSection * xSubsection, hSection * ySubsection, wSection, hSection, 0, 0, wSection * scale, hSection * scale);
    if (tintColor) {
      textCtx.globalCompositeOperation = 'source-in';
      textCtx.fillStyle = tintColor;
      textCtx.fillRect(0, 0, wSection * scale, hSection * scale);
    }
    tempCtx.drawImage(textCanvas, padding, padding);
    ctx.drawImage(tempCanvas, x - padding, y - padding);
    return;
  }

  ctx.drawImage(numberImg, wSection * xSubsection, hSection * ySubsection, wSection, hSection, x, y, wSection * scale, hSection * scale);
}

async function renderBackground(ctx, gameVersion, long) {
  const canvasHeight = ctx.canvas.height;
  const background = await loadCachedImage(join(ASSET_ROOT, 'bg', `${gameVersion}${long ? '_long' : ''}.png`));
  if (background) {
    ctx.drawImage(background, 0, 0, CANVAS_WIDTH * 2, canvasHeight * 2, 0, 0, CANVAS_WIDTH, canvasHeight);
  }

  const vs = VERSION_SETTINGS[gameVersion] || VERSION_SETTINGS[13];
  const charImg = await loadCachedImage(join(ASSET_ROOT, 'character', `${gameVersion}.png`));
  if (charImg) {
    ctx.save();
    ctx.globalAlpha = 0.90;
    ctx.drawImage(charImg, vs.charLeft, vs.charTop, charImg.width * vs.charScale, charImg.height * vs.charScale);
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeight);
}

async function renderHeader(ctx, snapshot) {
  const ICON_SZ = 100;
  const headerMid = PADDING + TARGET_HEIGHT / 2;
  const iconX = PADDING, iconY = headerMid - ICON_SZ / 2;

  // dark header panel
  ctx.fillStyle = 'rgba(0,0,0,0.40)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, TARGET_HEIGHT + PADDING * 2);

  // --- left: profile icon ---
  const profile = snapshot.iconUrl ? await loadCachedImage(snapshot.iconUrl) : null;
  if (profile) {
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, iconX, iconY, ICON_SZ, ICON_SZ, 10);
    ctx.clip();
    const ratio = Math.max(ICON_SZ / profile.width, ICON_SZ / profile.height);
    const pw = profile.width * ratio, ph = profile.height * ratio;
    ctx.drawImage(profile, iconX + (ICON_SZ - pw) / 2, iconY + (ICON_SZ - ph) / 2, pw, ph);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    roundRect(ctx, iconX, iconY, ICON_SZ, ICON_SZ, 10);
    ctx.fill();
  }

  // --- left text stack ---
  const tx = PADDING + ICON_SZ + 18;
  ctx.textAlign = 'left';

  const titleStr = snapshot.title || '';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
  if (titleStr) {
    ctx.font = font(500, 13);
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(titleStr).width;
    const pH = 22, pY = PADDING + TARGET_HEIGHT / 2 - 46;
    ctx.fillStyle = 'rgba(255,220,80,0.18)'; ctx.shadowBlur = 0;
    roundRect(ctx, tx, pY, tw + 20, pH, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,80,0.38)'; ctx.lineWidth = 1;
    roundRect(ctx, tx, pY, tw + 20, pH, 3); ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,100,0.9)'; ctx.shadowBlur = 5;
    ctx.fillText(titleStr, tx + 10, pY + pH - 5);
  }
  ctx.restore();

  const midY = PADDING + TARGET_HEIGHT / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
  ctx.font = font(700, 26); ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(snapshot.displayName, tx, midY + 12);

  if (snapshot.playCount != null) {
    ctx.font = font(500, 13); ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`${Number(snapshot.playCount).toLocaleString()} plays`, tx, midY + 32);
  }
  ctx.restore();

  // --- right cluster (right-to-left): version logo → class rank → rating frame ---
  let rx = CANVAS_WIDTH - PADDING;

  const logoImg = await loadCachedImage(join(ASSET_ROOT, 'logo', `${snapshot.gameVersion}.png`));
  if (logoImg) {
    const lh = TARGET_HEIGHT * 0.48;
    const lw = logoImg.width * (lh / logoImg.height);
    rx -= lw;
    ctx.drawImage(logoImg, rx, headerMid - lh / 2, lw, lh);
    rx -= 16;
  }

  const classRank = snapshot.classRankUrl ? await loadCachedImage(snapshot.classRankUrl) : null;
  if (classRank) {
    const dh = classRank.height * 0.7, dw = classRank.width * 0.7;
    rx -= dw;
    ctx.drawImage(classRank, rx, headerMid - dh / 2, dw, dh);
    rx -= 14;
  }

  const courseRank = snapshot.courseRankUrl ? await loadCachedImage(snapshot.courseRankUrl) : null;
  if (courseRank) {
    const dh = courseRank.height * 0.6, dw = courseRank.width * 0.6;
    rx -= dw;
    ctx.drawImage(courseRank, rx, headerMid - dh / 2, dw, dh);
    rx -= 14;
  }

  const ratingFrame = await loadCachedImage(resolveRatingPlatePath(snapshot.rating, snapshot.gameVersion));
  if (ratingFrame) {
    const rs = 0.75;
    const fw = ratingFrame.width * rs, fh = ratingFrame.height * rs;
    rx -= fw;
    ctx.drawImage(ratingFrame, rx, headerMid - fh / 2, fw, fh);
    ctx.font = font(600, Math.round(fh * 0.53), true);
    ctx.fillStyle = '#f9f0f4';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let dx = rx + fw * 0.43;
    for (const char of String(snapshot.rating || 0)) {
      ctx.fillText(char, dx, headerMid - fh / 2 + fh * 0.72);
      dx += 23;
    }
  }

  return createOverlayRect(ctx.canvas.height);
}

async function drawCover(ctx, coverCandidates, left, top, width, height) {
  for (const candidate of coverCandidates || []) {
    const image = await loadCachedImage(candidate);
    if (image) {
      ctx.drawImage(image, left + width * 35 / 288, top + height * 38 / 288, width * 214 / 288, height * 214 / 288);
      return;
    }
  }
}

async function renderTrack(ctx, overlayRect, track, index, trackCount, overallScale) {
  const difficulty = String(track.difficulty || 'master');
  const trackShell = await loadCachedImage(join(ASSET_ROOT, 'songs', `track_${index === 0 ? '1' : index === trackCount - 1 ? '3' : '2'}.png`));
  const base = await loadCachedImage(join(ASSET_ROOT, 'songs', `song_${difficulty}.png`));
  const jacket = await loadCachedImage(join(ASSET_ROOT, 'songs', `music_jacket_${difficulty}.png`));
  if (!base || !jacket) {
    return;
  }

  const baseScale = overallScale;
  const baseWidth = base.width * baseScale;
  const baseHeight = base.height * baseScale;
  const jacketWidth = jacket.width * overallScale;
  const jacketHeight = jacket.height * overallScale;
  const trackImageScale = 1.25 * overallScale;
  const xGap = 10;
  const yGap = 520 * overallScale;
  const yPad = (trackCount === 4 ? 60 : 70) * overallScale;
  const totalWidth = jacketWidth + xGap + baseWidth;
  const leftStart = overlayRect.left + overlayRect.width / 2 - totalWidth / 2;
  let topStart = overlayRect.top + yPad + (baseHeight + yGap) * index;
  const baseLeftStart = leftStart + jacketWidth + xGap;
  let bottomTopStart = topStart + baseHeight + 10;

  if (trackShell) {
    ctx.drawImage(trackShell, leftStart + 16 * overallScale + totalWidth - trackShell.width * trackImageScale, topStart, trackShell.width * trackImageScale, trackShell.height * trackImageScale);
    ctx.drawImage(trackShell, trackShell.width * 0.8, 0, trackShell.width * 0.2, trackShell.height, leftStart + 16 * overallScale + totalWidth, topStart, 1000, trackShell.height * trackImageScale);
    await renderScoreText(ctx, join(ASSET_ROOT, 'numbers', 'score_num_count_big.png'), String(index + 1), leftStart + 16 * overallScale + totalWidth - trackShell.width * trackImageScale * 0.37, topStart + trackShell.height * trackImageScale * 0.08, 0.47 * trackImageScale, index === 0 ? '#4691F7' : index === trackCount - 1 ? '#FE5134' : '#5EC724', '#FFFFFF', 2);
    await renderScoreText(ctx, join(ASSET_ROOT, 'numbers', 'score_num_count.png'), String(trackCount), leftStart + 16 * overallScale + totalWidth - trackShell.width * trackImageScale * 0.21, topStart + trackShell.height * trackImageScale * 0.2, 0.54 * trackImageScale, index === 0 ? '#4691F7' : index === trackCount - 1 ? '#FE5134' : '#5EC724', '#FFFFFF', 2);
    topStart += trackShell.height * trackImageScale + 10;
    bottomTopStart += trackShell.height * trackImageScale + 10;
  }

  ctx.drawImage(jacket, leftStart, topStart, jacketWidth, jacketHeight);
  await drawCover(ctx, track.coverCandidates, leftStart, topStart, jacketWidth, jacketHeight);
  ctx.drawImage(base, baseLeftStart, topStart, baseWidth, baseHeight);

  ctx.save();
  ctx.font = `600 ${(24 * overallScale).toFixed(0)}px "FOT-NewRodin Pro", ${FONT_FAMILY_DEFAULT}`;
  ctx.fillStyle = '#FFFFFF';
  const songNameWidth = ctx.measureText(track.songName).width;
  ctx.fillText(track.songName, baseLeftStart + baseWidth / 2 - songNameWidth / 2, topStart + baseHeight * 0.46);
  ctx.restore();

  const achievementText = `${(track.achievement / 10000).toFixed(4)}`;
  const bigColor = track.achievement >= 970000 ? 'big_gold' : track.achievement >= 800000 ? 'big_red' : 'big_blue';
  const color = track.achievement >= 970000 ? 'gold' : track.achievement >= 800000 ? 'red' : 'blue';
  const bigPath = join(ASSET_ROOT, 'numbers', `score_${bigColor}.png`);
  const smallPath = join(ASSET_ROOT, 'numbers', `score_${color}.png`);
  const percentage = await loadCachedImage(join(ASSET_ROOT, 'numbers', `percentage_${color}.png`));
  const achievementBigSize = await getScoreTextSize(bigPath);
  const achievementSize = await getScoreTextSize(smallPath);
  const bigAchievementScale = 0.7 * overallScale;
  const achievementDigitsScale = 0.7 * overallScale;
  const nonNumberScale = 0.7 * overallScale;
  const bigAchievementXSpread = -6;
  const achievementXSpread = -12;
  const specialX = { '.': -10, '1': -4 };
  const specialXSpread = { '.': -37, '1': -14 };
  const totalAchievementWidth = (() => {
    let width = 0;
    let passedDot = false;
    for (const char of achievementText) {
      const scale = char === '.' ? nonNumberScale : passedDot ? achievementDigitsScale : bigAchievementScale;
      if (!Number.isNaN(Number(char))) {
        width += (!passedDot ? achievementBigSize.width * scale + bigAchievementXSpread * scale : achievementSize.width * scale + achievementXSpread * scale);
      } else {
        width += achievementSize.width * scale;
        passedDot = true;
      }
      width += (specialXSpread[char] || 0) * scale;
    }
    return width + (percentage ? percentage.width * 0.7 * overallScale : 0);
  })();
  let achievementX = baseLeftStart + baseWidth / 2 - totalAchievementWidth / 2;
  const achievementY = topStart + baseHeight * 0.62;
  let passedDot = false;
  for (const char of achievementText.split('')) {
    passedDot = char === '.' || passedDot;
    const path = passedDot ? smallPath : bigPath;
    const scale = char === '.' ? nonNumberScale : passedDot ? achievementDigitsScale : bigAchievementScale;
    const drawX = achievementX + (specialX[char] || 0);
    const drawY = achievementY + achievementBigSize.height * bigAchievementScale - (passedDot ? achievementSize.height : achievementBigSize.height) * scale - (passedDot && char !== '.' ? 10 : 0) * scale;
    await renderScoreText(ctx, path, char, drawX, drawY, scale);
    achievementX += char === '.' ? achievementSize.width * nonNumberScale : (!passedDot ? achievementBigSize.width * bigAchievementScale + bigAchievementXSpread * scale : achievementSize.width * achievementDigitsScale + achievementXSpread * scale);
    achievementX += (specialXSpread[char] || 0) * scale;
  }
  if (percentage) {
    const percentageScale = 0.7 * overallScale;
    ctx.drawImage(percentage, achievementX, achievementY + achievementBigSize.height * bigAchievementScale - percentage.height * percentageScale * 1.45, percentage.width * percentageScale, percentage.height * percentageScale);
  }

  const typeBadge =
    (await loadCachedImage(resolveLocalTypeBadgePath(track)))
    || (await loadCachedImage(getRemoteTypeBadgeUrl(track)));
  if (typeBadge) {
    const typeScale = 0.9 * overallScale;
    ctx.drawImage(typeBadge, baseLeftStart + baseWidth * 0.63, topStart + baseHeight * 0.22, typeBadge.width * typeScale, typeBadge.height * typeScale);
  }

  const levelPath = join(ASSET_ROOT, 'numbers', `level_${difficulty}.png`);
  await renderScoreText(ctx, levelPath, 'lv', baseLeftStart + baseWidth * 0.78, topStart + baseHeight * 0.15, overallScale);
  let x = baseLeftStart + baseWidth * 0.83;
  const y = topStart + baseHeight * 0.15;
  if (track.level[0] !== '1') x += baseWidth * 0.008;
  for (const char of String(track.level || '').split('')) {
    await renderScoreText(ctx, levelPath, char, x - (char === '+' ? baseWidth * 0.01 : 0), y - (char === '+' ? baseHeight * 0.02 : 0), overallScale);
    if (String(track.level || '').length > 1 && char !== '+') {
      x += baseWidth * 0.041;
      if (char !== '1') x += baseWidth * 0.008;
    }
  }
  await renderScoreText(ctx, levelPath, '.', x - baseWidth * 0.02, y + baseHeight * 0.04, overallScale);
  await renderScoreText(ctx, levelPath, String(track.levelPrecise % 10), x + baseWidth * 0.0155 - (String(track.levelPrecise % 10) === '1' ? 0.005 * baseWidth : 0), y + baseHeight * 0.055, 0.7 * overallScale);

  const table = await loadCachedImage(join(ASSET_ROOT, 'songs', 'score_table.png'));
  const tableScale = overallScale;
  const tableX = leftStart + xGap;
  const tableY = bottomTopStart;
  const tableWidth = table ? table.width * tableScale : 0;
  const tableHeight = table ? table.height * tableScale : 0;
  if (table) {
    ctx.save();
    ctx.shadowColor = '#00000050';
    ctx.shadowBlur = 10;
    if (!track.details) {
      ctx.globalAlpha = 0.7;
    }
    ctx.drawImage(table, tableX, tableY, tableWidth, tableHeight);
    ctx.restore();
  }

  if (track.details && tableWidth && tableHeight) {
    const notes = {
      tap: { criticalPerfect: track.details.tapCPerfect, perfect: track.details.tapPerfect, great: track.details.tapGreat, good: track.details.tapGood, miss: track.details.tapMiss },
      hold: { criticalPerfect: track.details.holdCPerfect, perfect: track.details.holdPerfect, great: track.details.holdGreat, good: track.details.holdGood, miss: track.details.holdMiss },
      slide: { criticalPerfect: track.details.slideCPerfect, perfect: track.details.slidePerfect, great: track.details.slideGreat, good: track.details.slideGood, miss: track.details.slideMiss },
      touch: { criticalPerfect: track.details.touchCPerfect, perfect: track.details.touchPerfect, great: track.details.touchGreat, good: track.details.touchGood, miss: track.details.touchMiss },
      break: { criticalPerfect: track.details.breakCPerfect, perfect: track.details.breakPerfect, great: track.details.breakGreat, good: track.details.breakGood, miss: track.details.breakMiss }
    };
    const breakDist = distributeBreaks(notes, track.achievement / 10000, track.details.breakPerfect ?? 0, track.details.breakGreat ?? 0);
    const losses = calculateNoteLosses(notes, breakDist);
    const columnColor = ['#FFA103', '#FF7E24', '#F74999', '#34B939', '#73746F'];
    const matrix = [
      [{ c: track.details.tapCPerfect }, { c: track.details.tapPerfect }, { c: track.details.tapGreat, p: losses.tap.great }, { c: track.details.tapGood, p: losses.tap.good }, { c: track.details.tapMiss, p: losses.tap.miss }],
      [{ c: track.details.holdCPerfect }, { c: track.details.holdPerfect }, { c: track.details.holdGreat, p: losses.hold.great }, { c: track.details.holdGood, p: losses.hold.good }, { c: track.details.holdMiss, p: losses.hold.miss }],
      [{ c: track.details.slideCPerfect }, { c: track.details.slidePerfect }, { c: track.details.slideGreat, p: losses.slide.great }, { c: track.details.slideGood, p: losses.slide.good }, { c: track.details.slideMiss, p: losses.slide.miss }],
      [{ c: track.details.touchCPerfect }, { c: track.details.touchPerfect }, { c: track.details.touchGreat, p: losses.touch.great }, { c: track.details.touchGood, p: losses.touch.good }, { c: track.details.touchMiss, p: losses.touch.miss }],
      [{ c: track.details.breakCPerfect }, { c: `${breakDist.perfect2550}-${breakDist.perfect2500}`, p: losses.break.perfect }, { c: `${breakDist.great2000}-${breakDist.great1500}-${breakDist.great1250}`, p: losses.break.great }, { c: track.details.breakGood, p: losses.break.good }, { c: track.details.breakMiss, p: losses.break.miss }]
    ];
    const cellX = tableX + (124 / 701) * tableWidth;
    const cellY = tableY + (62 / 360) * tableHeight;
    const cellWidth = (113 / 701) * tableWidth;
    const cellHeight = (57 / 360) * tableHeight;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < matrix.length; i += 1) {
      for (let j = 0; j < matrix[i].length; j += 1) {
        const item = matrix[i][j];
        ctx.font = font(500, 24 * tableScale, true);
        ctx.fillStyle = columnColor[j];
        const rowY = cellY + cellHeight * i + cellHeight * (item.p === undefined ? 0.5 : 0.35);
        ctx.fillText(String(item.c), cellX + cellWidth * j + cellWidth * 0.9, rowY);
        if (item.p !== undefined) {
          ctx.font = font(400, 18 * tableScale, true);
          ctx.fillText(`-${item.p.toFixed(4)}%`, cellX + cellWidth * j + cellWidth * 0.9, rowY + 0.4 * cellHeight);
        }
      }
    }
    ctx.restore();
  }

  const fastLate = await loadCachedImage(join(ASSET_ROOT, 'songs', 'fast_late.png'));
  const rightBoxCenter = tableX + tableWidth + xGap + (totalWidth - xGap * 4 - tableWidth) / 2;
  let fastLateY = tableY + tableHeight;
  if (fastLate) {
    const fastLateScale = 0.8 * overallScale;
    const fastLateX = rightBoxCenter - fastLate.width * fastLateScale / 2;
    fastLateY = tableY + tableHeight - fastLate.height * fastLateScale + 16 * overallScale;
    ctx.save();
    ctx.shadowBlur = 32 * fastLateScale;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    if (!track.details) {
      ctx.globalAlpha = 0.7;
    }
    ctx.drawImage(fastLate, fastLateX, fastLateY, fastLate.width * fastLateScale, fastLate.height * fastLateScale);
    ctx.restore();
    if (track.details) {
      ctx.save();
      ctx.font = font(500, fastLateScale * 30, true);
      ctx.fillStyle = '#1368D4';
      ctx.textAlign = 'right';
      ctx.fillText(String(track.details.fastCount), fastLateX + fastLate.width * fastLateScale * 0.6, fastLateY + fastLate.height * fastLateScale * 0.39);
      ctx.fillStyle = '#F8420B';
      ctx.fillText(String(track.details.lateCount), fastLateX + fastLate.width * fastLateScale * 0.87, fastLateY + fastLate.height * fastLateScale * 0.82);
      ctx.restore();
    }
  }

  const baseImage = await loadCachedImage(join(ASSET_ROOT, 'icons', 'base.png'));
  if (baseImage) {
    const baseImageScale = 0.8 * overallScale;
    const xBase = rightBoxCenter - baseImage.width * baseImageScale / 2;
    const yBase = fastLateY - 2 * overallScale - baseImage.height * baseImageScale;
    ctx.drawImage(baseImage, xBase, yBase, baseImage.width * baseImageScale, baseImage.height * baseImageScale);
    const fcConfig = {
      none: null,
      fc: { base: 'fc_base', text: 'fc' },
      'fc+': { base: 'fc_base', text: 'fc+' },
      ap: { base: 'ap_base', text: 'ap' },
      'ap+': { base: 'ap_base', text: 'ap+' }
    };
    const fsConfig = {
      none: null,
      sync: { base: 'sync_base', text: 'sync' },
      fs: { base: 'fs_base', text: 'fs' },
      'fs+': { base: 'fs_base', text: 'fs+' },
      fdx: { base: 'fdx_base', text: 'fdx' },
      'fdx+': { base: 'fdx_base', text: 'fdx+' }
    };
    if (fcConfig[track.fc]) {
      const fcImage = await loadCachedImage(join(ASSET_ROOT, 'icons', `${fcConfig[track.fc].base}.png`));
      const fcText = await loadCachedImage(join(ASSET_ROOT, 'icons', `${fcConfig[track.fc].text}.png`));
      if (fcImage && fcText) {
        const drawX = xBase - fcImage.width * baseImageScale / 2 + baseImage.width * baseImageScale * 0.28;
        const drawY = yBase - fcImage.height * baseImageScale / 2 + baseImage.height * baseImageScale * 0.43;
        ctx.drawImage(fcImage, drawX, drawY, fcImage.width * baseImageScale, fcImage.height * baseImageScale);
        ctx.drawImage(fcText, drawX + fcImage.width * baseImageScale / 2 - fcText.width * baseImageScale / 2, drawY + fcImage.height * baseImageScale / 2 - fcText.height * baseImageScale / 2, fcText.width * baseImageScale, fcText.height * baseImageScale);
      }
    }
    if (fsConfig[track.fs]) {
      const fsImage = await loadCachedImage(join(ASSET_ROOT, 'icons', `${fsConfig[track.fs].base}.png`));
      const fsText = await loadCachedImage(join(ASSET_ROOT, 'icons', `${fsConfig[track.fs].text}.png`));
      if (fsImage && fsText) {
        const drawX = xBase - fsImage.width * baseImageScale / 2 + baseImage.width * baseImageScale * 0.69;
        const drawY = yBase - fsImage.height * baseImageScale / 2 + baseImage.height * baseImageScale * 0.43;
        ctx.drawImage(fsImage, drawX, drawY, fsImage.width * baseImageScale, fsImage.height * baseImageScale);
        ctx.drawImage(fsText, drawX + fsImage.width * baseImageScale / 2 - fsText.width * baseImageScale / 2, drawY + fsImage.height * baseImageScale / 2 - fsText.height * baseImageScale / 2, fsText.width * baseImageScale, fsText.height * baseImageScale);
      }
    }
  }

  const dxScoreImage = await loadCachedImage(join(ASSET_ROOT, 'songs', 'dxscore.png'));
  if (dxScoreImage) {
    const dxScoreScale = 1.2 * overallScale;
    const x = rightBoxCenter - dxScoreImage.width * dxScoreScale / 2;
    const y = tableY;
    ctx.drawImage(dxScoreImage, x, y, dxScoreImage.width * dxScoreScale, dxScoreImage.height * dxScoreScale);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const percentageText = `${((track.dxScore / Math.max(1, track.maxDxScore)) * 100).toFixed(2)}%`;
    ctx.font = font(500, dxScoreScale * 16, true);
    const percentageWidth = ctx.measureText(percentageText).width;
    ctx.fillText(percentageText, x + dxScoreImage.width * dxScoreScale - percentageWidth / 2, y + dxScoreImage.height * dxScoreScale * 0.84);
    ctx.font = font(500, dxScoreScale * 20, true);
    ctx.fillStyle = '#1368D4';
    const dxScoreText = String(track.dxScore);
    const maxDxScoreText = String(track.maxDxScore);
    const dxScoreWidth = ctx.measureText(dxScoreText).width;
    ctx.font = font(500, dxScoreScale * 16, true);
    const slashWidth = ctx.measureText('/').width;
    const maxDxScoreWidth = ctx.measureText(maxDxScoreText).width;
    const textTotalWidth = dxScoreWidth + slashWidth + maxDxScoreWidth;
    const centerX = x + (dxScoreImage.width * dxScoreScale - percentageWidth - 8 * overallScale) / 2;
    const baselineY = y + dxScoreImage.height * dxScoreScale * 0.84;
    let currentX = centerX - textTotalWidth / 2;
    ctx.font = font(500, dxScoreScale * 20, true);
    ctx.fillText(dxScoreText, currentX + dxScoreWidth / 2, baselineY);
    currentX += dxScoreWidth;
    ctx.font = font(500, dxScoreScale * 16, true);
    ctx.fillText('/', currentX + slashWidth / 2, baselineY - 1);
    currentX += slashWidth;
    ctx.fillText(maxDxScoreText, currentX + maxDxScoreWidth / 2, baselineY);
    ctx.restore();

    const dxStars = calculateDXStars(track.dxScore, track.maxDxScore);
    if (dxStars > 0) {
      const starImage = await loadCachedImage(join(ASSET_ROOT, 'songs', `star_${dxStars >= 5 ? 3 : dxStars >= 3 ? 2 : 1}.png`));
      if (starImage) {
        const dxStarsScale = overallScale;
        const gapX = 6 * dxStarsScale;
        const paddingX = 18 * dxStarsScale;
        const paddingY = 5 * dxStarsScale;
        const marginY = 8 * dxStarsScale;
        const totalStarsWidth = starImage.width * dxStarsScale * dxStars + gapX * (dxStars - 1);
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.shadowBlur = 6 * dxStarsScale;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
        const roundRectHeight = starImage.height * dxStarsScale + paddingY * 2;
        roundRect(ctx, x + dxScoreImage.width * dxScoreScale / 2 - totalStarsWidth / 2 - paddingX, y + dxScoreImage.height * dxScoreScale + marginY, totalStarsWidth + paddingX * 2, roundRectHeight, roundRectHeight / 2);
        ctx.fill();
        ctx.restore();
        for (let i = 0; i < dxStars; i += 1) {
          ctx.drawImage(starImage, x + dxScoreImage.width * dxScoreScale / 2 - totalStarsWidth / 2 + i * (starImage.width * dxStarsScale + gapX), y + dxScoreImage.height * dxScoreScale + paddingY + marginY, starImage.width * dxStarsScale, starImage.height * dxStarsScale);
        }
      }
    }
  }
}

async function renderLastCreditContent(ctx, credit, overlayRect) {
  for (let i = 0; i < credit.tracks.length; i += 1) {
    await renderTrack(ctx, overlayRect, credit.tracks[i], i, credit.tracks.length, credit.tracks.length <= 2 ? 1.0 : 0.84);
  }
}

async function renderFooter(ctx, _gameVersion, text) {
  const footerHeight = 50;
  const footerTop = ctx.canvas.height - footerHeight;
  ctx.fillStyle = 'rgba(0,0,0,0.40)';
  ctx.fillRect(0, footerTop, CANVAS_WIDTH, footerHeight);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, footerTop, CANVAS_WIDTH, 1);
  ctx.font = font(500, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, CANVAS_WIDTH / 2, footerTop + footerHeight / 2);
}

function sanitizeFileName(text) {
  const value = String(text || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return value || 'recent-credit';
}

export async function renderAccountRecentGraphic({ account }) {
  await registerFonts();
  const snapshot = mapAccountToSnapshot(account);
  const credit = buildCreditPayload(account);
  if (!credit) {
    throw new Error('No recent credit data available. Run /account sync first.');
  }

  const long = credit.tracks.length >= 4;
  const canvasHeight = long ? 3100 : 2420;
  const canvas = new Canvas(CANVAS_WIDTH, canvasHeight);
  const ctx = canvas.getContext('2d');
  await renderBackground(ctx, snapshot.gameVersion, true);
  const overlayRect = await renderHeader(ctx, snapshot);
  await renderLastCreditContent(ctx, credit, overlayRect);
  const footerText = `Recent credit at ${credit.playedAt.toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}, rendered by MaiFav Bot`;
  await renderFooter(ctx, snapshot.gameVersion, footerText);

  const buffer = await canvas.toBuffer('png');
  return {
    buffer,
    fileName: `${sanitizeFileName(account?.player?.name || 'account')}-recent-credit.png`
  };
}
