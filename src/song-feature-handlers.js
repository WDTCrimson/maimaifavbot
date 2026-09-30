import { randomBytes } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { buildPatternPage, parsePatternCustomId, PatternSessions } from './song-pattern-view.js';
import { buildRandomChartPayload, selectRandomChart } from './song-random-view.js';

export function createSongFeatureHandlers({
  chartFacts,
  songCatalog,
  store,
  replyPayload,
  replyPublicPayload = replyPayload,
  replySafely,
  resolveArtworkAttachment = async () => null,
  rng = Math.random
}) {
  const sessions = new PatternSessions();

  async function buildPatternPayload(sessionId, session) {
    const preview = buildPatternPage({ sessionId, ...session });
    const imageUrls = new Map();
    const files = [];
    await Promise.all(
      preview.shown.map(async (entry, pageIndex) => {
        const globalIndex = preview.start + pageIndex;
        const artwork = await resolveArtworkAttachment(entry.song, `pattern-${sessionId}-${globalIndex + 1}`);
        if (!artwork) return;
        imageUrls.set(globalIndex, artwork.imageUrl);
        files.push(artwork.attachment);
      })
    );
    const page = buildPatternPage({ sessionId, ...session, imageUrls });
    return {
      content: page.content,
      embeds: page.embeds,
      components: page.components,
      files
    };
  }

  async function pattern(interaction) {
    await chartFacts.reloadIfChanged();
    if (!chartFacts.available) {
      await replySafely(interaction, chartFacts.unavailableMessage());
      return;
    }
    const tag = interaction.options.getString('tag', true);
    const level = interaction.options.getString('level');
    const difficulty = interaction.options.getString('difficulty');
    const charts = chartFacts.chartsWithTag(tag, { songCatalog, level, difficulty });
    const account = store.getAccount(interaction.user.id);
    const scores = account ? store.getAccountScores(interaction.user.id) : [];
    const sessionId = randomBytes(8).toString('base64url');
    const session = sessions.create(sessionId, {
      ownerId: interaction.user.id,
      tag,
      label: chartFacts.labelFor(tag),
      charts,
      scores,
      songCatalog,
      showScores: Boolean(account),
      playerName: account?.player?.name || null
    });
    await replyPublicPayload(interaction, await buildPatternPayload(sessionId, session));
  }

  async function random(interaction) {
    await chartFacts.reloadIfChanged();
    const level = interaction.options.getString('level');
    const difficulty = interaction.options.getString('difficulty');
    const unplayed = interaction.options.getBoolean('unplayed') || false;
    const account = store.getAccount(interaction.user.id);
    if (unplayed && !account) {
      await replySafely(interaction, 'The `unplayed` filter needs a linked account. Use `/account link` first.');
      return;
    }
    const entry = selectRandomChart({
      songCatalog,
      scores: account ? store.getAccountScores(interaction.user.id) : [],
      level,
      difficulty,
      unplayed,
      rng
    });
    if (!entry) {
      await replySafely(interaction, 'No charts match those random-pick filters.');
      return;
    }
    const artwork = await resolveArtworkAttachment(entry.song, 'song-random');
    const patternLabels = chartFacts.available
      ? chartFacts.tagsFor(entry.song, entry.chart).map((tag) => chartFacts.labelFor(tag))
      : [];
    const payload = buildRandomChartPayload(entry, {
      imageUrl: artwork?.imageUrl,
      patternLabels
    });
    if (artwork) payload.files = [artwork.attachment];
    await replyPublicPayload(interaction, payload);
  }

  return {
    commands: new Map([['pattern', pattern], ['random', random]]),
    async autocomplete(interaction) {
      if (interaction.options.getSubcommand(false) !== 'pattern') return false;
      const focused = interaction.options.getFocused(true);
      if (focused.name !== 'tag') return false;
      await chartFacts.reloadIfChanged();
      await interaction.respond(chartFacts.available ? chartFacts.autocomplete(focused.value, 25) : []);
      return true;
    },
    parseButton: parsePatternCustomId,
    async handleButton(interaction, control) {
      const session = sessions.get(control.sessionId);
      if (!session) {
        await interaction.reply({ content: 'This pattern page expired. Run `/song pattern` again.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (session.ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'Only the person who opened this pattern list can page it.', flags: MessageFlags.Ephemeral });
        return;
      }
      sessions.move(control.sessionId, control.action);
      await interaction.deferUpdate();
      const payload = await buildPatternPayload(control.sessionId, session);
      await interaction.editReply({
        ...payload,
        attachments: []
      });
    }
  };
}
