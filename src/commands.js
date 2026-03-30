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
      .setDescription('Generate a Favorite playlist graphic image')
      .addStringOption((option) =>
        option.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
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
  .setDescription('Search song metadata imported for this bot')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('search')
      .setDescription('Search songs by title/artist/ID or exact chart constant')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Song title, artist, numeric ID, or constant like 12.3 / 13.7 mas')
          .setRequired(true)
          .setAutocomplete(true)
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

export const commands = [playlistCommand.toJSON(), songCommand.toJSON()];
