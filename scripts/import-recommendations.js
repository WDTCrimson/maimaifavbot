import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_SOURCE_FILE = './data/recommendations/sources.json';
const DEFAULT_SOURCE_EXAMPLE_FILE = './data/recommendations/sources.example.json';
const DEFAULT_OUTPUT_FILE = './data/recommendations/community.json';
const DEFAULT_REPORT_FILE = './data/recommendations/import-report.json';
const DEFAULT_SONG_CATALOG_FILE = './data/import/songs.normalized.json';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncateText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function parseArgs(argv) {
  const args = {
    sourceFile: DEFAULT_SOURCE_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
    reportFile: DEFAULT_REPORT_FILE,
    songCatalogFile: DEFAULT_SONG_CATALOG_FILE
  };

  for (const arg of argv) {
    if (arg.startsWith('--source-file=')) {
      args.sourceFile = arg.slice('--source-file='.length);
      continue;
    }
    if (arg.startsWith('--output-file=')) {
      args.outputFile = arg.slice('--output-file='.length);
      continue;
    }
    if (arg.startsWith('--report-file=')) {
      args.reportFile = arg.slice('--report-file='.length);
      continue;
    }
    if (arg.startsWith('--song-catalog-file=')) {
      args.songCatalogFile = arg.slice('--song-catalog-file='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
  await rename(tempFile, filePath);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'maimai-fav-bot-recommendation-importer/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

function normalizeSongCatalog(rawCatalog) {
  const songs = Array.isArray(rawCatalog?.songs) ? rawCatalog.songs : [];

  return songs
    .map((song) => {
      const favoriteId = String(song.linkedOtogeSort || song.sourceSongId || '').trim();
      const title = String(song.title || '').trim();
      if (!favoriteId || !title) {
        return null;
      }

      return {
        favoriteId,
        title,
        artist: String(song.artist || '').trim(),
        normTitle: normalizeText(title)
      };
    })
    .filter(Boolean);
}

function buildMatchers(songs) {
  return songs
    .map((song) => {
      const normalizedTitle = song.normTitle;
      if (!normalizedTitle || normalizedTitle.length < 2) {
        return null;
      }

      const asciiWordTitle = /^[a-z0-9 ]+$/.test(normalizedTitle);
      if (asciiWordTitle && normalizedTitle.replace(/\s+/g, '').length < 4) {
        return null;
      }

      return {
        songId: song.favoriteId,
        title: song.title,
        artist: song.artist,
        normalizedTitle,
        regex: asciiWordTitle
          ? new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedTitle)}([^a-z0-9]|$)`, 'i')
          : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.normalizedTitle.length - a.normalizedTitle.length);
}

function detectSongMentions(text, matchers) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const matches = [];
  const seen = new Set();

  for (const matcher of matchers) {
    const found = matcher.regex
      ? matcher.regex.test(normalized)
      : normalized.includes(matcher.normalizedTitle);

    if (!found || seen.has(matcher.songId)) {
      continue;
    }

    seen.add(matcher.songId);
    matches.push(matcher);
  }

  return matches;
}

function inferTags(text) {
  const normalized = normalizeText(text);
  const tags = new Set();

  const tagPatterns = [
    { tag: 'entry', patterns: ['entry', 'easy for', 'comfortable', 'comfy', 'beginner', 'starting point'] },
    { tag: 'tech', patterns: ['tech', 'technical', 'pattern', 'tricky', 'gimmick'] },
    { tag: 'stamina', patterns: ['stamina', 'endurance', 'draining'] },
    { tag: 'accuracy', patterns: ['accuracy', 'consistent', 'score', 'score attack'] },
    { tag: 'speed', patterns: ['speed', 'fast', 'high bpm', 'jack', 'burst'] }
  ];

  for (const group of tagPatterns) {
    if (group.patterns.some((pattern) => normalized.includes(pattern))) {
      tags.add(group.tag);
    }
  }

  return [...tags];
}

function flattenComments(node, output) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (node.kind === 't1' && node.data) {
    output.push(node.data);
  }

  const children = node?.data?.replies?.data?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      flattenComments(child, output);
    }
  }
}

async function fetchRedditSource(source) {
  const subreddit = String(source.subreddit || '').trim();
  const queries = Array.isArray(source.queries) ? source.queries : [];
  if (!subreddit || !queries.length) {
    throw new Error(`Invalid reddit-search source: ${JSON.stringify(source)}`);
  }

  const items = [];

  for (const query of queries) {
    const searchUrl = new URL(`https://www.reddit.com/r/${subreddit}/search.json`);
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('restrict_sr', '1');
    searchUrl.searchParams.set('sort', String(source.sort || 'relevance'));
    searchUrl.searchParams.set('t', String(source.time || 'year'));
    searchUrl.searchParams.set('limit', String(source.limit || 15));
    searchUrl.searchParams.set('raw_json', '1');

    const searchJson = await fetchJson(searchUrl.toString());
    const posts = Array.isArray(searchJson?.data?.children) ? searchJson.data.children : [];

    for (const postWrapper of posts) {
      const post = postWrapper?.data;
      if (!post?.permalink) {
        continue;
      }

      const permalink = `https://www.reddit.com${post.permalink}`;
      items.push({
        kind: 'post',
        sourceName: source.name || `r/${subreddit}`,
        sourceQuery: query,
        title: String(post.title || '').trim(),
        text: `${post.title || ''}\n${post.selftext || ''}`.trim(),
        url: permalink,
        score: Number(post.score || 0),
        createdUtc: Number(post.created_utc || 0)
      });

      if (!source.includeComments) {
        continue;
      }

      const commentsUrl = new URL(`${permalink}.json`);
      commentsUrl.searchParams.set('raw_json', '1');
      commentsUrl.searchParams.set('limit', String(source.commentLimit || 20));
      commentsUrl.searchParams.set('sort', 'top');

      try {
        const commentsJson = await fetchJson(commentsUrl.toString());
        const commentTree = Array.isArray(commentsJson) ? commentsJson[1] : null;
        const comments = [];
        if (Array.isArray(commentTree?.data?.children)) {
          for (const child of commentTree.data.children) {
            flattenComments(child, comments);
          }
        }

        for (const comment of comments.slice(0, source.commentLimit || 20)) {
          const body = String(comment.body || '').trim();
          if (!body) {
            continue;
          }

          items.push({
            kind: 'comment',
            sourceName: source.name || `r/${subreddit}`,
            sourceQuery: query,
            title: String(post.title || '').trim(),
            text: body,
            url: `${permalink}${comment.id ? comment.id : ''}`,
            score: Number(comment.score || 0),
            createdUtc: Number(comment.created_utc || 0)
          });
        }
      } catch (error) {
        items.push({
          kind: 'warning',
          sourceName: source.name || `r/${subreddit}`,
          sourceQuery: query,
          text: `Failed to fetch comments for ${permalink}: ${error.message}`
        });
      }
    }
  }

  return items;
}

async function fetchSourceItems(source) {
  if (source.type === 'reddit-search') {
    return fetchRedditSource(source);
  }

  throw new Error(`Unsupported source type: ${source.type}`);
}

function scoreMentionItem(item) {
  const base = item.kind === 'post' ? 4 : 2;
  const scoreBonus = Math.max(0, Math.min(10, Math.log10((item.score || 0) + 1) * 2));
  return base + scoreBonus;
}

function mergeTagCounts(tagCounts) {
  return [...tagCounts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([tag]) => tag);
}

function buildRecommendationEntries(aggregatedMentions) {
  const entries = [];

  for (const mention of aggregatedMentions.values()) {
    const orderedTags = mergeTagCounts(mention.tagCounts).slice(0, 4);
    const orderedSources = [...mention.sources.values()].slice(0, 3);
    const bestExcerpt = mention.bestExcerpt || 'Mentioned positively in community discussion.';

    entries.push({
      songId: mention.songId,
      title: mention.title,
      artist: mention.artist,
      tags: orderedTags,
      note: truncateText(bestExcerpt, 180),
      sources: orderedSources,
      weight: Number(Math.max(1, Math.round(mention.weight * 10)) / 10)
    });
  }

  entries.sort((a, b) => {
    if (b.weight !== a.weight) {
      return b.weight - a.weight;
    }
    return a.title.localeCompare(b.title);
  });

  return entries;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();

  const sourceFile = join(projectRoot, args.sourceFile);
  const fallbackSourceFile = join(projectRoot, DEFAULT_SOURCE_EXAMPLE_FILE);
  const outputFile = join(projectRoot, args.outputFile);
  const reportFile = join(projectRoot, args.reportFile);
  const songCatalogFile = join(projectRoot, args.songCatalogFile);

  const effectiveSourceFile = (await fileExists(sourceFile)) ? sourceFile : fallbackSourceFile;

  let sourceConfig = null;
  try {
    sourceConfig = JSON.parse(await readFile(effectiveSourceFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Missing recommendation source config. Expected ${sourceFile} or ${fallbackSourceFile}.`
      );
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in recommendation source config: ${effectiveSourceFile}`);
    }
    throw error;
  }

  let rawCatalog = null;
  try {
    rawCatalog = JSON.parse(await readFile(songCatalogFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Missing song catalog at ${songCatalogFile}. Run \`npm run import:data -- --skip-jackets --skip-logos\` first.`
      );
    }
    throw error;
  }

  const songs = normalizeSongCatalog(rawCatalog);
  const matchers = buildMatchers(songs);
  const sources = Array.isArray(sourceConfig?.sources) ? sourceConfig.sources : [];
  if (!sources.length) {
    throw new Error(`No sources found in ${sourceFile}.`);
  }

  const aggregatedMentions = new Map();
  const sourceReports = [];
  let totalItems = 0;
  let matchedItems = 0;

  for (const source of sources) {
    console.log(`Fetching source: ${source.name || source.type}`);
    const items = await fetchSourceItems(source);

    const report = {
      name: source.name || source.type,
      type: source.type,
      fetchedItems: items.length,
      matchedItems: 0,
      warnings: 0
    };

    for (const item of items) {
      if (item.kind === 'warning') {
        report.warnings += 1;
        continue;
      }

      totalItems += 1;
      const mentions = detectSongMentions(item.text, matchers);
      if (!mentions.length) {
        continue;
      }

      matchedItems += 1;
      report.matchedItems += 1;

      const tags = inferTags(item.text);
      const score = scoreMentionItem(item);
      const excerpt = item.kind === 'post'
        ? `${item.title}: ${truncateText(item.text, 180)}`
        : `${item.title}: ${truncateText(item.text, 180)}`;

      for (const match of mentions) {
        let aggregate = aggregatedMentions.get(match.songId);
        if (!aggregate) {
          aggregate = {
            songId: match.songId,
            title: match.title,
            artist: match.artist,
            weight: 0,
            tagCounts: new Map(),
            sources: new Map(),
            bestExcerpt: ''
          };
          aggregatedMentions.set(match.songId, aggregate);
        }

        aggregate.weight += score;

        for (const tag of tags) {
          aggregate.tagCounts.set(tag, (aggregate.tagCounts.get(tag) || 0) + 1);
        }

        const sourceLabel = `${item.sourceName} [${item.sourceQuery}]`;
        if (!aggregate.sources.has(item.url)) {
          aggregate.sources.set(item.url, {
            label: sourceLabel,
            url: item.url
          });
        }

        if (!aggregate.bestExcerpt || score > aggregate.bestExcerptScore) {
          aggregate.bestExcerpt = excerpt;
          aggregate.bestExcerptScore = score;
        }
      }
    }

    sourceReports.push(report);
  }

  const entries = buildRecommendationEntries(aggregatedMentions);

  const output = {
    generatedAt: new Date().toISOString(),
    sourceFile: effectiveSourceFile,
    songCatalogFile: args.songCatalogFile,
    entries
  };

  const report = {
    generatedAt: new Date().toISOString(),
    sourceFile: effectiveSourceFile,
    songCatalogFile: args.songCatalogFile,
    counts: {
      sources: sources.length,
      songsInCatalog: songs.length,
      matchers: matchers.length,
      fetchedItems: totalItems,
      matchedItems,
      recommendedSongs: entries.length
    },
    sources: sourceReports
  };

  await writeJson(outputFile, output);
  await writeJson(reportFile, report);

  console.log(`Generated recommendation dataset: ${outputFile}`);
  console.log(`Generated recommendation report: ${reportFile}`);
  console.log(`Recommended songs: ${entries.length}`);
}

main().catch((error) => {
  console.error('Recommendation import failed:', error);
  process.exitCode = 1;
});
