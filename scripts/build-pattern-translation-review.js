import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_URL = 'https://mai-notes.com/data/manifest.json';
const LABELS_FILE = './data/reference/pattern-labels.json';
const OUTPUT_FILE = './data/reports/pattern-translation-review.html';

const GROUP_NAMES = {
  'おすすめ': 'Recommendation',
  '傾向': 'Tendency',
  'タップ': 'Tap',
  'スライド基礎': 'Basic slides',
  'スライド応用': 'Advanced slides',
  'タッチノーツ': 'Touch notes'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseArgs(argv) {
  const args = { help: false, outputFile: OUTPUT_FILE, labelsFile: LABELS_FILE };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') args.help = true;
    else if (arg === '--output' || arg === '--labels') {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a path.`);
      if (arg === '--output') args.outputFile = value;
      else args.labelsFile = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function pickExamples(tagId, manifest, limit = 4) {
  return manifest.charts
    .filter((chart) => chart.has_chart_data && Array.isArray(chart.tags) && chart.tags.some((id) => String(id) === String(tagId)))
    .map((chart) => ({ chart, song: manifest.songs[chart.song_id] }))
    .filter((entry) => entry.song)
    .sort((left, right) =>
      left.chart.tags.length - right.chart.tags.length ||
      Number(left.chart.internal_level) - Number(right.chart.internal_level) ||
      left.song.title.localeCompare(right.song.title)
    )
    .slice(0, limit)
    .map(({ chart, song }) => ({
      title: song.title,
      chartId: chart.id,
      difficulty: chart.difficulty,
      type: song.type === 'deluxe' ? 'DX' : 'STD',
      level: chart.internal_level ?? chart.level,
      tagCount: chart.tags.length
    }));
}

function renderBoard(items, generatedAt) {
  const serialized = JSON.stringify(items).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MaiDeck pattern translation review</title>
<style>
  :root { color-scheme: dark; --bg:#0b0b10; --panel:#15151d; --line:#2b2b38; --text:#f5f5f7; --muted:#a4a4b3; --accent:#a78bfa; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 Inter,system-ui,sans-serif; }
  header { position:sticky; top:0; z-index:2; display:flex; gap:16px; align-items:center; padding:16px 22px; background:#0b0b10ee; border-bottom:1px solid var(--line); backdrop-filter:blur(12px); }
  h1 { margin:0; font-size:18px; }
  header p { margin:0; color:var(--muted); flex:1; }
  button,.button,input { border:1px solid var(--line); border-radius:9px; background:#1e1e29; color:var(--text); padding:9px 11px; font:inherit; }
  button,.button { cursor:pointer; text-decoration:none; }
  button:hover,.button:hover { border-color:var(--accent); }
  main { max-width:1180px; margin:0 auto; padding:22px; }
  .toolbar { display:grid; grid-template-columns:1fr auto; gap:12px; margin-bottom:18px; }
  #search { width:100%; }
  .group { margin:28px 0 12px; color:var(--accent); font-size:13px; letter-spacing:.08em; text-transform:uppercase; }
  .card { display:grid; grid-template-columns:minmax(220px, .7fr) minmax(320px, 1.3fr); gap:22px; padding:20px; margin-bottom:12px; background:var(--panel); border:1px solid var(--line); border-radius:14px; }
  .jp { font-size:22px; font-weight:750; }
  .current { color:var(--muted); margin:3px 0 16px; }
  label { display:block; color:var(--muted); font-size:12px; margin-bottom:5px; }
  .term { width:100%; font-size:16px; }
  .examples { display:grid; gap:8px; align-content:start; }
  .example { display:flex; align-items:center; gap:10px; padding:10px 12px; background:#101017; border:1px solid var(--line); border-radius:10px; }
  .example strong { flex:1; }
  .meta { color:var(--muted); white-space:nowrap; }
  .empty { color:#fca5a5; }
  .hint { color:var(--muted); font-size:13px; }
  @media (max-width:760px) { header { align-items:flex-start; flex-wrap:wrap; } .card { grid-template-columns:1fr; } .example { align-items:flex-start; flex-wrap:wrap; } }
</style>
</head>
<body>
<header>
  <h1>Pattern translation review</h1>
  <p>Press Play in mai-notes, watch the highlighted pattern, then name it using global-player terminology.</p>
  <button id="export">Export names</button>
</header>
<main>
  <div class="toolbar">
    <input id="search" type="search" placeholder="Filter Japanese tag, current English, or group">
    <span class="hint">Generated ${escapeHtml(generatedAt)}</span>
  </div>
  <div id="board"></div>
</main>
<script>
const items = ${serialized};
const storageKey = 'maideck-pattern-translation-review-v1';
const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
const board = document.querySelector('#board');
const search = document.querySelector('#search');

function render() {
  const query = search.value.trim().toLowerCase();
  board.replaceChildren();
  let previousGroup = null;
  for (const item of items) {
    const haystack = [item.tag, item.currentEnglish, item.sourceGroup].join(' ').toLowerCase();
    if (query && !haystack.includes(query)) continue;
    if (item.sourceGroup !== previousGroup) {
      const heading = document.createElement('h2');
      heading.className = 'group';
      heading.textContent = item.sourceGroup;
      board.append(heading);
      previousGroup = item.sourceGroup;
    }
    const card = document.createElement('section');
    card.className = 'card';
    const details = document.createElement('div');
    details.innerHTML = '<div class="jp"></div><div class="current"></div><label>Global-player name</label>';
    details.querySelector('.jp').textContent = item.tag;
    details.querySelector('.current').textContent = 'Current: ' + item.currentEnglish;
    const input = document.createElement('input');
    input.className = 'term';
    input.value = saved[item.tag] ?? item.currentEnglish;
    input.addEventListener('input', () => {
      saved[item.tag] = input.value;
      localStorage.setItem(storageKey, JSON.stringify(saved));
    });
    details.append(input);
    const examples = document.createElement('div');
    examples.className = 'examples';
    if (!item.examples.length) examples.innerHTML = '<div class="empty">No simulator-enabled example is currently available.</div>';
    for (const example of item.examples) {
      const row = document.createElement('div');
      row.className = 'example';
      const title = document.createElement('strong');
      title.textContent = example.title;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = example.type + ' ' + example.difficulty + ' ' + example.level + (example.tagCount === 1 ? ' · isolated' : '');
      const link = document.createElement('a');
      link.className = 'button';
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.href = 'https://mai-notes.com/player/' + example.chartId;
      link.textContent = 'Watch pattern ↗';
      row.append(title, meta, link);
      examples.append(row);
    }
    card.append(details, examples);
    board.append(card);
  }
}

search.addEventListener('input', render);
document.querySelector('#export').addEventListener('click', () => {
  const output = Object.fromEntries(items.map((item) => [item.tag, saved[item.tag] ?? item.currentEnglish]));
  const blob = new Blob([JSON.stringify(output, null, 2) + '\\n'], { type:'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'pattern-label-review.json';
  link.click();
  URL.revokeObjectURL(link.href);
});
render();
</script>
</body>
</html>`;
}

export async function buildPatternTranslationReview({ labelsFile = LABELS_FILE, outputFile = OUTPUT_FILE, fetchImpl = fetch } = {}) {
  const [labelsRaw, response] = await Promise.all([
    readFile(labelsFile, 'utf8'),
    fetchImpl(SOURCE_URL, { headers: { accept: 'application/json', 'user-agent': 'MaiDeck pattern-review/1.0' } })
  ]);
  if (!response.ok) throw new Error(`mai-notes manifest returned HTTP ${response.status}.`);
  const labels = JSON.parse(labelsRaw);
  const manifest = await response.json();
  const items = manifest.tags
    .map((tag) => ({ ...tag, normalizedName: String(tag.name || '').normalize('NFKC').trim() }))
    .filter((tag) => labels[tag.normalizedName]?.group !== 'signature')
    .map((tag) => ({
      tag: tag.normalizedName,
      currentEnglish: labels[tag.normalizedName]?.en || tag.normalizedName,
      sourceGroup: GROUP_NAMES[tag.tag_group] || tag.tag_group || 'Other',
      examples: pickExamples(tag.id, manifest)
    }))
    .sort((left, right) => left.sourceGroup.localeCompare(right.sourceGroup) || left.tag.localeCompare(right.tag, 'ja'));
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, renderBoard(items, manifest.generated_at || new Date().toISOString()), 'utf8');
  return { outputFile, patterns: items.length, examples: items.reduce((sum, item) => sum + item.examples.length, 0) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/build-pattern-translation-review.js [--output <path>] [--labels <path>]');
    return;
  }
  const result = await buildPatternTranslationReview(args);
  console.log(`Wrote ${result.patterns} generic patterns and ${result.examples} playable examples to ${result.outputFile}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
