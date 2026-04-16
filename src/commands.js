import { SlashCommandBuilder } from 'discord.js';

export const playlistCommand = new SlashCommandBuilder()
  .setName('playlist')
  .setDescription('Manage maimai favorite-song playlists')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Create a new playlist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Delete a playlist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('add-song')
      .setDescription('Add a song to a playlist by title/artist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('song_query')
          .setDescription('Song title, artist, or numeric ID')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove-song')
      .setDescription('Remove a song from a playlist by name/artist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('song_query')
          .setDescription('Song title, artist, or numeric ID')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('show')
      .setDescription('Show all songs in a playlist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('stats')
      .setDescription('Show stats and breakdowns for a playlist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('graphic')
      .setDescription('Generate a DXRating-style target graphic for a playlist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('set-target')
      .setDescription('Set an achievement target for one song in a playlist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('song_query')
          .setDescription('Song title, artist, or numeric ID')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('target')
          .setDescription('Target achievement like 100.5, 100, 99.5, SSS+, SSS, SS+, SS, S+, or S')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('difficulty')
          .setDescription('Chart difficulty to target')
          .setRequired(false)
          .addChoices(
            { name: 'BASIC', value: 'basic' },
            { name: 'ADVANCED', value: 'advanced' },
            { name: 'EXPERT', value: 'expert' },
            { name: 'MASTER', value: 'master' },
            { name: 'Re:MASTER', value: 'remaster' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription('Chart type when the song has both STD and DX charts')
          .setRequired(false)
          .addChoices(
            { name: 'DX', value: 'dx' },
            { name: 'STD', value: 'std' }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('clear-target')
      .setDescription('Clear an achievement target for one song in a playlist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('song_query')
          .setDescription('Song title, artist, or numeric ID')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('list').setDescription('List your playlists')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('export')
      .setDescription('Generate a payload for bookmarklet/extension')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('apply')
      .setDescription('Apply a playlist directly to your linked maimai favorites')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('share')
      .setDescription('Generate a share code for this playlist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('import')
      .setDescription('Import a playlist from share code/payload')
      .addStringOption((option) =>
        option.setName('name').setDescription('Target playlist name').setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('code')
          .setDescription('Share code or payload text')
          .setRequired(true)
      )
      .addBooleanOption((option) =>
        option
          .setName('replace')
          .setDescription('Replace target playlist if it already exists')
          .setRequired(false)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('bookmarklet')
      .setDescription('Get the bookmarklet install URL')
  );

export const songCommand = new SlashCommandBuilder()
  .setName('song')
  .setDescription('Search song metadata and curated recommendations')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('search')
      .setDescription('Search charts by internal level or internal level range')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Internal level query like 12.7, 12.3-12.8, 13.7 mas, or 12.0-12.4 dx')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('suggest')
      .setDescription('Suggest community-recommended songs for a constant range')
      .addStringOption((option) =>
        option
          .setName('range')
          .setDescription('Exact constant or range like 12.7 or 12.3-12.8')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('focus')
          .setDescription('Optional recommendation tag like entry, tech, stamina, accuracy')
          .setRequired(false)
      )
      .addIntegerOption((option) =>
        option
          .setName('count')
          .setDescription('How many suggestions to return')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(10)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('info')
      .setDescription('Show details for one song')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Song title, artist, or numeric ID')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

export const accountCommand = new SlashCommandBuilder()
  .setName('account')
  .setDescription('Manage linked maimai account snapshots')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('link')
      .setDescription('Generate a one-time external account link session')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('import')
      .setDescription('Import an account snapshot from an external tool')
      .addStringOption((option) =>
        option
          .setName('provider')
          .setDescription('Source of the imported account snapshot')
          .setRequired(true)
          .addChoices(
            { name: 'Auto Detect', value: 'auto' },
            { name: 'Manual', value: 'manual' },
            { name: 'maimaijson', value: 'maimaijson' },
            { name: 'Tomomai', value: 'tomomai' },
            { name: 'mimixd', value: 'mimixd' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('data')
          .setDescription('JSON or base64url-encoded JSON account snapshot')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Show your currently linked account snapshot')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('sync')
      .setDescription('Refresh your linked International account snapshot')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('top')
      .setDescription('Generate a top-score graphic from your linked account snapshot')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('unlink')
      .setDescription('Remove your linked account snapshot')
  );

export const commands = [playlistCommand.toJSON(), songCommand.toJSON(), accountCommand.toJSON()];
