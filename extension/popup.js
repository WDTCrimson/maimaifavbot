const payloadInput = document.getElementById('payload');
const status = document.getElementById('status');
const applyButton = document.getElementById('apply');
const exportButton = document.getElementById('export');
const strictInput = document.getElementById('strict');
const autoSubmitInput = document.getElementById('autoSubmit');
const extApi = globalThis.browser || globalThis.chrome;
const storageKey = 'maimai_loadout_payload';
const strictKey = 'maimai_loadout_strict';
const autoSubmitKey = 'maimai_loadout_auto_submit';

payloadInput.value = localStorage.getItem(storageKey) || '';
strictInput.checked = localStorage.getItem(strictKey) === '1';
const storedAutoSubmit = localStorage.getItem(autoSubmitKey);
autoSubmitInput.checked = storedAutoSubmit == null ? true : storedAutoSubmit === '1';

function setStatus(text, color = '#1f2937') {
  status.textContent = text;
  status.style.color = color;
}

function readLastError() {
  if (!globalThis.chrome?.runtime?.lastError) {
    return null;
  }
  return globalThis.chrome.runtime.lastError;
}

function callApi(fn, ...args) {
  if (globalThis.browser) {
    return fn(...args);
  }

  return new Promise((resolve, reject) => {
    const callback = (value) => {
      const error = readLastError();
      if (error) {
        reject(new Error(error.message || 'Extension API error.'));
        return;
      }
      resolve(value);
    };

    try {
      fn(...args, callback);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function getActiveTab() {
  return callApi(extApi.tabs.query.bind(extApi.tabs), { active: true, currentWindow: true }).then(
    (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.id) {
        throw new Error('No active tab found.');
      }
      return tab;
    }
  );
}

function sendMessageToTab(tabId, message) {
  return callApi(extApi.tabs.sendMessage.bind(extApi.tabs), tabId, message);
}

async function sendMessageWithRetry(tabId, message) {
  try {
    return await sendMessageToTab(tabId, message);
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    if (!msg.includes('receiving end does not exist')) {
      throw error;
    }

    // If the tab was opened before extension load/update, inject then retry once.
    await injectContentScript(tabId);
    return sendMessageToTab(tabId, message);
  }
}

async function injectContentScript(tabId) {
  if (extApi.scripting?.executeScript) {
    await callApi(extApi.scripting.executeScript.bind(extApi.scripting), {
      target: { tabId },
      files: ['content.js']
    });
    return;
  }

  if (extApi.tabs?.executeScript) {
    await callApi(extApi.tabs.executeScript.bind(extApi.tabs), tabId, {
      file: 'content.js'
    });
    return;
  }

  throw new Error('Content script injection is not supported in this browser.');
}

function isSupportedUrl(url) {
  return /^https:\/\/([a-z0-9-]+\.)?(maimaidx\.jp|maimaidx-eng\.com|maimaidx\.net)\//i.test(url || '');
}

async function copyToClipboard(text) {
  if (!navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

applyButton.addEventListener('click', async () => {
  const payload = payloadInput.value.trim();
  if (!payload) {
    setStatus('Paste a payload first.', '#b45309');
    return;
  }

  localStorage.setItem(storageKey, payload);
  localStorage.setItem(strictKey, strictInput.checked ? '1' : '0');
  localStorage.setItem(autoSubmitKey, autoSubmitInput.checked ? '1' : '0');
  setStatus('Applying loadout...', '#1e6ae8');

  try {
    const tab = await getActiveTab();
    if (!isSupportedUrl(tab.url)) {
      throw new Error('Open a maimaidx page first, then try again.');
    }

    const response = await sendMessageWithRetry(tab.id, {
      type: 'APPLY_LOADOUT',
      payload,
      strict: strictInput.checked,
      autoSubmit: autoSubmitInput.checked
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'No response from content script.');
    }

    const report = response.report;
    const missingText = report.missing.length ? report.missing.join(', ') : 'none';

    setStatus(
      [
        `Loadout: ${report.name}`,
        `Added: ${report.added}`,
        `Removed: ${report.removed}`,
        `Unknown state: ${report.unknown}`,
        `Scanned rows: ${report.scannedRows ?? 0}`,
        `Matched titles: ${report.matchedRows ?? 0}`,
        `Actionable targets: ${report.actionableRows ?? 0}`,
        `Failed toggles: ${report.failedToggles ?? 0}`,
        `Checked now: ${report.totalChecked ?? 0}`,
        `Missing on page: ${missingText}`
      ].join('\n'),
      '#065f46'
    );
  } catch (error) {
    setStatus(`Failed: ${error.message}`, '#b91c1c');
  }
});

exportButton.addEventListener('click', async () => {
  setStatus('Reading current favorites...', '#1e6ae8');

  try {
    const tab = await getActiveTab();
    if (!isSupportedUrl(tab.url)) {
      throw new Error('Open a maimaidx page first, then try again.');
    }

    const response = await sendMessageWithRetry(tab.id, {
      type: 'EXPORT_FAVORITES',
      name: 'Imported Favorites'
    });

    if (!response?.ok || !response.exported?.code) {
      throw new Error(response?.error || 'No export payload was returned.');
    }

    payloadInput.value = response.exported.code;
    localStorage.setItem(storageKey, response.exported.code);

    const copied = await copyToClipboard(response.exported.code);
    setStatus(
      [
        `Exported favorites: ${response.exported.count}`,
        'Import command:',
        '/loadout import name:<new_loadout_name> code:<paste_code> replace:true',
        copied ? 'Import code copied to clipboard.' : 'Import code placed in payload box.'
      ].join('\n'),
      '#065f46'
    );
  } catch (error) {
    setStatus(`Failed: ${error.message}`, '#b91c1c');
  }
});
