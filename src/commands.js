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
        option.setName('name').setDescription('Loadout name').setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('add')
      .setDescription('Add a song ID to a loadout')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true)
      )
      .addStringOption((option) =>
        option.setName('song_id').setDescription('Numeric song ID').setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('Remove a song ID from a loadout')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true)
      )
      .addStringOption((option) =>
        option.setName('song_id').setDescription('Numeric song ID').setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('show')
      .setDescription('Show all songs in a loadout')
      .addStringOption((option) =>
        option.setName('name').setDescription('Loadout name').setRequired(true)
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
        option.setName('name').setDescription('Loadout name').setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('bookmarklet')
      .setDescription('Get the bookmarklet install URL')
  );

export const commands = [loadoutCommand.toJSON()];
