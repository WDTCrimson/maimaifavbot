import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPatternPage, PatternSessions, parsePatternCustomId } from '../src/song-pattern-view.js';

function entries(count) {
  return Array.from({ length: count }, (_, index) => ({
    song: {
      songId: `song:${String(index).padStart(16, '0')}`,
      title: index === 5 ? '**Markdown**' : `Song ${index + 1}`,
      artist: `Artist ${index + 1}`
    },
    chart: { type: 'dx', difficulty: 'master', internalLevelValue: 13 + index / 10 }
  }));
}

const songCatalog = { getByStoredId: () => null, getUniqueByNormalizedTitle: () => null, getByAlias: () => null };

test('pattern pages show five jacket-ready embeds and preserve page boundaries', () => {
  const imageUrls = new Map([[0, 'attachment://first.png']]);
  const first = buildPatternPage({
    sessionId: 'abcdefgh',
    tag: 'トリル',
    label: 'Trill (トリル)',
    charts: entries(12),
    songCatalog,
    imageUrls,
    playerName: 'Player',
    showScores: true
  });
  assert.equal(first.start, 0);
  assert.equal(first.end, 5);
  assert.equal(first.embeds.length, 5);
  assert.match(first.content, /Showing \*\*1–5\*\* of \*\*12\*\*/);
  assert.equal(first.embeds[0].data.thumbnail.url, 'attachment://first.png');
  assert.equal(first.embeds[0].data.fields.find((field) => field.name === 'Your score').value, 'Not played');
  assert.equal(first.components[0].toJSON().components.length, 5);
  assert.equal(first.components[0].toJSON().components[3].disabled, false);

  const second = buildPatternPage({ sessionId: 'abcdefgh', tag: 'トリル', label: 'Trill (トリル)', charts: entries(12), songCatalog, page: 1 });
  assert.equal(second.start, 5);
  assert.equal(second.end, 10);
  assert.match(second.content, /Showing \*\*6–10\*\* of \*\*12\*\*/);
  assert.match(second.embeds[0].data.title, /\\\*\\\*Markdown\\\*\\\*/);

  const hostileTag = buildPatternPage({ sessionId: 'abcdefgh', tag: '**tag**', label: '**tag**', charts: [], songCatalog });
  assert.equal(hostileTag.embeds[0].data.title, 'Pattern: \\*\\*tag\\*\\*');
});

test('pattern controls parse and session movement is bounded', () => {
  assert.deepEqual(parsePatternCustomId('pattern:abcdefgh:next'), { sessionId: 'abcdefgh', action: 'next' });
  assert.deepEqual(parsePatternCustomId('pattern:abcdefgh:last'), { sessionId: 'abcdefgh', action: 'last' });
  assert.equal(parsePatternCustomId('pattern:short:next'), null);
  const sessions = new PatternSessions({ now: () => 1000 });
  sessions.create('abcdefgh', { charts: entries(12) });
  assert.equal(sessions.move('abcdefgh', 'next').page, 1);
  assert.equal(sessions.move('abcdefgh', 'last').page, 2);
  assert.equal(sessions.move('abcdefgh', 'next').page, 2);
  assert.equal(sessions.move('abcdefgh', 'previous').page, 1);
  assert.equal(sessions.move('abcdefgh', 'first').page, 0);
});
