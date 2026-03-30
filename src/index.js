import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AttachmentBuilder, Client, EmbedBuilder, Events, GatewayIntentBits } from 'discord.js';
import { config, limits } from './config.js';
import { createBookmarkletCode, createLoadoutPayload } from './bookmarklet.js';
import { renderLoadoutGraphic } from './loadout-graphic.js';
import { SongCatalog } from './song-catalog.js';
import { LoadoutStore } from './store.js';

const store = new LoadoutStore(config.dataFile, limits);
await store.ensureReady();

const songCatalog = new SongCatalog(config.songCatalogFile);
await songCatalog.ensureReady();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  if (songCatalog.available) {
    console.log(`Loaded song catalog: ${songCatalog.count} songs`);
  } else {
    console.warn(`Song catalog unavailable at ${config.songCatalogFile}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      await handleAutocomplete(interaction);
    } catch (error) {
      console.error('Autocomplete error:', error);
      try {
        await interaction.respond([]);
      } catch {
        // ignored
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    switch (interaction.commandName) {
      case 'playlist':
        await handlePlaylistCommand(interaction);
        return;
      case 'song':
        await handleSongCommand(interaction);
        return;
      default:
        return;
    }
  } catch (error) {
    await replySafely(interaction, `Error: ${error.message}`);
  }
});

async function handleAutocomplete(interaction) {
  if (interaction.commandName === 'playlist') {
    await handlePlaylistAutocomplete(interaction);
    return;
  }

  if (interaction.commandName === 'song') {
    await handleSongAutocomplete(interaction);
    return;
  }

  await interaction.respond([]);
}

async function handlePlaylistAutocomplete(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const focused = interaction.options.getFocused(true);
  const focusedValue = String(focused.value || '');

  if (focused.name === 'name') {
    const choices = getPlaylistNameChoices(interaction.user.id, focusedValue);
    await interaction.respond(choices);
    return;
  }

  if (subcommand === 'add-song' && focused.name === 'song_query') {
    if (!songCatalog.available) {
      await interaction.respond([]);
      return;
    }
    const choices = songCatalog.autocomplete(focusedValue, 25);
    await interaction.respond(choices);
    return;
  }

  if ((subcommand === 'remove-song' || subcommand === 'remove') && focused.name === 'song_query') {
    const playlistName = interaction.options.getString('name');
    const choices = getPlaylistSongChoices(interaction.user.id, playlistName, focusedValue);
    await interaction.respond(choices);
    return;
  }

  await interaction.respond([]);
}

async function handleSongAutocomplete(interaction) {
  if (!songCatalog.available) {
    await interaction.respond([]);
    return;
  }

  const focusedValue = String(interaction.options.getFocused(true).value || '');
  if (parseConstantSearchQuery(focusedValue)) {
    await interaction.respond([]);
    return;
  }

  const choices = songCatalog.autocomplete(focusedValue, 25);
  await interaction.respond(choices);
}

function getPlaylistNameChoices(userId, query) {
  const normalizedQuery = query.trim().toLowerCase();
  return store
    .listLoadouts(userId)
    .filter((loadout) => !normalizedQuery || loadout.name.toLowerCase().includes(normalizedQuery))
    .slice(0, 25)
    .map((loadout) => ({
      name: `${loadout.name} (${loadout.songs.length}/30)`,
      value: loadout.name
    }));
}

function truncateChoiceName(value, maxLength = 100) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function getPlaylistSongChoices(userId, playlistName, query) {
  if (!playlistName) {
    return [];
  }

  let playlist = null;
  try {
    playlist = store.getLoadout(userId, playlistName);
  } catch {
    return [];
  }

  const normalizedQuery = String(query || '').trim().toLowerCase();

  const entries = playlist.songs
    .map((songId) => {
      const song = songCatalog.available ? songCatalog.getByFavoriteId(songId) : null;
      const label = song ? `${song.title} - ${song.artist}` : songId;
      return {
        label,
        songId
      };
    })
    .filter((entry) => {
      if (!normalizedQuery) {
        return true;
      }
      return (
        entry.songId.toLowerCase().includes(normalizedQuery) ||
        entry.label.toLowerCase().includes(normalizedQuery)
      );
    })
    .slice(0, 25)
    .map((entry) => ({
      name: truncateChoiceName(entry.label),
      value: entry.songId
    }));

  return entries;
}

async function handlePlaylistCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  switch (subcommand) {
    case 'create': {
      const name = interaction.options.getString('name', true);
      const playlist = await store.createLoadout(userId, name);
      await replySafely(interaction, `Created playlist **${playlist.name}**.`);
      return;
    }

    case 'delete': {
      const name = interaction.options.getString('name', true);
      const playlist = await store.deleteLoadout(userId, name);
      await replySafely(interaction, `Deleted playlist **${playlist.name}**.`);
      return;
    }

    case 'list': {
      const playlists = store.listLoadouts(userId);
      if (!playlists.length) {
        await replySafely(interaction, 'You have no playlists yet. Use `/playlist create` first.');
        return;
      }

      const lines = playlists.map((playlist) => `- ${playlist.name} (${playlist.songs.length}/30)`);
      await replySafely(interaction, `Your playlists:\n${lines.join('\n')}`);
      return;
    }

    case 'show': {
      const name = interaction.options.getString('name', true);
      const playlist = store.getLoadout(userId, name);
      await replyPlaylistShow(interaction, playlist);
      return;
    }

    case 'stats': {
      const name = interaction.options.getString('name', true);
      const playlist = store.getLoadout(userId, name);
      await replyPlaylistStats(interaction, playlist);
      return;
    }

    case 'graphic': {
      songCatalog.requireAvailable();
      const name = interaction.options.getString('name', true);
      const playlist = store.getLoadout(userId, name);
      if (!playlist.songs.length) {
        await replySafely(interaction, `**${playlist.name}** is empty. Add songs first.`);
        return;
      }

      const songs = playlist.songs.map((songId) => songCatalog.getByFavoriteId(songId)).filter(Boolean);
      if (!songs.length) {
        throw new Error('No songs from this playlist are available in the local song catalog.');
      }

      const graphic = await renderLoadoutGraphic({
        loadoutName: playlist.name,
        songs,
        themeDir: config.graphicThemeDir
      });

      const attachment = new AttachmentBuilder(graphic.buffer, {
        name: graphic.fileName
      });

      const missingCount = playlist.songs.length - songs.length;
      const content =
        missingCount > 0
          ? `Generated playlist graphic for **${playlist.name}** (${songs.length} songs rendered, ${missingCount} missing in catalog).`
          : `Generated playlist graphic for **${playlist.name}** (${songs.length} songs rendered).`;

      await replyPayload(interaction, {
        content,
        files: [attachment]
      });
      return;
    }

    case 'add-song': {
      songCatalog.requireAvailable();
      const name = interaction.options.getString('name', true);
      const songQuery = interaction.options.getString('song_query', true);
      const song = songCatalog.resolveSong(songQuery);

      if (!song) {
        throw new Error(`No matching song found for "${songQuery}".`);
      }

      const playlist = await store.addSong(userId, name, song.favoriteId);
      await replySongAdded(interaction, {
        playlist,
        song,
        songId: song.favoriteId
      });
      return;
    }

    case 'remove-song':
    case 'remove': {
      const name = interaction.options.getString('name', true);
      const songQuery = interaction.options.getString('song_query', true);
      const playlistBefore = store.getLoadout(userId, name);
      const songId = resolveSongIdInPlaylist(playlistBefore, songQuery);
      const playlist = await store.removeSong(userId, name, songId);
      const removedSong = songCatalog.available ? songCatalog.getByFavoriteId(songId) : null;
      if (removedSong) {
        await replySafely(
          interaction,
          `Removed **${removedSong.title}** from **${playlist.name}** (${playlist.songs.length}/30).`
        );
        return;
      }

      await replySafely(interaction, `Removed song from **${playlist.name}** (${playlist.songs.length}/30).`);
      return;
    }

    case 'export':
    case 'payload': {
      const name = interaction.options.getString('name', true);
      const playlist = store.getLoadout(userId, name);
      const payload = createLoadoutPayload(playlist, {
        songs: buildPayloadSongs(playlist)
      });
      await replyPayload(interaction, {
        content: `Playlist: **${playlist.name}** (${playlist.songs.length}/30)\nPayload below (copy this message only):`
      });
      await replySafely(interaction, payload);
      return;
    }

    case 'share': {
      const name = interaction.options.getString('name', true);
      const playlist = store.getLoadout(userId, name);
      const shareCode = createLoadoutPayload(playlist, {
        songs: buildPayloadSongs(playlist)
      });
      const lines = [
        `Share code for **${playlist.name}** (${playlist.songs.length}/30):`,
        shareCode,
        '',
        'Use `/playlist import` with this code.'
      ];
      await replySafely(interaction, lines.join('\n'));
      return;
    }

    case 'import': {
      const name = interaction.options.getString('name', true);
      const code = interaction.options.getString('code', true);
      const replace = interaction.options.getBoolean('replace') || false;
      const decoded = decodeLoadoutCode(code);

      const exists = store.hasLoadout(userId, name);
      if (exists && !replace) {
        throw new Error(
          `Playlist "${name}" already exists. Set \`replace:true\` in \`/playlist import\` to overwrite it.`
        );
      }

      if (!exists) {
        await store.createLoadout(userId, name);
      }

      const playlist = await store.setSongs(userId, name, decoded.songIds, {
        createIfMissing: true
      });

      const unresolvedSummary = formatUnresolvedTitleSummary(decoded.unresolvedTitles || []);
      const unresolvedLine = unresolvedSummary
        ? `\nSkipped unresolved titles: ${unresolvedSummary}`
        : '';

      await replySafely(
        interaction,
        `Imported **${playlist.songs.length}** song(s) into **${playlist.name}** from "${decoded.name}".${unresolvedLine}`
      );
      return;
    }

    case 'bookmarklet': {
      await replyPayload(interaction, {
        content:
          'Copy the next message as your bookmark URL.\nThen run `/playlist export`, open CHANGE FAVORITE SONGS, click bookmark, and paste payload. It auto-submits DECIDE.'
      });
      await replySafely(interaction, createBookmarkletCode());
      return;
    }

    default:
      await replySafely(interaction, `Unknown subcommand: ${subcommand}`);
  }
}

