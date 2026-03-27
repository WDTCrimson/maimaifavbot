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
      case 'loadout':
        await handleLoadoutCommand(interaction);
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
  if (interaction.commandName === 'loadout') {
    await handleLoadoutAutocomplete(interaction);
    return;
  }

  if (interaction.commandName === 'song') {
    await handleSongAutocomplete(interaction);
    return;
  }

  await interaction.respond([]);
}

async function handleLoadoutAutocomplete(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const focused = interaction.options.getFocused(true);
  const focusedValue = String(focused.value || '');

  if (focused.name === 'name') {
    const choices = getLoadoutNameChoices(interaction.user.id, focusedValue);
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

  if (subcommand === 'remove' && focused.name === 'song_query') {
    const loadoutName = interaction.options.getString('name');
    const choices = getLoadoutSongChoices(interaction.user.id, loadoutName, focusedValue);
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
  const choices = songCatalog.autocomplete(focusedValue, 25);
  await interaction.respond(choices);
}

function getLoadoutNameChoices(userId, query) {
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

function getLoadoutSongChoices(userId, loadoutName, query) {
  if (!loadoutName) {
    return [];
  }

  let loadout = null;
  try {
    loadout = store.getLoadout(userId, loadoutName);
  } catch {
    return [];
  }

  const normalizedQuery = String(query || '').trim().toLowerCase();

  const entries = loadout.songs
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

async function handleLoadoutCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  switch (subcommand) {
    case 'create': {
      const name = interaction.options.getString('name', true);
      const loadout = await store.createLoadout(userId, name);
      await replySafely(interaction, `Created loadout **${loadout.name}**.`);
      return;
    }

    case 'delete': {
      const name = interaction.options.getString('name', true);
      const loadout = await store.deleteLoadout(userId, name);
      await replySafely(interaction, `Deleted loadout **${loadout.name}**.`);
      return;
    }

    case 'list': {
      const loadouts = store.listLoadouts(userId);
      if (!loadouts.length) {
        await replySafely(interaction, 'You have no loadouts yet. Use `/loadout create` first.');
        return;
      }

      const lines = loadouts.map((loadout) => `- ${loadout.name} (${loadout.songs.length}/30)`);
      await replySafely(interaction, `Your loadouts:\n${lines.join('\n')}`);
      return;
    }

    case 'show': {
      const name = interaction.options.getString('name', true);
      const loadout = store.getLoadout(userId, name);
      await replyLoadoutShow(interaction, loadout);
      return;
    }

    case 'graphic': {
      songCatalog.requireAvailable();
      const name = interaction.options.getString('name', true);
      const loadout = store.getLoadout(userId, name);
      if (!loadout.songs.length) {
        await replySafely(interaction, `**${loadout.name}** is empty. Add songs first.`);
        return;
      }

      const songs = loadout.songs.map((songId) => songCatalog.getByFavoriteId(songId)).filter(Boolean);
      if (!songs.length) {
        throw new Error('No songs from this loadout are available in the local song catalog.');
      }

      const graphic = await renderLoadoutGraphic({
        loadoutName: loadout.name,
        songs,
        themeDir: config.graphicThemeDir
      });

      const attachment = new AttachmentBuilder(graphic.buffer, {
        name: graphic.fileName
      });

      const missingCount = loadout.songs.length - songs.length;
      const content =
        missingCount > 0
          ? `Generated loadout graphic for **${loadout.name}** (${songs.length} songs rendered, ${missingCount} missing in catalog).`
          : `Generated loadout graphic for **${loadout.name}** (${songs.length} songs rendered).`;

      await replyPayload(interaction, {
        content,
        files: [attachment]
      });
      return;
    }

    case 'add': {
      const name = interaction.options.getString('name', true);
      const songId = interaction.options.getString('song_id', true);
      const loadout = await store.addSong(userId, name, songId);
      const song = songCatalog.available ? songCatalog.getByFavoriteId(songId) : null;
      if (!song) {
        await replySafely(
          interaction,
          `Added song ID **${songId}** to **${loadout.name}** (${loadout.songs.length}/30).`
        );
        return;
      }

      await replySongAdded(interaction, {
        loadout,
        song,
        songId
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

      const loadout = await store.addSong(userId, name, song.favoriteId);
      await replySongAdded(interaction, {
        loadout,
        song,
        songId: song.favoriteId
      });
      return;
    }

    case 'remove': {
      const name = interaction.options.getString('name', true);
      const songQuery = interaction.options.getString('song_query', true);
      const loadoutBefore = store.getLoadout(userId, name);
      const songId = resolveSongIdInLoadout(loadoutBefore, songQuery);
      const loadout = await store.removeSong(userId, name, songId);
      const removedSong = songCatalog.available ? songCatalog.getByFavoriteId(songId) : null;
      if (removedSong) {
        await replySafely(
          interaction,
          `Removed **${removedSong.title}** from **${loadout.name}** (${loadout.songs.length}/30).`
        );
        return;
      }

      await replySafely(interaction, `Removed song from **${loadout.name}** (${loadout.songs.length}/30).`);
      return;
    }

    case 'payload': {
      const name = interaction.options.getString('name', true);
      const loadout = store.getLoadout(userId, name);
      const payload = createLoadoutPayload(loadout, {
        songs: buildPayloadSongs(loadout)
      });
      await replyPayload(interaction, {
        content: `Loadout: **${loadout.name}** (${loadout.songs.length}/30)\nPayload below (copy this message only):`
      });
      await replySafely(interaction, payload);
      return;
    }

    case 'share': {
      const name = interaction.options.getString('name', true);
      const loadout = store.getLoadout(userId, name);
      const shareCode = createLoadoutPayload(loadout, {
        songs: buildPayloadSongs(loadout)
      });
      const lines = [
        `Share code for **${loadout.name}** (${loadout.songs.length}/30):`,
        shareCode,
        '',
        'Use `/loadout import` with this code.'
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
          `Loadout "${name}" already exists. Set \`replace:true\` in \`/loadout import\` to overwrite it.`
        );
      }

      if (!exists) {
        await store.createLoadout(userId, name);
      }

      const loadout = await store.setSongs(userId, name, decoded.songIds, {
        createIfMissing: true
      });

      const unresolvedSummary = formatUnresolvedTitleSummary(decoded.unresolvedTitles || []);
      const unresolvedLine = unresolvedSummary
        ? `\nSkipped unresolved titles: ${unresolvedSummary}`
        : '';

      await replySafely(
        interaction,
        `Imported **${loadout.songs.length}** song(s) into **${loadout.name}** from "${decoded.name}".${unresolvedLine}`
      );
      return;
    }

    case 'bookmarklet': {
      await replyPayload(interaction, {
        content:
          'Copy the next message as your bookmark URL.\nThen run `/loadout payload`, open CHANGE FAVORITE SONGS, click bookmark, and paste payload. It auto-submits DECIDE.'
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
  const query = interaction.options.getString('query', true);

  switch (subcommand) {
    case 'search': {
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

function resolveSongIdInLoadout(loadout, songQuery) {
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
  if (exact && loadout.songs.includes(exact.favoriteId)) {
    return exact.favoriteId;
  }

  const normalizedQuery = query.toLowerCase();
  const partial = loadout.songs.find((songId) => {
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

  throw new Error(`No matching song in this loadout for "${songQuery}".`);
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
    name: String(payload.name || 'Imported Loadout').trim() || 'Imported Loadout',
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

function buildPayloadSongs(loadout) {
  return loadout.songs.map((songId) => {
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

async function replySongAdded(interaction, { loadout, song, songId }) {
  const artwork = await resolveArtworkAttachment(song);
  const embed = createSongEmbed(song, loadout, artwork?.imageUrl);

  const payload = {
    content: `Added **${song.title}** to **${loadout.name}**.`,
    embeds: [embed]
  };

  if (artwork) {
    payload.files = [artwork.attachment];
  }

  await replyPayload(interaction, payload);
}

function createSongEmbed(song, loadout, imageUrl) {
  const chartSummary = buildChartSummary(song);
  const embed = new EmbedBuilder()
    .setColor(0x4f46e5)
    .setTitle(song.title)
    .setDescription(song.artist || 'Unknown artist')
    .addFields(
      { name: 'Loadout', value: `${loadout.name} (${loadout.songs.length}/30)` },
      { name: 'Charts', value: chartSummary.join('\n') }
    );

  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  }

  return embed;
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function replyLoadoutShow(interaction, loadout) {
  if (!loadout.songs.length) {
    await replySafely(interaction, `**${loadout.name}** is empty.`);
    return;
  }

  if (!songCatalog.available) {
    await replySafely(
      interaction,
      `**${loadout.name}** (${loadout.songs.length}/30)\nSong catalog unavailable for embed view.`
    );
    return;
  }

  const entries = loadout.songs
    .map((songId) => songCatalog.getByFavoriteId(songId))
    .filter(Boolean);
  const missingCount = loadout.songs.length - entries.length;

  if (!entries.length) {
    await replySafely(interaction, `**${loadout.name}** has no songs that match the local catalog.`);
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
      const embed = createSongEmbed(song, loadout, artwork?.imageUrl);
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
          ? `**${loadout.name}** (${loadout.songs.length}/30) - ${missingCount} song(s) missing from catalog`
          : `**${loadout.name}** (${loadout.songs.length}/30)`;
    } else {
      payload.content = `**${loadout.name}** (continued ${chunkIndex + 1}/${chunks.length})`;
    }

    await replyPayload(interaction, payload);
  }
}

async function replySafely(interaction, content) {
  if (content.length > 1900) {
    const attachment = new AttachmentBuilder(Buffer.from(`${content}\n`, 'utf8'), {
      name: 'loadout-response.txt'
    });

    await replyPayload(interaction, {
      content: 'Response was too long, so it was attached as `loadout-response.txt`.',
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
