const runtimeScript = `(async()=>{const raw=prompt('Paste loadout payload from Discord');if(!raw)return;const b64=raw.trim().replace(/-/g,'+').replace(/_/g,'/');let data;try{data=JSON.parse(atob(b64+'==='.slice((b64.length+3)%4)));}catch(_){alert('Invalid payload.');return;}const ids=new Set((data.songIds||[]).map(v=>String(v).trim()).filter(Boolean));if(!ids.size){alert('Payload has no song IDs.');return;}const strict=confirm('Strict sync?\\nOK: try to unfavorite songs not in loadout.\\nCancel: only try to add missing songs.');const rowSel='[data-music-id],[data-song-id],.music_box,.w_450.m_15.p_5.f_0';const favSel='[class*=favorite],[class*=favo],[aria-label*=favorite i],[title*=favorite i],img[src*=favorite i],img[src*=favo i]';const rows=Array.from(document.querySelectorAll(rowSel));const parseId=(row)=>{for(const key of ['musicId','songId']){const v=row.dataset?.[key];if(v&&/^\\d{1,8}$/.test(v))return String(v);}for(const key of ['data-music-id','data-song-id']){const v=row.getAttribute?.(key);if(v&&/^\\d{1,8}$/.test(v))return String(v);}const text=row.textContent||'';const m=text.match(/\\b(\\d{3,8})\\b/);return m?m[1]:null;};const findBtn=(row)=>row.querySelector(favSel);const isOn=(el)=>{const sig=[el.className,el.getAttribute?.('aria-pressed')||'',el.getAttribute?.('title')||'',el.getAttribute?.('alt')||'',el.getAttribute?.('src')||''].join(' ').toLowerCase();if(/\\b(on|true|active|selected|filled)\\b/.test(sig))return true;if(/\\b(off|false|inactive|empty|outline)\\b/.test(sig))return false;return null;};const wait=(ms)=>new Promise(r=>setTimeout(r,ms));let added=0;let removed=0;let unknown=0;const seen=new Set();for(const row of rows){const id=parseId(row);if(!id)continue;seen.add(id);const btn=findBtn(row);if(!btn)continue;const want=ids.has(id);const on=isOn(btn);if(want&&on===false){btn.click();row.style.outline='2px solid #1fbf75';added++;await wait(140);}else if(want&&on===null){row.style.outline='2px solid #f1b400';unknown++;}else if(strict&&!want&&on===true){btn.click();row.style.outline='2px solid #ee5b5b';removed++;await wait(140);}}const missing=[...ids].filter(id=>!seen.has(id));alert(['Loadout applied (best effort).','Added: '+added,'Removed: '+removed,'Unknown state: '+unknown,'Missing on page: '+(missing.length?missing.join(', '):'none')].join('\\n'));})();`;

export function createLoadoutPayload(loadout, options = {}) {
  const songs = Array.isArray(options.songs)
    ? options.songs
        .map((entry) => ({
          id: String(entry?.id || '').trim(),
          title: String(entry?.title || '').trim()
        }))
        .filter((entry) => /^\d{1,8}$/.test(entry.id))
    : [];

  const payload = {
    version: songs.length ? 2 : 1,
    name: loadout.name,
    songIds: loadout.songs
  };

  if (songs.length) {
    payload.songs = songs;
  }

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function createBookmarkletCode() {
  return `javascript:${runtimeScript}`;
}

export function createInstallMessage() {
  return [
    'Create a browser bookmark with this exact URL:',
    createBookmarkletCode(),
    '',
    'Then run `/loadout payload <name>` in Discord, open maimaidxnet favorites page, and click the bookmark.'
  ].join('\n');
}

export function createPayloadMessage(loadout, options = {}) {
  const payload = createLoadoutPayload(loadout, options);
  return [
    `Loadout: ${loadout.name}`,
    `Songs: ${loadout.songs.length}/30`,
    '',
    'Payload (paste into bookmarklet/extension):',
    payload
  ].join('\n');
}