async function handleSongCommand(interaction) {
  songCatalog.requireAvailable();

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'search': {
      const query = interaction.options.getString('query', true);
      const constantSearch = parseConstantSearchQuery(query);

      if (constantSearch) {
        const matches = findChartsByConstant({
          constant: constantSearch.constant,
          difficulty: constantSearch.difficulty,
          chartType: constantSearch.chartType,
          limit: 25
        });

        if (!matches.length) {
          await replySafely(
            interaction,
            `No charts found for constant ${formatInternalLevel(
              constantSearch.constant
            )}${buildConstantFilterSuffix({
              difficulty: constantSearch.difficulty,
              chartType: constantSearch.chartType
            })}.`
          );
          return;
        }

        const lines = matches.map((entry, index) => {
          const difficultyText = formatDifficultyShort(entry.chart.difficulty);
          const typeText = String(entry.chart.type || 'UNK').toUpperCase();
          const levelText = String(entry.chart.level || '?');
          const constantText = formatInternalLevel(entry.chart.internalLevelValue);
          return `${index + 1}. [${typeText} ${difficultyText}] ${entry.song.title} - Lvl ${levelText} [${constantText}]`;
        });

        await replySafely(
          interaction,
          `Charts at constant ${formatInternalLevel(
            constantSearch.constant
          )}${buildConstantFilterSuffix({
            difficulty: constantSearch.difficulty,
            chartType: constantSearch.chartType
          })}:\n${lines.join('\n')}`
        );
        return;
      }

      const songs = songCatalog.search(query, 10);
      if (!songs.length) {
        await replySafely(interaction, `No songs found for "${query}".`);
        return;
      }

      const lines = songs.map(
        (song, index) => `${index + 1}. [${song.favoriteId}] ${song.title} - ${song.artist}`
      );
      await replySafely(interaction, `Top matches for "${query}":\n${lines.join('\n')}`);
      return;
    }

    case 'info': {
      const query = interaction.options.getString('query', true);
      const song = songCatalog.resolveSong(query);
      if (!song) {
        await replySafely(interaction, `No song found for "${query}".`);
        return;
      }

      const levelSummary = formatSongLevels(song);
      const lines = [
        `ID: ${song.favoriteId}`,
        `Title: ${song.title}`,
        `Artist: ${song.artist}`,
        `Category: ${song.category || 'Unknown'}`,
        `BPM: ${song.bpm ?? 'Unknown'}`,
        `Levels: ${levelSummary}`
      ];
      await replySafely(interaction, lines.join('\n'));
      return;
    }

    default:
      await replySafely(interaction, `Unknown subcommand: ${subcommand}`);
  }
}

