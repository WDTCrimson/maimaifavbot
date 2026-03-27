const runtimeScript = `(async()=>{try{let r=prompt('Payload');if(!r)return;let n=r.trim().replace(/-/g,'+').replace(/_/g,'/'),b=atob(n+'==='.slice((n.length+3)%4)),p=JSON.parse(new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0)))),m={'Λ':'A','λ':'a','Φ':'O','φ':'o','Δ':'A','δ':'a','Ω':'O','ω':'o'},f=s=>Array.from(String(s||''),c=>m[c]||c).join(''),k=s=>f(s).normalize('NFKC').toLowerCase().replace(/\\s+/g,' ').trim(),t=[...(Array.isArray(p.songs)?p.songs.map(v=>v&&v.title):[]),...(Array.isArray(p.songTitles)?p.songTitles:[])].map(v=>String(v||'').trim()).filter(Boolean);if(!t.length)throw Error('No song titles');let form=document.querySelector('form[action$="/home/userOption/favorite/updateMusic/set"]');if(!form)throw Error('Open CHANGE FAVORITE SONGS page');let rows=()=>[...document.querySelectorAll('label.favorite_checkbox_frame')].map(l=>({i:l.querySelector('input[name="music[]"][type="checkbox"]'),t:(l.querySelector('.favorite_music_name')?.textContent||'').trim()})).filter(x=>x.i),rb=document.querySelector('button[onclick*="favoriteAllOffClick"]')||[...document.querySelectorAll('button img')].find(x=>/btn_allreset\\.png/i.test(x.src||''))?.closest('button');if(rb){rb.click();await new Promise(r=>setTimeout(r,120));}let map=new Map();for(const x of rows()){let q=k(x.t);if(q&&!map.has(q))map.set(q,x);}let miss=[];for(const s of t){let x=map.get(k(s));if(!x){miss.push(s);continue;}if(x.i.disabled)continue;if(!x.i.checked)x.i.click();x.i.dispatchEvent(new Event('change',{bubbles:true}));x.i.dispatchEvent(new Event('input',{bubbles:true}));}let a=rows(),now=a.filter(x=>x.i.checked).length;alert(['Loadout: '+String(p.name||'loadout'),'Checked now: '+now,'Matched: '+(t.length-miss.length),'Missing: '+(miss.length?miss.join(', '):'none'),'Tap DECIDE to save.'].join('\\\\n'));}catch(e){alert('Failed: '+(e&&e.message?e.message:e));}})();`;

export function createLoadoutPayload(loadout, options = {}) {
  const songs = Array.isArray(options.songs)
    ? options.songs
        .map((entry) => ({
          title: String(entry?.title || '').trim()
        }))
        .filter((entry) => entry.title)
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
    'Then run `/loadout payload <name>` in Discord, open maimaidxnet favorites page, click the bookmark, paste payload, and tap DECIDE to save.'
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
