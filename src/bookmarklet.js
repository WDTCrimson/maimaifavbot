const runtimeScript = `(async()=>{const raw=prompt('Paste loadout payload from Discord');if(!raw)return;const CM={'Α':'A','α':'a','Β':'B','β':'b','Ε':'E','ε':'e','Ζ':'Z','ζ':'z','Η':'H','η':'h','Ι':'I','ι':'i','Κ':'K','κ':'k','Μ':'M','μ':'m','Ν':'N','ν':'n','Ο':'O','ο':'o','Ρ':'P','ρ':'p','Τ':'T','τ':'t','Υ':'Y','υ':'y','Χ':'X','χ':'x','Λ':'A','λ':'a','Δ':'A','δ':'a','Φ':'O','φ':'o','Ω':'O','ω':'o','А':'A','а':'a','В':'B','Е':'E','е':'e','К':'K','М':'M','Н':'H','О':'O','о':'o','Р':'P','р':'p','С':'C','с':'c','Т':'T','Х':'X','х':'x','У':'Y','у':'y','І':'I','і':'i','Ј':'J','ј':'j'};const fold=(s)=>Array.from(String(s||''),c=>CM[c]||c).join('');const norm=(s)=>fold(s).normalize('NFKC').toLowerCase().replace(/\\s+/g,' ').trim();const loose=(s)=>norm(s).replace(/[|｜].*$/u,'').replace(/[\\(\\)（）\\[\\]【】「」『』〈〉<>]/gu,' ').replace(/[ーｰ]/gu,'').replace(/[\\s\\p{P}\\p{S}]+/gu,'').trim();const decode=(r)=>{const n=String(r||'').trim().replace(/-/g,'+').replace(/_/g,'/');const b=atob(n+'==='.slice((n.length+3)%4));const bytes=Uint8Array.from(b,c=>c.charCodeAt(0));const text=new TextDecoder('utf-8').decode(bytes);return JSON.parse(text);};let payload;try{payload=decode(raw);}catch(_){alert('Invalid payload.');return;}const titlesRaw=[...(Array.isArray(payload?.songs)?payload.songs.map(v=>v&&v.title):[]),...(Array.isArray(payload?.songTitles)?payload.songTitles:[])].map(v=>String(v||'').trim()).filter(Boolean);if(!titlesRaw.length){alert('Payload has no song titles. Use a fresh /loadout payload.');return;}const targets=[];const seenTarget=new Set();for(const t of titlesRaw){const n=norm(t);if(!n||seenTarget.has(n))continue;seenTarget.add(n);targets.push({raw:t,norm:n,loose:loose(t)});}const form=document.querySelector('form[action$=\"/home/userOption/favorite/updateMusic/set\"]');if(!form){alert('Open the CHANGE FAVORITE SONGS page first.');return;}const entries=()=>Array.from(document.querySelectorAll('label.favorite_checkbox_frame')).map(label=>{const input=label.querySelector('input[name=\"music[]\"][type=\"checkbox\"]');const nameEl=label.querySelector('.favorite_music_name');const title=nameEl?String(nameEl.textContent||'').trim():'';return{label,input,title,norm:norm(title),loose:loose(title)};}).filter(e=>e.input);const setChecked=(input,desired)=>{if(!input||input.disabled)return false;if(input.checked!==desired)input.click();input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('input',{bubbles:true}));return input.checked===desired;};const refreshCount=()=>{try{form.dispatchEvent(new Event('change',{bubbles:true}));form.dispatchEvent(new Event('input',{bubbles:true}));}catch{}const span=document.querySelector('[name=\"favoriteCount\"]');if(!span)return;const c=entries().filter(e=>e.input.checked).length;const m=String(span.textContent||'').match(/\\/\\s*(\\d+)/);const total=m?parseInt(m[1],10):null;span.textContent=Number.isFinite(total)?(c+'/'+total):String(c);};const clickReset=async()=>{let clicked=false;const byOnClick=document.querySelector('button[onclick*=\"favoriteAllOffClick\"]');if(byOnClick){byOnClick.click();clicked=true;}else{const imgs=Array.from(document.querySelectorAll('button img'));const resetImg=imgs.find(img=>/btn_allreset\\.png/i.test(String(img.getAttribute('src')||'')));if(resetImg){resetImg.closest('button')?.click();clicked=true;}}if(clicked)await new Promise(r=>setTimeout(r,120));};const strict=confirm('Strict sync?\\\\nOK: reset all then apply loadout.\\\\nCancel: only add missing songs.');const autoSubmit=confirm('Auto-click DECIDE after applying?\\\\nOK: submit DECIDE\\\\nCancel: do not submit');const beforeChecked=entries().filter(e=>e.input.checked).length;if(strict)await clickReset();const current=entries();const byNorm=new Map();const byLoose=new Map();for(const e of current){if(e.norm&&!byNorm.has(e.norm))byNorm.set(e.norm,e);if(e.loose){const arr=byLoose.get(e.loose)||[];arr.push(e);byLoose.set(e.loose,arr);}}let added=0;let failed=0;const notFound=[];for(const t of targets){let hit=byNorm.get(t.norm)||null;if(!hit&&t.loose){const bucket=byLoose.get(t.loose)||[];if(bucket.length===1)hit=bucket[0];}if(!hit&&t.loose&&t.loose.length>=2){const fuzzy=current.find(e=>e.loose&&(e.loose.includes(t.loose)||t.loose.includes(e.loose)));if(fuzzy)hit=fuzzy;}if(!hit){notFound.push(t.raw);continue;}if(hit.input.disabled){hit.label.style.outline='2px solid #f59e0b';continue;}const was=hit.input.checked;const ok=setChecked(hit.input,true);if(!ok){failed++;hit.label.style.outline='2px solid #f97316';continue;}if(!was&&hit.input.checked)added++;hit.label.style.outline='2px solid #1fbf75';}refreshCount();const after=entries();const checkedNow=after.filter(e=>e.input.checked).length;const removed=strict?Math.max(0,beforeChecked-(checkedNow-added)):0;if(autoSubmit){const btn=form.querySelector('button[type=\"submit\"]');if(btn)btn.click();else form.submit();}alert(['Loadout: '+String(payload?.name||'unnamed-loadout'),'Added: '+added,'Removed: '+removed,'Unknown state: 0','Scanned rows: '+after.length,'Matched titles: '+(targets.length-notFound.length),'Actionable targets: '+targets.length,'Failed toggles: '+failed,'Checked now: '+checkedNow,'Missing on page: '+(notFound.length?notFound.join(', '):'none')].join('\\\\n'));})();`;

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
    'Then run `/loadout payload <name>` in Discord, open maimaidxnet favorites page, click the bookmark, and follow the strict/DECIDE prompts.'
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
