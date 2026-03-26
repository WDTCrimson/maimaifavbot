function decodePayload(raw) {
  const normalized = raw.trim().replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(normalized + '==='.slice((normalized.length + 3) % 4));
  const payload = JSON.parse(decoded);

  if (!payload || !Array.isArray(payload.songIds)) {
    throw new Error('Payload is missing songIds.');
  }

  const songIds = payload.songIds
    .map((value) => String(value).trim())
    .filter((value) => /^\d{1,8}$/.test(value));

  if (!songIds.length) {
    throw new Error('Payload has no valid song IDs.');
  }

  return {
    name: payload.name || 'unnamed-loadout',
    songIds: new Set(songIds)
  };
}

function getSongIdFromRow(row) {
  const directDataset = row.dataset?.musicId || row.dataset?.songId;
  if (directDataset && /^\d{1,8}$/.test(directDataset)) {
    return String(directDataset);
  }

  const attrs = ['data-music-id', 'data-song-id'];
  for (const attr of attrs) {
    const value = row.getAttribute(attr);
    if (value && /^\d{1,8}$/.test(value)) {
      return String(value);
    }
  }

  const text = row.textContent || '';
  const match = text.match(/\b(\d{3,8})\b/);
  return match ? match[1] : null;
}

function findFavoriteControl(row) {
  return row.querySelector(
    '[class*=favorite], [class*=favo], [aria-label*=favorite i], [title*=favorite i], img[src*=favorite i], img[src*=favo i]'
  );
}

function favoriteState(control) {
  const signal = [
    control.className || '',
    control.getAttribute('aria-pressed') || '',
    control.getAttribute('title') || '',
    control.getAttribute('alt') || '',
    control.getAttribute('src') || ''
  ]
    .join(' ')
    .toLowerCase();

  if (/\b(on|true|active|selected|filled)\b/.test(signal)) {
    return true;
  }

  if (/\b(off|false|inactive|empty|outline)\b/.test(signal)) {
    return false;
  }

  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyLoadout(rawPayload) {
  const payload = decodePayload(rawPayload);
  const strict = confirm(
    'Strict sync?\\nOK: also unfavorite songs not in payload.\\nCancel: only add missing songs.'
  );

  const rows = Array.from(
    document.querySelectorAll('[data-music-id], [data-song-id], .music_box, .w_450.m_15.p_5.f_0')
  );

  let added = 0;
  let removed = 0;
  let unknown = 0;
  const seen = new Set();

  for (const row of rows) {
    const songId = getSongIdFromRow(row);
    if (!songId) {
      continue;
    }

    seen.add(songId);

    const control = findFavoriteControl(row);
    if (!control) {
      continue;
    }

    const wantsFavorite = payload.songIds.has(songId);
    const state = favoriteState(control);

    if (wantsFavorite && state === false) {
      control.click();
      row.style.outline = '2px solid #1fbf75';
      added += 1;
      await delay(140);
      continue;
    }

    if (wantsFavorite && state === null) {
      row.style.outline = '2px solid #f1b400';
      unknown += 1;
      continue;
    }

    if (strict && !wantsFavorite && state === true) {
      control.click();
      row.style.outline = '2px solid #ee5b5b';
      removed += 1;
      await delay(140);
    }
  }

  const missing = [...payload.songIds].filter((songId) => !seen.has(songId));

  return {
    name: payload.name,
    added,
    removed,
    unknown,
    missing
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'APPLY_LOADOUT') {
    return;
  }

  applyLoadout(message.payload)
    .then((report) => {
      sendResponse({ ok: true, report });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || 'Unknown error.' });
    });

  return true;
});