function parseConstantSearchQuery(rawQuery) {
  const tokens = String(rawQuery || '')
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  let constant = null;
  let difficulty = null;
  let chartType = null;

  const difficultyMap = new Map([
    ['basic', 'basic'],
    ['bsc', 'basic'],
    ['advanced', 'advanced'],
    ['adv', 'advanced'],
    ['expert', 'expert'],
    ['exp', 'expert'],
    ['master', 'master'],
    ['mas', 'master'],
    ['remaster', 'remaster'],
    ['remas', 'remaster']
  ]);

  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase().replace(/^[^a-z0-9.+:-]+|[^a-z0-9.+:-]+$/g, '');
    if (!token) {
      continue;
    }

    if (constant == null && /^\d{1,2}\.\d$/.test(token)) {
      constant = Number.parseFloat(token);
      continue;
    }

    if (!chartType && (token === 'std' || token === 'dx')) {
      chartType = token;
      continue;
    }

    if (!difficulty) {
      const compact = token.replace(/[^a-z]/g, '');
      if (difficultyMap.has(compact)) {
        difficulty = difficultyMap.get(compact);
      }
    }
  }

  if (constant == null) {
    return null;
  }

  return {
    constant,
    difficulty,
    chartType
  };
}

function normalizeChartText(value) {
  return String(value || '')
    .toLowerCase()
    .trim();
}

