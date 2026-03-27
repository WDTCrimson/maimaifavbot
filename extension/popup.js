const payloadInput = document.getElementById('payload');
const status = document.getElementById('status');
const applyButton = document.getElementById('apply');
const storageKey = 'maimai_loadout_payload';

payloadInput.value = localStorage.getItem(storageKey) || '';

function setStatus(text, color = '#1f2937') {
  status.textContent = text;
  status.style.color = color;
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        reject(new Error('No active tab found.'));
        return;
      }
      resolve(tab);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ['content.js']
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

function isSupportedUrl(url) {
  return /^https:\/\/([a-z0-9-]+\.)?(maimaidx\.jp|maimaidx-eng\.com|maimaidx\.net)\//i.test(url || '');
}

applyButton.addEventListener('click', async () => {
  const payload = payloadInput.value.trim();
  if (!payload) {
    setStatus('Paste a payload first.', '#b45309');
    return;
  }

  localStorage.setItem(storageKey, payload);
  setStatus('Applying loadout...', '#1e6ae8');

  try {
    const tab = await getActiveTab();
    if (!isSupportedUrl(tab.url)) {
      throw new Error('Open a maimaidx page first, then try again.');
    }

    let response = null;
    try {
      response = await sendMessageToTab(tab.id, {
        type: 'APPLY_LOADOUT',
        payload
      });
    } catch (error) {
      const msg = String(error?.message || '').toLowerCase();
      if (!msg.includes('receiving end does not exist')) {
        throw error;
      }

      // If the tab was opened before extension load/update, inject then retry once.
      await injectContentScript(tab.id);
      response = await sendMessageToTab(tab.id, {
        type: 'APPLY_LOADOUT',
        payload
      });
    }

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
        `Missing on page: ${missingText}`
      ].join('\n'),
      '#065f46'
    );
  } catch (error) {
    setStatus(`Failed: ${error.message}`, '#b91c1c');
  }
});
