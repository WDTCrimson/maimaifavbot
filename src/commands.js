import { SlashCommandBuilder } from 'discord.js';

export const loadoutCommand = new SlashCommandBuilder()
  .setName('loadout')
  .setDescription('Manage maimai favorite-song loadouts')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Create a new loadout')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Delete a loadout')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('add')
      .setDescription('Add a song ID to a loadout')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) =>
        option.setName('song_id').setDescription('Numeric song ID').setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('add-song')
      .setDescription('Add a song to a loadout by title/artist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true).setAutocomplete(true)
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
      .setName('remove')
      .setDescription('Remove a song from a loadout by name/artist')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true).setAutocomplete(true)
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
      .setDescription('Show all songs in a loadout')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('list').setDescription('List your loadouts')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('payload')
      .setDescription('Generate a payload for bookmarklet/extension')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('share')
      .setDescription('Generate a share code for this loadout')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('import')
      .setDescription('Import a loadout from share code/payload')
      .addStringOption((option) =>
        option.setName('name').setDescription('Target loadout name').setRequired(true)
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
          .setDescription('Replace target loadout if it already exists')
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
      .setDescription('Search songs by title, artist, or ID')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Song title, artist, or numeric ID')
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

export const commands = [loadoutCommand.toJSON(), songCommand.toJSON()];
