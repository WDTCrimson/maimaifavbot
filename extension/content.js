function decodePayload(raw) {
  const normalized = raw.trim().replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(normalized + '==='.slice((normalized.length + 3) % 4));
  const payload = JSON.parse(decoded);

  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload is invalid.');
  }

  const songIds = Array.isArray(payload.songIds)
    ? payload.songIds
        .map((value) => String(value).trim())
        .filter((value) => /^\d{1,8}$/.test(value))
    : [];

  const songEntries = Array.isArray(payload.songs) ? payload.songs : [];
  const songTitles = [
    ...songEntries.map((entry) => entry?.title),
    ...(Array.isArray(payload.songTitles) ? payload.songTitles : [])
  ]
    .map((value) => normalizeTitle(value))
    .filter(Boolean);

  if (!songIds.length && !songTitles.length) {
    throw new Error('Payload has no valid song IDs or song titles.');
  }

  return {
    name: payload.name || 'unnamed-loadout',
    songIds: new Set(songIds),
    songTitles: new Set(songTitles)
  };
}

const FAVORITE_CONTROL_SELECTOR = [
  '.favorite_checkbox_frame .favorite_checkbox',
  'input[type="checkbox"][name="music[]"], input[type="checkbox"].favotite_checkbox',
  'input[type="checkbox"][name*="favorite" i]',
  'button[class*="favorite" i], button[class*="favo" i]',
  'a[class*="favorite" i], a[class*="favo" i], a[href*="favorite" i], a[href*="favo" i]',
  'input[type="submit"][name*="favorite" i], input[type="submit"][value*="favorite" i], input[type="submit"][value*="お気に入り"]',
  'img[src*="favorite" i], img[src*="favo" i]'
].join(', ');

function isLikelyRowContainer(node) {
  if (!(node instanceof Element)) {
    return false;
  }
  const classSig = String(node.className || '').toLowerCase();
  if (
    /(music|song|favorite|favo|list|record|box|item|block|w_450|w_420|w_400|m_15|p_5)/i.test(classSig)
  ) {
    return true;
  }
  return ['LI', 'TR', 'ARTICLE', 'SECTION', 'FORM'].includes(node.tagName);
}

function collectRows() {
  const directRows = Array.from(
    document.querySelectorAll('[data-music-id], [data-song-id], .music_box, .w_450.m_15.p_5.f_0')
  );
  if (directRows.length) {
    return directRows;
  }

  const controls = Array.from(document.querySelectorAll(FAVORITE_CONTROL_SELECTOR));
  if (!controls.length) {
    return [];
  }

  const rows = [];
  const seen = new Set();
  for (const control of controls) {
    const row =
      control.closest('[data-music-id], [data-song-id], .music_box, .w_450.m_15.p_5.f_0') ||
      control.closest('form') ||
      control.closest('li, tr, article, section, div');
    if (!row || !isLikelyRowContainer(row)) {
      continue;
    }
    if (seen.has(row)) {
      continue;
    }
    seen.add(row);
    rows.push(row);
  }

  return rows;
}

function hasApplicableRows() {
  return collectRows().length > 0;
}

function isNumericSongId(value) {
  return /^\d{1,8}$/.test(String(value || '').trim());
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function addCandidate(scores, value, weight = 1) {
  const id = String(value || '').trim();
  if (!isNumericSongId(id)) {
    return;
  }
  scores.set(id, (scores.get(id) || 0) + weight);
}

function extractIdsFromString(value) {
  const text = String(value || '');
  const found = [];
  const patterns = [
    /[?&](?:musicId|music_id|songId|song_id|idx|id)=(\d{1,8})/gi,
    /(?:musicId|music_id|songId|song_id|music|song|idx|id)\D{0,6}(\d{1,8})/gi
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      if (match[1]) {
        found.push(match[1]);
      }
      match = pattern.exec(text);
    }
  }

  return found;
}

