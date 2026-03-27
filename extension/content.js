function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function decodePayload(raw) {
  const normalized = String(raw || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(normalized + '==='.slice((normalized.length + 3) % 4));
  const payload = JSON.parse(decoded);

  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload is invalid.');
  }

  const songEntries = Array.isArray(payload.songs) ? payload.songs : [];
  const songTitles = [
    ...songEntries.map((entry) => entry?.title),
    ...(Array.isArray(payload.songTitles) ? payload.songTitles : [])
  ]
    .map((title) => String(title || '').trim())
    .filter(Boolean);

  if (!songTitles.length) {
    throw new Error('Payload has no song titles. Generate a fresh payload from the bot.');
  }

  const titleMap = new Map();
  for (const title of songTitles) {
    const norm = normalizeTitle(title);
    if (!norm || titleMap.has(norm)) {
      continue;
    }
    titleMap.set(norm, title);
  }

  return {
    name: String(payload.name || 'unnamed-loadout').trim() || 'unnamed-loadout',
    titles: [...titleMap.entries()].map(([norm, rawTitle]) => ({ norm, rawTitle }))
  };
}

function getFavoriteForm() {
  return document.querySelector('form[action$="/home/userOption/favorite/updateMusic/set"]');
}

function allCheckboxEntries() {
  const labels = Array.from(document.querySelectorAll('label.favorite_checkbox_frame'));

  return labels
    .map((label) => {
      const input = label.querySelector('input[name="music[]"][type="checkbox"]');
      const nameEl = label.querySelector('.favorite_music_name');
      const title = nameEl ? String(nameEl.textContent || '').trim() : '';
      return {
        label,
        input,
        title,
        norm: normalizeTitle(title)
      };
    })
    .filter((entry) => entry.input);
}

function refreshFavoriteCountUI(form) {
  try {
    form.dispatchEvent(new Event('change', { bubbles: true }));
    form.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    // ignored
  }

  const span = document.querySelector('[name="favoriteCount"]');
  if (!span) {
    return;
  }

  const checked = allCheckboxEntries().filter((entry) => entry.input.checked).length;
  const match = String(span.textContent || '').match(/\/\s*(\d+)/);
  const total = match ? Number.parseInt(match[1], 10) : null;
  span.textContent = Number.isFinite(total) ? `${checked}/${total}` : String(checked);
}

function setCheckedWithEvent(input, desired) {
  if (!input) {
    return { changed: false, failed: true, reason: 'missing' };
  }

  if (input.disabled) {
    return { changed: false, failed: true, reason: 'disabled' };
  }

  if (input.checked !== desired) {
    input.click();
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));

  return { changed: input.checked === desired, failed: input.checked !== desired };
}

async function clickDeselectAllOnce() {
  let clicked = false;

  const byOnClick = document.querySelector('button[onclick*="favoriteAllOffClick"]');
  if (byOnClick) {
    byOnClick.click();
    clicked = true;
  } else {
    const icons = Array.from(document.querySelectorAll('button img'));
    const resetIcon = icons.find((img) => /btn_allreset\.png/i.test(String(img.getAttribute('src') || '')));
    if (resetIcon) {
      resetIcon.closest('button')?.click();
      clicked = true;
    }
  }

  if (clicked) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return clicked;
}

async function submitDecide(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.click();
  } else {
    form.submit();
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

function hasApplicableRows() {
  const form = getFavoriteForm();
  if (!form) {
    return false;
  }
  return allCheckboxEntries().length > 0;
}

async function applyLoadout(rawPayload, options = {}) {
  const payload = decodePayload(rawPayload);
  const strict = Boolean(options.strict);
  const autoSubmit = Boolean(options.autoSubmit);

  const form = getFavoriteForm();
  if (!form) {
    throw new Error('Open the CHANGE FAVORITE SONGS page first.');
  }

  const entries = allCheckboxEntries();
  if (!entries.length) {
    throw new Error('No favorite checkbox entries found on this page.');
  }

  const beforeChecked = entries.filter((entry) => entry.input.checked).length;

  if (strict) {
    await clickDeselectAllOnce();
  }

  const refreshedEntries = allCheckboxEntries();
  const entryByNorm = new Map();
  for (const entry of refreshedEntries) {
    if (!entry.norm || !entryByNorm.has(entry.norm)) {
      entryByNorm.set(entry.norm, entry);
    }
  }

  let added = 0;
  let failedToggles = 0;
  const matched = [];
  const notFound = [];
  const disabled = [];

  for (const target of payload.titles) {
    const hit = entryByNorm.get(target.norm);
    if (!hit) {
      notFound.push(target.rawTitle);
      continue;
    }

    if (hit.input.disabled) {
      disabled.push(hit.title || target.rawTitle);
      hit.label.style.outline = '2px solid #f59e0b';
      continue;
    }

    const wasChecked = hit.input.checked;
    const result = setCheckedWithEvent(hit.input, true);
    if (result.failed) {
      failedToggles += 1;
      hit.label.style.outline = '2px solid #f97316';
      continue;
    }

    if (!wasChecked && hit.input.checked) {
      added += 1;
    }

    matched.push(hit.title || target.rawTitle);
    hit.label.style.outline = '2px solid #1fbf75';
  }

  refreshFavoriteCountUI(form);

  const finalEntries = allCheckboxEntries();
  const finalChecked = finalEntries.filter((entry) => entry.input.checked).length;
  const removed = strict ? Math.max(0, beforeChecked - (finalChecked - added)) : 0;

  if (autoSubmit) {
    await submitDecide(form);
  }

  return {
    name: payload.name,
    added,
    removed,
    unknown: 0,
    missing: notFound,
    scannedRows: finalEntries.length,
    matchedRows: matched.length,
    actionableRows: payload.titles.length,
    failedToggles,
    disabledCount: disabled.length,
    totalChecked: finalChecked
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'APPLY_LOADOUT') {
    return;
  }

  if (!hasApplicableRows()) {
    return;
  }

  applyLoadout(message.payload, {
    strict: message.strict,
    autoSubmit: message.autoSubmit
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
          `Matched titles: ${report.matchedRows ?? 0}`,
          `Actionable targets: ${report.actionableRows ?? 0}`,
          `Failed toggles: ${report.failedToggles ?? 0}`,
          `Missing on page: ${missingText}`,
          `Checked now: ${report.totalChecked ?? 0}`
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
