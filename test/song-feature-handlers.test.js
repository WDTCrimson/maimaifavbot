import assert from 'node:assert/strict';
import test from 'node:test';
import { createSongFeatureHandlers } from '../src/song-feature-handlers.js';

function makeSongs(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    songId: `song:${String(index + 1).padStart(16, '0')}`,
    title: `Song ${index + 1}`,
    artist: `Artist ${index + 1}`,
    category: 'maimai',
    regions: { intl: true },
    difficultyLevels: [{ type: 'dx', difficulty: 'master', level: '13+', internalLevelValue: 13.7 }]
  }));
}

function makeHarness() {
  const songs = makeSongs();
  const songCatalog = {
    songs,
    getBySongId(id) { return songs.find((song) => song.songId === id) || null; },
    getByStoredId(id) { return this.getBySongId(id); },
    getUniqueByNormalizedTitle() { return null; },
    getByAlias() { return null; }
  };
  const chartFacts = {
    available: true,
    async reloadIfChanged() {},
    chartsWithTag() {
      return songs.map((song) => ({ songId: song.songId, song, chart: song.difficultyLevels[0], tags: ['トリル'] }));
    },
    tagsFor() { return ['トリル']; },
    labelFor() { return 'Trill (トリル)'; },
    autocomplete() { return []; },
    unavailableMessage() { return 'Unavailable'; }
  };
  const store = {
    getAccount() { return null; },
    getAccountScores() { return []; }
  };
  const replies = [];
  const publicReplies = [];
  const handlers = createSongFeatureHandlers({
    chartFacts,
    songCatalog,
    store,
    replyPayload: async (_interaction, payload) => replies.push(payload),
    replyPublicPayload: async (_interaction, payload) => publicReplies.push(payload),
    replySafely: async () => {},
    resolveArtworkAttachment: async (_song, prefix) => ({
      attachment: { name: `${prefix}.png` },
      imageUrl: `attachment://${prefix}.png`
    }),
    rng: () => 0
  });
  return { handlers, replies, publicReplies };
}

test('pattern handler attaches jackets and replaces them when paging', async () => {
  const { handlers, replies, publicReplies } = makeHarness();
  const pattern = handlers.commands.get('pattern');
  await pattern({
    user: { id: 'owner' },
    options: {
      getString(name) { return name === 'tag' ? 'トリル' : null; }
    }
  });

  assert.equal(replies.length, 0);
  assert.equal(publicReplies.length, 1);
  assert.equal(publicReplies[0].embeds.length, 5);
  assert.equal(publicReplies[0].files.length, 5);
  const nextId = publicReplies[0].components[0].toJSON().components[3].custom_id;
  const control = handlers.parseButton(nextId);
  let deferred = false;
  let edited = null;
  await handlers.handleButton({
    user: { id: 'owner' },
    async deferUpdate() { deferred = true; },
    async editReply(payload) { edited = payload; }
  }, control);

  assert.equal(deferred, true);
  assert.deepEqual(edited.attachments, []);
  assert.equal(edited.embeds.length, 1);
  assert.equal(edited.files.length, 1);
  assert.match(edited.content, /Showing \*\*6–6\*\* of \*\*6\*\*/);
});

test('random handler includes its jacket and pattern labels', async () => {
  const { handlers, replies, publicReplies } = makeHarness();
  const random = handlers.commands.get('random');
  await random({
    user: { id: 'owner' },
    options: {
      getString() { return null; },
      getBoolean() { return false; }
    }
  });

  assert.equal(replies.length, 0);
  assert.equal(publicReplies[0].files.length, 1);
  assert.equal(publicReplies[0].embeds[0].data.thumbnail.url, 'attachment://song-random.png');
  assert.match(publicReplies[0].embeds[0].data.fields.find((field) => field.name === 'Patterns').value, /Trill/);
});