function parseInternalConstant(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function sameConstant(a, b, epsilon = 0.0001) {
  return Math.abs(a - b) < epsilon;
}

function formatDifficultyShort(value) {
  const difficulty = normalizeChartText(value);
  const labels = {
    basic: 'BSC',
    advanced: 'ADV',
    expert: 'EXP',
    master: 'MAS',
    remaster: 'REMAS'
  };
  return labels[difficulty] || String(value || 'UNK').toUpperCase();
}

function findChartsByConstant({ constant, difficulty, chartType, limit }) {
  const difficultyFilter = difficulty ? normalizeChartText(difficulty) : null;
  const chartTypeFilter = chartType ? normalizeChartText(chartType) : null;

  const matches = [];
  for (const song of songCatalog.songs) {
    for (const chart of Array.isArray(song.difficultyLevels) ? song.difficultyLevels : []) {
      const chartConstant = parseInternalConstant(chart.internalLevelValue);
      if (chartConstant == null || !sameConstant(chartConstant, constant)) {
        continue;
      }

      if (difficultyFilter && normalizeChartText(chart.difficulty) !== difficultyFilter) {
        continue;
      }
      if (chartTypeFilter && normalizeChartText(chart.type) !== chartTypeFilter) {
        continue;
      }

      matches.push({ song, chart });
    }
  }

  matches.sort((a, b) => {
    const byTitle = a.song.title.localeCompare(b.song.title);
    if (byTitle !== 0) {
      return byTitle;
    }
    return normalizeChartText(a.chart.difficulty).localeCompare(normalizeChartText(b.chart.difficulty));
  });

  return matches.slice(0, limit);
}

function buildConstantFilterSuffix({ difficulty, chartType }) {
  const parts = [];
  if (difficulty) {
    parts.push(formatDifficultyShort(difficulty));
  }
  if (chartType) {
    parts.push(String(chartType || '').toUpperCase());
  }
  if (!parts.length) {
    return '';
  }
  return ` (${parts.join(', ')})`;
}

function formatSongLevels(song) {
  if (!song.difficultyLevels?.length) {
    return 'Unknown';
  }

  const order = ['basic', 'advanced', 'expert', 'master', 'remaster'];
  const labels = {
    basic: 'BASIC',
    advanced: 'ADV',
    expert: 'EXP',
    master: 'MAS',
    remaster: 'Re:MAS'
  };

  const buckets = new Map();
  for (const difficulty of order) {
    buckets.set(difficulty, new Set());
  }

  for (const levelInfo of song.difficultyLevels) {
    const difficulty = String(levelInfo.difficulty || '').toLowerCase();
    const level = String(levelInfo.level || '').trim();
    if (!buckets.has(difficulty) || !level) {
      continue;
    }
    buckets.get(difficulty).add(level);
  }

  const pieces = [];
  for (const difficulty of order) {
    const levels = [...buckets.get(difficulty)];
    if (!levels.length) {
      continue;
    }
    pieces.push(`${labels[difficulty]} ${levels.join('/')}`);
  }

  return pieces.join(', ') || 'Unknown';
}

function resolveSongIdInPlaylist(playlist, songQuery) {
  const query = String(songQuery || '').trim();
  if (!query) {
    throw new Error('Song query cannot be empty.');
  }

  if (/^\d{1,8}$/.test(query)) {
    return query;
  }

  if (!songCatalog.available) {
    throw new Error('Song catalog is unavailable. Use numeric song ID or import song data.');
  }

  const exact = songCatalog.resolveSong(query);
  if (exact && playlist.songs.includes(exact.favoriteId)) {
    return exact.favoriteId;
  }

  const normalizedQuery = query.toLowerCase();
  const partial = playlist.songs.find((songId) => {
    const song = songCatalog.getByFavoriteId(songId);
    if (!song) {
      return false;
    }
    return (
      song.title.toLowerCase().includes(normalizedQuery) ||
      song.artist.toLowerCase().includes(normalizedQuery)
    );
  });

  if (partial) {
    return partial;
  }

  throw new Error(`No matching song in this playlist for "${songQuery}".`);
}

function decodeLoadoutCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) {
    throw new Error('Import code cannot be empty.');
  }

  let payload = null;

  if (code.startsWith('{')) {
    try {
      payload = JSON.parse(code);
    } catch {
      throw new Error('Invalid JSON payload.');
    }
  } else {
    const normalized = code.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLength);
    let decoded = null;

    try {
      decoded = Buffer.from(padded, 'base64').toString('utf8');
    } catch {
      throw new Error('Invalid base64/base64url share code.');
    }

    try {
      payload = JSON.parse(decoded);
    } catch {
      throw new Error('Share code decoded but payload is not valid JSON.');
    }
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload is invalid.');
  }

  const seen = new Set();
  const songIds = [];
  for (const value of Array.isArray(payload.songIds) ? payload.songIds : []) {
    const songId = String(value || '').trim();
    if (!/^\d{1,8}$/.test(songId)) {
      continue;
    }
    if (seen.has(songId)) {
      continue;
    }
    seen.add(songId);
    songIds.push(songId);
  }

  const unresolvedTitles = [];
  if (!songIds.length) {
    const titles = extractSongTitlesFromPayload(payload);
    if (titles.length) {
      if (!songCatalog.available) {
        throw new Error(
          'Payload contains song titles only, but song catalog is unavailable. Set `SONG_CATALOG_FILE` and import song data first.'
        );
      }

      for (const title of titles) {
        const resolved = resolveSongIdFromImportedTitle(title);
        if (!resolved.songId) {
          unresolvedTitles.push(
            resolved.reason === 'ambiguous'
              ? `${title} (ambiguous match)`
              : `${title} (not found)`
          );
          continue;
        }

        if (seen.has(resolved.songId)) {
          continue;
        }

        seen.add(resolved.songId);
        songIds.push(resolved.songId);
      }
    }
  }

  if (!songIds.length) {
    if (unresolvedTitles.length) {
      throw new Error(
        `Payload titles could not be resolved to song IDs: ${formatUnresolvedTitleSummary(unresolvedTitles)}`
      );
    }
    throw new Error('Payload contains no valid song IDs or resolvable song titles.');
  }
  if (songIds.length > limits.maxSongsPerLoadout) {
    throw new Error(`Payload exceeds ${limits.maxSongsPerLoadout} songs.`);
  }

  return {
    name: String(payload.name || 'Imported Playlist').trim() || 'Imported Playlist',
    songIds,
    unresolvedTitles
  };
}

function normalizeImportTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSongTitlesFromPayload(payload) {
  return [
    ...(Array.isArray(payload.songs) ? payload.songs.map((entry) => entry?.title) : []),
    ...(Array.isArray(payload.songTitles) ? payload.songTitles : [])
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function resolveSongIdFromImportedTitle(title) {
  const normalized = normalizeImportTitle(title);
  if (!normalized) {
    return { songId: null, reason: 'not_found' };
  }

  const exactMatches = songCatalog.songs.filter((song) => song.normTitle === normalized);
  if (exactMatches.length === 1) {
    return { songId: exactMatches[0].favoriteId, reason: 'exact' };
  }
  if (exactMatches.length > 1) {
    return { songId: null, reason: 'ambiguous' };
  }

  const fallback = songCatalog.resolveSong(title);
  if (!fallback) {
    return { songId: null, reason: 'not_found' };
  }

  return { songId: fallback.favoriteId, reason: 'fuzzy' };
}

function formatUnresolvedTitleSummary(unresolvedTitles, maxItems = 5) {
  if (!unresolvedTitles.length) {
    return '';
  }

  const items = unresolvedTitles.slice(0, maxItems);
  const extra = unresolvedTitles.length - items.length;
  if (extra > 0) {
    return `${items.join(', ')} (+${extra} more)`;
  }
  return items.join(', ');
}

function buildPayloadSongs(playlist) {
  return playlist.songs.map((songId) => {
    const song = songCatalog.available ? songCatalog.getByFavoriteId(songId) : null;
    if (!song) {
      return { id: songId };
    }
    return {
      id: songId,
      title: song.title
    };
  });
}

function buildChartSummary(song) {
  if (!song.difficultyLevels?.length) {
    return ['No chart metadata available.'];
  }

  const difficultyOrder = ['basic', 'advanced', 'expert', 'master', 'remaster'];
  const difficultyRank = new Map(difficultyOrder.map((difficulty, index) => [difficulty, index]));
  const difficultyLabel = {
    basic: 'BASIC',
    advanced: 'ADV',
    expert: 'EXP',
    master: 'MAS',
    remaster: 'Re:MAS'
  };

  const rows = [...song.difficultyLevels]
    .filter((chart) => chart.level)
    .sort((a, b) => {
      const aDifficulty = String(a.difficulty || '').toLowerCase();
      const bDifficulty = String(b.difficulty || '').toLowerCase();
      const aRank = difficultyRank.get(aDifficulty) ?? 999;
      const bRank = difficultyRank.get(bDifficulty) ?? 999;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return String(a.type || '').localeCompare(String(b.type || ''));
    })
    .map((chart) => {
      const difficulty = String(chart.difficulty || '').toLowerCase();
      const difficultyText = difficultyLabel[difficulty] || String(chart.difficulty || 'UNKNOWN');
      const typeText = String(chart.type || 'UNK').toUpperCase();
      const levelText = `Lvl ${chart.level}`;
      const internal = formatInternalLevel(chart.internalLevelValue);
      const versionText = chart.version || 'Unknown version';
      return `${typeText} ${difficultyText} ${levelText} [${internal}] - ${versionText}`;
    });

  if (!rows.length) {
    return ['No chart metadata available.'];
  }

  const maxFieldLength = 900;
  const limitedRows = [];
  let used = 0;
  for (const row of rows) {
    if (used + row.length + 1 > maxFieldLength) {
      break;
    }
    limitedRows.push(row);
    used += row.length + 1;
  }

  if (limitedRows.length < rows.length) {
    limitedRows.push(`...and ${rows.length - limitedRows.length} more chart rows`);
  }

  return limitedRows;
}

function formatInternalLevel(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toFixed(1) : String(value);
  }

  const text = String(value ?? '').trim();
  if (!text) {
    return '?';
  }
  if (/^-?\d+$/.test(text)) {
    return `${text}.0`;
  }
  return text;
}

function buildSafeAttachmentName(prefix, filename) {
  const safePrefix = String(prefix || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!safePrefix) {
    return filename;
  }
  return `${safePrefix}-${filename}`;
}

async function resolveArtworkAttachment(song, namePrefix = '') {
  const candidates = [
    song.jacket?.dxratingFile
      ? join(process.cwd(), 'data', 'assets', 'jacket', 'dxrating', song.jacket.dxratingFile)
      : null,
    song.jacket?.otogeFile
      ? join(process.cwd(), 'data', 'assets', 'jacket', 'otoge-db', song.jacket.otogeFile)
      : null
  ].filter(Boolean);

  for (const path of candidates) {
    try {
      const fileStat = await stat(path);
      if (!fileStat.isFile()) {
        continue;
      }
      const filename = buildSafeAttachmentName(namePrefix, basename(path));
      return {
        attachment: new AttachmentBuilder(path, { name: filename }),
        imageUrl: `attachment://${filename}`
      };
    } catch {
      // try next
    }
  }

  return null;
}

async function replySongAdded(interaction, { playlist, song, songId }) {
  const artwork = await resolveArtworkAttachment(song);
  const embed = createSongEmbed(song, playlist, artwork?.imageUrl);

  const payload = {
    content: `Added **${song.title}** to **${playlist.name}**.`,
    embeds: [embed]
  };

  if (artwork) {
    payload.files = [artwork.attachment];
  }

  await replyPayload(interaction, payload);
}

function createSongEmbed(song, playlist, imageUrl) {
  const chartSummary = buildChartSummary(song);
  const embed = new EmbedBuilder()
    .setColor(0x4f46e5)
    .setTitle(song.title)
    .setDescription(song.artist || 'Unknown artist')
    .addFields(
      { name: 'Playlist', value: `${playlist.name} (${playlist.songs.length}/30)` },
      { name: 'Charts', value: chartSummary.join('\n') }
    );

  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  }

  return embed;
}

function incrementCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function truncateStatsLabel(value, maxLength = 28) {
  const text = String(value || '').trim();
  if (!text) {
    return 'Unknown';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatTopCounts(countsMap, { limit = 6, maxLabelLength = 28 } = {}) {
  const entries = [...countsMap.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return String(a[0]).localeCompare(String(b[0]));
  });

  if (!entries.length) {
    return 'None';
  }

  const lines = entries.slice(0, limit).map(([label, count], index) => {
    return `${index + 1}. ${truncateStatsLabel(label, maxLabelLength)} (${count})`;
  });

  if (entries.length > limit) {
    lines.push(`+${entries.length - limit} more`);
  }

  return lines.join('\n');
}

function buildPlaylistStatsEmbed(playlist, songs, missingCount) {
  const categoryCounts = new Map();
  const versionCounts = new Map();
  const typeSongCounts = new Map([
    ['std', 0],
    ['dx', 0]
  ]);
  const difficultyChartCounts = new Map([
    ['basic', 0],
    ['advanced', 0],
    ['expert', 0],
    ['master', 0],
    ['remaster', 0]
  ]);
  const uniqueArtists = new Set();

  let chartCount = 0;
  let constantCount = 0;
  let constantSum = 0;
  let constantMin = Infinity;
  let constantMax = -Infinity;

  for (const song of songs) {
    incrementCount(categoryCounts, song.category || 'Unknown');
    uniqueArtists.add(song.artist || 'Unknown');

    const songTypes = new Set();

    for (const chart of Array.isArray(song.difficultyLevels) ? song.difficultyLevels : []) {
      chartCount += 1;

      const difficulty = normalizeChartText(chart.difficulty);
      if (difficultyChartCounts.has(difficulty)) {
        incrementCount(difficultyChartCounts, difficulty);
      }

      const type = normalizeChartText(chart.type);
      if (type === 'std' || type === 'dx') {
        songTypes.add(type);
      }

      const version = String(chart.version || '').trim() || 'Unknown';
      incrementCount(versionCounts, version);

      const constant = parseInternalConstant(chart.internalLevelValue);
      if (constant != null) {
        constantCount += 1;
        constantSum += constant;
        constantMin = Math.min(constantMin, constant);
        constantMax = Math.max(constantMax, constant);
      }
    }

    for (const type of songTypes) {
      incrementCount(typeSongCounts, type);
    }
  }

  const averageConstant =
    constantCount > 0 ? Number.parseFloat((constantSum / constantCount).toFixed(2)) : null;

  const overviewLines = [
    `Songs: ${playlist.songs.length}/30`,
    `In local catalog: ${songs.length}`,
    `Missing in catalog: ${missingCount}`,
    `Unique artists: ${uniqueArtists.size}`
  ];

  if (chartCount > 0) {
    overviewLines.push(`Total charts scanned: ${chartCount}`);
  }

  const typeLines = [
    `Songs w/ DX charts: ${typeSongCounts.get('dx') || 0}`,
    `Songs w/ STD charts: ${typeSongCounts.get('std') || 0}`
  ];

  const difficultyLines = [
    `BASIC: ${difficultyChartCounts.get('basic') || 0}`,
    `ADV: ${difficultyChartCounts.get('advanced') || 0}`,
    `EXP: ${difficultyChartCounts.get('expert') || 0}`,
    `MAS: ${difficultyChartCounts.get('master') || 0}`,
    `REMAS: ${difficultyChartCounts.get('remaster') || 0}`
  ];

  const constantLine =
    constantCount > 0
      ? `Min ${formatInternalLevel(constantMin)} | Avg ${formatInternalLevel(
          averageConstant
        )} | Max ${formatInternalLevel(constantMax)}`
      : 'No internal constant data available.';

  const embed = new EmbedBuilder()
    .setColor(0x0891b2)
    .setTitle(`Playlist Stats - ${playlist.name}`)
    .addFields(
      { name: 'Overview', value: overviewLines.join('\n') },
      { name: 'Chart Types (per song)', value: typeLines.join('\n') },
      { name: 'Difficulty Counts (charts)', value: difficultyLines.join('\n') },
      { name: 'Internal Constants (charts)', value: constantLine },
      {
        name: 'Top Categories',
        value: formatTopCounts(categoryCounts, { limit: 6, maxLabelLength: 26 })
      },
      {
        name: 'Top Versions',
        value: formatTopCounts(versionCounts, { limit: 6, maxLabelLength: 26 })
      }
    );

  return embed;
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function replyPlaylistShow(interaction, playlist) {
  if (!playlist.songs.length) {
    await replySafely(interaction, `**${playlist.name}** is empty.`);
    return;
  }

  if (!songCatalog.available) {
    await replySafely(
      interaction,
      `**${playlist.name}** (${playlist.songs.length}/30)\nSong catalog unavailable for embed view.`
    );
    return;
  }

  const entries = playlist.songs
    .map((songId) => songCatalog.getByFavoriteId(songId))
    .filter(Boolean);
  const missingCount = playlist.songs.length - entries.length;

  if (!entries.length) {
    await replySafely(interaction, `**${playlist.name}** has no songs that match the local catalog.`);
    return;
  }

  const chunks = chunkArray(entries, 10);
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const embeds = [];
    const files = [];

    for (let songIndex = 0; songIndex < chunk.length; songIndex += 1) {
      const song = chunk[songIndex];
      const artwork = await resolveArtworkAttachment(song, `show-${chunkIndex}-${songIndex}`);
      const embed = createSongEmbed(song, playlist, artwork?.imageUrl);
      embeds.push(embed);
      if (artwork) {
        files.push(artwork.attachment);
      }
    }

    const payload = {
      embeds
    };

    if (files.length) {
      payload.files = files;
    }

    if (chunkIndex === 0) {
      payload.content =
        missingCount > 0
          ? `**${playlist.name}** (${playlist.songs.length}/30) - ${missingCount} song(s) missing from catalog`
          : `**${playlist.name}** (${playlist.songs.length}/30)`;
    } else {
      payload.content = `**${playlist.name}** (continued ${chunkIndex + 1}/${chunks.length})`;
    }

    await replyPayload(interaction, payload);
  }
}

async function replyPlaylistStats(interaction, playlist) {
  if (!playlist.songs.length) {
    await replySafely(interaction, `**${playlist.name}** is empty.`);
    return;
  }

  if (!songCatalog.available) {
    await replySafely(
      interaction,
      `**${playlist.name}** (${playlist.songs.length}/30)\nSong catalog unavailable for detailed stats.`
    );
    return;
  }

  const songs = playlist.songs
    .map((songId) => songCatalog.getByFavoriteId(songId))
    .filter(Boolean);
  const missingCount = playlist.songs.length - songs.length;

  const embed = buildPlaylistStatsEmbed(playlist, songs, missingCount);
  await replyPayload(interaction, { embeds: [embed] });
}

async function replySafely(interaction, content) {
  if (content.length > 1900) {
    const attachment = new AttachmentBuilder(Buffer.from(`${content}\n`, 'utf8'), {
      name: 'playlist-response.txt'
    });

    await replyPayload(interaction, {
      content: 'Response was too long, so it was attached as `playlist-response.txt`.',
      files: [attachment]
    });
    return;
  }

  await replyPayload(interaction, { content });
}

async function replyPayload(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ ...payload, ephemeral: true });
    return;
  }

  await interaction.reply({ ...payload, ephemeral: true });
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

await client.login(config.token);
