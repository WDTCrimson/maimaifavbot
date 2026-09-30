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
      .addStringOption((option) =>
        option
          .setName('combo')
          .setDescription('Optional combo target to show on the target board')
          .setRequired(false)
          .addChoices(
            { name: 'FC', value: 'fc' },
            { name: 'FC+', value: 'fc+' },
            { name: 'AP', value: 'ap' },
            { name: 'AP+', value: 'ap+' }
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
      .setDescription('Suggest personalized discovery and improvement charts')
      .addStringOption((option) =>
        option
          .setName('range')
          .setDescription('Optional exact constant or range like 12.7 or 12.3-12.8')
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('mode')
          .setDescription('Mix discoveries and improvements, or select one lane')
          .setRequired(false)
          .addChoices(
            { name: 'Balanced', value: 'balanced' },
            { name: 'Discovery', value: 'discovery' },
            { name: 'Improvement', value: 'improvement' }
          )
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
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('calc')
      .setDescription('Calculate rating for a song chart at a target achievement')
      .addStringOption((option) =>
        option
          .setName('query')
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
          .setDescription('Chart difficulty to calculate for')
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
      .addStringOption((option) =>
        option
          .setName('combo')
          .setDescription('Optional combo status to include in the rating calculation')
          .setRequired(false)
          .addChoices(
            { name: 'None', value: 'none' },
            { name: 'FC', value: 'fc' },
            { name: 'FC+', value: 'fc+' },
            { name: 'AP', value: 'ap' },
            { name: 'AP+', value: 'ap+' }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('estimate')
      .setDescription('Estimate if a target score would enter or improve your B50')
      .addStringOption((option) =>
        option
          .setName('query')
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
          .setDescription('Chart difficulty to calculate for')
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
      .addStringOption((option) =>
        option
          .setName('combo')
          .setDescription('Optional combo status to include in the rating calculation')
          .setRequired(false)
          .addChoices(
            { name: 'None', value: 'none' },
            { name: 'FC', value: 'fc' },
            { name: 'FC+', value: 'fc+' },
            { name: 'AP', value: 'ap' },
            { name: 'AP+', value: 'ap+' }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('score')
      .setDescription('Show your personal best score card for a song')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Song title, artist, or numeric ID')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('difficulty')
          .setDescription('Chart difficulty (defaults to your best on that song)')
          .setRequired(false)
          .addChoices(
            { name: 'BASIC',     value: 'basic' },
            { name: 'ADVANCED',  value: 'advanced' },
            { name: 'EXPERT',    value: 'expert' },
            { name: 'MASTER',    value: 'master' },
            { name: 'Re:MASTER', value: 'remaster' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription('Chart type when the song has both STD and DX charts')
          .setRequired(false)
          .addChoices(
            { name: 'DX',  value: 'dx' },
            { name: 'STD', value: 'std' }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('pattern')
      .setDescription('Browse charts by an editor pattern tag')
      .addStringOption((option) =>
        option.setName('tag').setDescription('Pattern name in English, Japanese, or romaji').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) =>
        option.setName('level').setDescription('Displayed or precise level, such as 13+ or 13.7').setRequired(false)
      )
      .addStringOption((option) =>
        option.setName('difficulty').setDescription('Chart difficulty').setRequired(false).addChoices(
          { name: 'BASIC', value: 'basic' },
          { name: 'ADVANCED', value: 'advanced' },
          { name: 'EXPERT', value: 'expert' },
          { name: 'MASTER', value: 'master' },
          { name: 'Re:MASTER', value: 'remaster' }
        )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('random')
      .setDescription('Pick one random chart')
      .addStringOption((option) =>
        option.setName('level').setDescription('Displayed or precise level, such as 13+ or 13.7').setRequired(false)
      )
      .addStringOption((option) =>
        option.setName('difficulty').setDescription('Chart difficulty').setRequired(false).addChoices(
          { name: 'BASIC', value: 'basic' },
          { name: 'ADVANCED', value: 'advanced' },
          { name: 'EXPERT', value: 'expert' },
          { name: 'MASTER', value: 'master' },
          { name: 'Re:MASTER', value: 'remaster' }
        )
      )
      .addBooleanOption((option) =>
        option.setName('unplayed').setDescription('Only choose charts missing from your linked scores').setRequired(false)
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
      .setName('public')
      .setDescription('Manage the shareable public page for your active profile')
      .addStringOption((option) =>
        option
          .setName('action')
          .setDescription('Enable, view, or disable public sharing')
          .setRequired(true)
          .addChoices(
            { name: 'Enable', value: 'enable' },
            { name: 'View link', value: 'view' },
            { name: 'Disable', value: 'disable' }
          )
      )
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
      .setName('recent')
      .setDescription('Generate a recent-credit graphic from your linked account snapshot')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('unlink')
      .setDescription('Remove a linked account snapshot or delete a profile')
      .addStringOption((option) =>
        option
          .setName('profile')
          .setDescription('Profile to remove (defaults to your active profile)')
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('profiles')
      .setDescription('List your account profiles')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('switch')
      .setDescription('Switch your active account profile (creates it if it does not exist)')
      .addStringOption((option) =>
        option
          .setName('name')
          .setDescription('Profile name')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('gap')
      .setDescription('Recommend achievable score targets that increase your B15/B35 rating')
      .addStringOption((option) =>
        option.setName('bucket').setDescription('Limit results to a rating bucket').setRequired(false).addChoices(
          { name: 'All', value: 'all' },
          { name: 'Current B15/B35', value: 'best' },
          { name: 'New charts', value: 'new' },
          { name: 'Old charts', value: 'old' }
        )
      )
      .addStringOption((option) =>
        option.setName('difficulty').setDescription('Chart difficulty').setRequired(false).addChoices(
          { name: 'BASIC', value: 'basic' },
          { name: 'ADVANCED', value: 'advanced' },
          { name: 'EXPERT', value: 'expert' },
          { name: 'MASTER', value: 'master' },
          { name: 'Re:MASTER', value: 'remaster' }
        )
      )
      .addStringOption((option) =>
        option.setName('level').setDescription('Displayed or precise level, such as 13+ or 13.7').setRequired(false)
      )
      .addStringOption((option) =>
        option.setName('type').setDescription('Chart type').setRequired(false).addChoices(
          { name: 'DX', value: 'dx' }, { name: 'STD', value: 'std' }
        )
      )
      .addStringOption((option) =>
        option.setName('sort').setDescription('How to rank matching targets').setRequired(false).addChoices(
          { name: 'Efficiency', value: 'efficiency' }, { name: 'Largest rating gain', value: 'gain' }
        )
      )
      .addIntegerOption((option) =>
        option.setName('count').setDescription('Number of targets to show (default 10)').setRequired(false).setMinValue(1).setMaxValue(20)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('progress')
      .setDescription('Show version completion and plate progress')
      .addStringOption((option) =>
        option.setName('version').setDescription('maimai version; omit for an overview').setRequired(false).setAutocomplete(true)
      )
      .addStringOption((option) =>
        option.setName('plate').setDescription('Plate goal; choose with a version to list missing charts').setRequired(false).addChoices(
          { name: '極 — FC or better', value: 'kiwami' },
          { name: '将 — SSS or better', value: 'shou' },
          { name: '神 — AP or better', value: 'shin' },
          { name: '舞舞 — FDX or better', value: 'maimai' }
        )
      )
      .addStringOption((option) =>
        option.setName('difficulty').setDescription('Limit progress to one difficulty').setRequired(false).addChoices(
          { name: 'BASIC', value: 'basic' },
          { name: 'ADVANCED', value: 'advanced' },
          { name: 'EXPERT', value: 'expert' },
          { name: 'MASTER', value: 'master' }
        )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('history').setDescription('Show rating and play-count changes across saved syncs')
      .addIntegerOption((option) =>
        option.setName('count').setDescription('Snapshots to show (default 10)').setRequired(false).setMinValue(2).setMaxValue(20)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('daily').setDescription('Summarize saved plays for one day')
      .addStringOption((option) =>
        option.setName('date').setDescription('Play date (YYYY-MM-DD); omit for latest saved day').setRequired(false).setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('roast').setDescription('Receive a completely scientific review of your account')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('plays')
      .setDescription('Generate a graphic showing your top songs by play count')
      .addIntegerOption((option) =>
        option
          .setName('count')
          .setDescription('How many songs to show (default 10, max 20)')
          .setRequired(false)
          .setMinValue(3)
          .setMaxValue(20)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('summary')
      .setDescription('Generate a level summary graphic grouped by rank tier')
      .addStringOption((option) =>
        option
          .setName('level')
          .setDescription('Level bracket to display')
          .setRequired(true)
          .addChoices(
            { name: 'Lv 10',  value: '10'  },
            { name: 'Lv 10+', value: '10+' },
            { name: 'Lv 11',  value: '11'  },
            { name: 'Lv 11+', value: '11+' },
            { name: 'Lv 12',  value: '12'  },
            { name: 'Lv 12+', value: '12+' },
            { name: 'Lv 13',  value: '13'  },
            { name: 'Lv 13+', value: '13+' },
            { name: 'Lv 14',  value: '14'  },
            { name: 'Lv 14+', value: '14+' },
            { name: 'Lv 15',  value: '15'  },
            { name: 'Lv 15+', value: '15+' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('difficulty')
          .setDescription('Chart difficulty')
          .setRequired(true)
          .addChoices(
            { name: 'BASIC',     value: 'basic'    },
            { name: 'ADVANCED',  value: 'advanced' },
            { name: 'EXPERT',    value: 'expert'   },
            { name: 'MASTER',    value: 'master'   },
            { name: 'Re:MASTER', value: 'remaster' }
          )
      )
  );

export const commands = [playlistCommand.toJSON(), songCommand.toJSON(), accountCommand.toJSON()];
