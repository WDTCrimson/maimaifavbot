import { load } from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const INTL_LOGIN_URL =
  'https://lng-tgk-aime-gw.am-all.net/common_auth/login?site_id=maimaidxex&redirect_url=https://maimaidx-eng.com/maimai-mobile/&back_url=https://maimai.sega.com/';
const INTL_PLAYER_DATA_URL = 'https://maimaidx-eng.com/maimai-mobile/playerData/';

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

async function fetchPlayerDataHtml(cookies, refererUrl) {
  const response = await fetch(INTL_PLAYER_DATA_URL, {
    method: 'GET',
    headers: {
      Cookie: cookies,
      Referer: refererUrl,
      'User-Agent': USER_AGENT
    }
  });

  if (response.status !== 200) {
    throw new Error(`Failed to fetch maimai player data: HTTP ${response.status}`);
  }

  const html = await response.text();
  if (html.includes('ERROR CODE：100001') || html.includes('Please login again')) {
    throw new Error('The maimai web session expired before player data could be fetched.');
  }

  return html;
}

function extractPlayerSnapshot(html) {
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

  return {
    provider: 'manual',
    linkMethod: 'web',
    player: {
      name,
      region: 'intl'
    },
    metrics: {
      rating,
      playCount: Number.isFinite(totalPlayCount) ? totalPlayCount : currentVersionPlayCount
    },
    sourceFetchedAt: new Date().toISOString()
  };
}

export async function fetchIntlAccountSnapshotFromClal(rawToken) {
  const clalToken = normalizeIntlClalToken(rawToken);
  const validation = await validateInternationalCookie(clalToken);
  const cookies = await getCookiesFromRedirect(validation.redirectUrl, clalToken);
  const snapshot = extractPlayerSnapshot(await fetchPlayerDataHtml(cookies, validation.redirectUrl));
  return {
    snapshot,
    token: clalToken
  };
}
