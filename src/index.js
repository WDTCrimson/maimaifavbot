import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AttachmentBuilder, Client, EmbedBuilder, Events, GatewayIntentBits } from 'discord.js';
import { config, limits } from './config.js';
import { createInstallMessage, createPayloadMessage } from './bookmarklet.js';
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
      const songs = formatLoadoutSongs(loadout.songs);
      await replySafely(interaction, `**${loadout.name}** (${loadout.songs.length}/30)\n${songs}`);
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
      const songId = interaction.options.getString('song_id', true);
      const loadout = await store.removeSong(userId, name, songId);
      await replySafely(
        interaction,
        `Removed song ID **${songId}** from **${loadout.name}** (${loadout.songs.length}/30).`
      );
      return;
    }

    case 'payload': {
      const name = interaction.options.getString('name', true);
      const loadout = store.getLoadout(userId, name);
      const message = createPayloadMessage(loadout);
      await replySafely(interaction, message);
      return;
    }

    case 'bookmarklet': {
      const message = createInstallMessage();
      const attachment = new AttachmentBuilder(Buffer.from(`${message}\n`, 'utf8'), {
        name: 'maimai-bookmarklet.txt'
      });

      await interaction.reply({
        content: 'Install steps are in the attached `maimai-bookmarklet.txt` file.',
        files: [attachment],
        ephemeral: true
      });
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

function formatLoadoutSongs(songIds) {
  if (!songIds.length) {
    return 'Songs: (empty)';
  }

  const lines = songIds.map((songId) => {
    if (!songCatalog.available) {
      return `- ${songId}`;
    }

    const song = songCatalog.getByFavoriteId(songId);
    if (!song) {
      return `- ${songId}`;
    }

    return `- ${songId} | ${song.title} - ${song.artist}`;
  });

  return `Songs:\n${lines.join('\n')}`;
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
      const internal =
        typeof chart.internalLevelValue === 'number' ? chart.internalLevelValue : chart.internalLevelValue || '?';
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

async function resolveArtworkAttachment(song) {
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
      const filename = basename(path);
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
  const chartSummary = buildChartSummary(song);
  const artwork = await resolveArtworkAttachment(song);

  const embed = new EmbedBuilder()
    .setColor(0x4f46e5)
    .setTitle(song.title)
    .setDescription(song.artist || 'Unknown artist')
    .addFields(
      { name: 'Loadout', value: `${loadout.name} (${loadout.songs.length}/30)` },
      { name: 'Charts', value: chartSummary.join('\n') }
    );

  if (artwork) {
    embed.setThumbnail(artwork.imageUrl);
  }

  const payload = {
    content: `Added **${song.title}** to **${loadout.name}**.`,
    embeds: [embed]
  };

  if (artwork) {
    payload.files = [artwork.attachment];
  }

  await replyPayload(interaction, payload);
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