function getSongIdFromRow(row) {
  const scores = new Map();

  addCandidate(scores, row.dataset?.musicId, 8);
  addCandidate(scores, row.dataset?.songId, 8);
  addCandidate(scores, row.getAttribute('data-music-id'), 8);
  addCandidate(scores, row.getAttribute('data-song-id'), 8);

  const nodes = row.querySelectorAll('input, button, a, form, [data-music-id], [data-song-id]');
  for (const node of nodes) {
    addCandidate(scores, node.dataset?.musicId, 7);
    addCandidate(scores, node.dataset?.songId, 7);
    addCandidate(scores, node.getAttribute?.('data-music-id'), 7);
    addCandidate(scores, node.getAttribute?.('data-song-id'), 7);

    const name = String(node.getAttribute?.('name') || '').toLowerCase();
    const value = String(node.getAttribute?.('value') || node.value || '').trim();
    if (name && /(music|song|id|idx)/i.test(name) && isNumericSongId(value)) {
      addCandidate(scores, value, 6);
    }

    const idAttr = String(node.getAttribute?.('id') || '');
    const classAttr = String(node.getAttribute?.('class') || '');
    const href = String(node.getAttribute?.('href') || '');
    const onclick = String(node.getAttribute?.('onclick') || '');
    const action = String(node.getAttribute?.('action') || '');
    const raw = `${idAttr} ${classAttr} ${href} ${onclick} ${action}`;
    for (const candidate of extractIdsFromString(raw)) {
      addCandidate(scores, candidate, 4);
    }
  }

  const text = row.textContent || '';
  const explicitTextId = text.match(/\b(?:music|song)\s*id\D{0,5}(\d{1,8})\b/i);
  if (explicitTextId?.[1]) {
    addCandidate(scores, explicitTextId[1], 3);
  }

  if (!scores.size) {
    return null;
  }

  const best = [...scores.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
  return best?.[0] || null;
}

function getSongTitleFromRow(row) {
  const selectors = [
    '.favorite_music_name',
    '.music_name',
    '[class*="music_name" i]',
    '[class*="song_title" i]',
    '[class*="title" i]'
  ];
  for (const selector of selectors) {
    const node = row.querySelector(selector);
    if (!node) {
      continue;
    }
    const normalized = normalizeTitle(node.textContent || '');
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function findFavoriteControl(row) {
  if (row.matches?.(FAVORITE_CONTROL_SELECTOR)) {
    return row;
  }

  const selectors = [
    '.favorite_checkbox_frame .favorite_checkbox',
    'label.favorite_checkbox_frame',
    'input[type="checkbox"][name="music[]"], input[type="checkbox"].favotite_checkbox',
    'input[type="checkbox"][name*="favorite" i]',
    'button[class*="favorite" i], button[class*="favo" i]',
    'a[class*="favorite" i], a[class*="favo" i], a[href*="favorite" i], a[href*="favo" i]',
    'input[type="submit"][name*="favorite" i], input[type="submit"][value*="favorite" i], input[type="submit"][value*="お気に入り"]',
    'img[src*="favorite" i], img[src*="favo" i]'
  ];

  let control = null;
  for (const selector of selectors) {
    control = row.querySelector(selector);
    if (control) {
      break;
    }
  }

  if (!control) {
    return null;
  }

  if (control.tagName === 'IMG' || control.tagName === 'SPAN') {
    const clickableParent = control.closest('button, a, label');
    if (clickableParent) {
      return clickableParent;
    }
    const fallback = control.parentElement?.querySelector(
      'button, a, input[type="submit"], input[type="button"]'
    );
    if (fallback) {
      return fallback;
    }
  }

  if (control.tagName === 'LABEL') {
    const htmlFor = control.getAttribute('for');
    if (htmlFor) {
      const linkedInput = row.querySelector(`#${CSS.escape(htmlFor)}`);
      if (linkedInput) {
        return linkedInput;
      }
    }
  }

  return control;
}

function favoriteState(control, row) {
  const rowCheckbox = row.querySelector(
    'input[type="checkbox"][name="music[]"], input[type="checkbox"].favotite_checkbox, input[type="checkbox"]'
  );
  if (rowCheckbox) {
    return Boolean(rowCheckbox.checked);
  }

  const visualToggle = row.querySelector('.favorite_checkbox, .favorite_checkbox_frame');
  if (visualToggle) {
    const sig = [
      visualToggle.className || '',
      visualToggle.getAttribute('style') || '',
      getComputedStyle(visualToggle).backgroundImage || ''
    ]
      .join(' ')
      .toLowerCase();
    if (/favorite_on|favo_on|_on\.|on\.png|checked|active|selected/.test(sig)) {
      return true;
    }
    if (/favorite_off|favo_off|_off\.|off\.png|unchecked|inactive|empty/.test(sig)) {
      return false;
    }
  }

  if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    return Boolean(control.checked);
  }

  const favoriteImages = Array.from(
    row.querySelectorAll('img[src*="favorite" i], img[src*="favo" i]')
  ).map((img) => String(img.getAttribute('src') || '').toLowerCase());

  const signal = [
    control.className || '',
    row.className || '',
    control.getAttribute('aria-pressed') || '',
    control.getAttribute('aria-label') || '',
    control.getAttribute('title') || '',
    control.getAttribute('alt') || '',
    control.getAttribute('src') || '',
    ...favoriteImages
  ]
    .join(' ')
    .toLowerCase();

  const onTokens = [
    'favorite_on',
    'favo_on',
    '_on.',
    'on.png',
    'active',
    'selected',
    'checked',
    'aria-pressed=true'
  ];
  const offTokens = [
    'favorite_off',
    'favo_off',
    '_off.',
    'off.png',
    'inactive',
    'outline',
    'empty',
    'aria-pressed=false'
  ];

  if (onTokens.some((token) => signal.includes(token))) {
    return true;
  }

  if (offTokens.some((token) => signal.includes(token))) {
    return false;
  }

  return null;
}

function clickFavoriteControl(row, control) {
  if (!control) {
    return false;
  }

  const rowCheckbox = row.querySelector(
    'input[type="checkbox"][name="music[]"], input[type="checkbox"].favotite_checkbox, input[type="checkbox"]'
  );
  if (rowCheckbox && rowCheckbox.disabled) {
    rowCheckbox.disabled = false;
  }

  if (control instanceof HTMLInputElement) {
    if (control.disabled) {
      control.disabled = false;
    }
    control.click();
    dispatchSyntheticClick(control);
    if (control.type === 'checkbox') {
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  if (control instanceof HTMLLabelElement) {
    control.click();
    dispatchSyntheticClick(control);
    return true;
  }

  if (control.classList?.contains('favorite_checkbox')) {
    control.click();
    dispatchSyntheticClick(control);
    return true;
  }

  if (control instanceof HTMLButtonElement || control instanceof HTMLAnchorElement) {
    control.click();
    dispatchSyntheticClick(control);
    return true;
  }

  if (control instanceof HTMLFormElement) {
    if (typeof control.requestSubmit === 'function') {
      control.requestSubmit();
    } else {
      control.submit();
    }
    return true;
  }

  const form = control.closest('form');
  if (form) {
    const submitControl = form.querySelector(
      'button[type="submit"], input[type="submit"], button:not([type]), input[type="button"]'
    );
    if (submitControl) {
      submitControl.click();
      dispatchSyntheticClick(submitControl);
      return true;
    }
  }

  if (typeof control.click === 'function') {
    control.click();
    dispatchSyntheticClick(control);
    return true;
  }

  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchSyntheticClick(target) {
  const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  for (const type of events) {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window
      })
    );
  }
}

function showPageStatus(message, isError = false) {
  const id = '__maimai_loadout_status__';
  const existing = document.getElementById(id);
  if (existing) {
    existing.remove();
  }

  const box = document.createElement('div');
  box.id = id;
  box.style.position = 'fixed';
  box.style.right = '14px';
  box.style.bottom = '14px';
  box.style.zIndex = '2147483647';
  box.style.maxWidth = '520px';
  box.style.whiteSpace = 'pre-wrap';
  box.style.padding = '10px 12px';
  box.style.borderRadius = '8px';
  box.style.font = '12px/1.4 "Segoe UI",Tahoma,sans-serif';
  box.style.color = '#fff';
  box.style.background = isError ? 'rgba(185,28,28,0.95)' : 'rgba(6,95,70,0.95)';
  box.textContent = message;
  document.body.appendChild(box);

  setTimeout(() => {
    box.remove();
  }, 12000);
}

async function applyLoadout(rawPayload, options = {}) {
  const payload = decodePayload(rawPayload);
  const strict = Boolean(options.strict);

  const rows = collectRows();

  let added = 0;
  let removed = 0;
  let unknown = 0;
  let matchedRows = 0;
  let actionableRows = 0;
  let failedToggles = 0;
  const seenIds = new Set();
  const seenTitles = new Set();

  for (const row of rows) {
    const songId = getSongIdFromRow(row);
    const songTitle = getSongTitleFromRow(row);
    if (!songId && !songTitle) {
      continue;
    }

    matchedRows += 1;
    if (songId) {
      seenIds.add(songId);
    }
    if (songTitle) {
      seenTitles.add(songTitle);
    }

    const control = findFavoriteControl(row);
    if (!control) {
      continue;
    }
    actionableRows += 1;

    const wantsById = songId ? payload.songIds.has(songId) : false;
    const wantsByTitle = songTitle ? payload.songTitles.has(songTitle) : false;
    const wantsFavorite = wantsById || wantsByTitle;
    const state = favoriteState(control, row);

    if (wantsFavorite && state !== true) {
      const clicked = clickFavoriteControl(row, control);
      if (!clicked) {
        failedToggles += 1;
        row.style.outline = '2px solid #f97316';
        continue;
      }
      await delay(220);
      const afterControl = findFavoriteControl(row) || control;
      const afterState = favoriteState(afterControl, row);
      if (afterState === true) {
        row.style.outline = '2px solid #1fbf75';
        added += 1;
      } else if (afterState === null) {
        row.style.outline = '2px solid #f1b400';
        unknown += 1;
      } else {
        row.style.outline = '2px solid #f97316';
        failedToggles += 1;
      }
      continue;
    }

    if (wantsFavorite && state === true) {
      row.style.outline = '2px solid #1fbf75';
      continue;
    }

    if (wantsFavorite && state === null) {
      row.style.outline = '2px solid #f1b400';
      unknown += 1;
      continue;
    }

    if (strict && !wantsFavorite && state === true) {
      const clicked = clickFavoriteControl(row, control);
      if (!clicked) {
        failedToggles += 1;
        row.style.outline = '2px solid #f97316';
        continue;
      }
      await delay(220);
      const afterControl = findFavoriteControl(row) || control;
      const afterState = favoriteState(afterControl, row);
      if (afterState === false) {
        row.style.outline = '2px solid #ee5b5b';
        removed += 1;
      } else if (afterState === null) {
        row.style.outline = '2px solid #f1b400';
        unknown += 1;
      } else {
        row.style.outline = '2px solid #f97316';
        failedToggles += 1;
      }
    }
  }

  const missingIds = [...payload.songIds].filter((songId) => !seenIds.has(songId));
  const missingTitles = [...payload.songTitles].filter((title) => !seenTitles.has(title));
  const missing = missingIds.length ? missingIds : missingTitles;

  return {
    name: payload.name,
    added,
    removed,
    unknown,
    missing,
    scannedRows: rows.length,
    matchedRows,
    actionableRows,
    failedToggles
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'APPLY_LOADOUT') {
    return;
  }

  if (!hasApplicableRows()) {
    // Ignore this frame so another frame (if any) can handle the request.
    return;
  }

  applyLoadout(message.payload, {
    strict: message.strict
  })
    .then((report) => {
      const missingText = report.missing.length ? report.missing.join(', ') : 'none';
      showPageStatus(
        [
          `Loadout: ${report.name}`,
          `Added: ${report.added}`,
          `Removed: ${report.removed}`,
          `Unknown state: ${report.unknown}`,
          `Scanned rows: ${report.scannedRows ?? 0}`,
          `Matched IDs: ${report.matchedRows ?? 0}`,
          `Actionable controls: ${report.actionableRows ?? 0}`,
          `Failed toggles: ${report.failedToggles ?? 0}`,
          `Missing on page: ${missingText}`
        ].join('\n')
      );
      sendResponse({ ok: true, report });
    })
    .catch((error) => {
      showPageStatus(`Failed: ${error.message || 'Unknown error.'}`, true);
      sendResponse({ ok: false, error: error.message || 'Unknown error.' });
    });

  return true;
});
