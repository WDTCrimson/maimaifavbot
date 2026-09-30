import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPatternPage, PatternSessions, parsePatternCustomId } from '../src/song-pattern-view.js';

function entries(count) {
  return Array.from({ length: count }, (_, index) => ({
    song: { songId: `song:${String(index).padStart(16, '0')}`, title: index === 25 ? '**Markdown**' : `Song ${index + 1}` },
    chart: { type: 'dx', difficulty: 'master', internalLevelValue: 13 + index / 10 }
  }));
}

const songCatalog = { getByStoredId: () => null, getUniqueByNormalizedTitle: () => null, getByAlias: () => null };

test('pattern pages show at most 25 charts and preserve page boundaries', () => {
  const first = buildPatternPage({ sessionId: 'abcdefgh', tag: 'トリル', label: 'Trill (トリル)', charts: entries(27), songCatalog });
  assert.equal(first.start, 0);
  assert.equal(first.end, 25);
  assert.match(first.embeds[0].data.footer.text, /Showing 1–25 of 27/);
  assert.equal(first.components[0].toJSON().components[2].disabled, false);

  const second = buildPatternPage({ sessionId: 'abcdefgh', tag: 'トリル', label: 'Trill (トリル)', charts: entries(27), songCatalog, page: 1 });
  assert.equal(second.start, 25);
  assert.equal(second.end, 27);
  assert.match(second.embeds[0].data.footer.text, /Showing 26–27 of 27/);
  assert.match(second.embeds[0].data.description, /\\\*\\\*Markdown\\\*\\\*/);

  const hostileTag = buildPatternPage({ sessionId: 'abcdefgh', tag: '**tag**', label: '**tag**', charts: [], songCatalog });
  assert.equal(hostileTag.embeds[0].data.title, 'Pattern: \\*\\*tag\\*\\*');
});

test('pattern controls parse and session movement is bounded', () => {
  assert.deepEqual(parsePatternCustomId('pattern:abcdefgh:next'), { sessionId: 'abcdefgh', action: 'next' });
  assert.equal(parsePatternCustomId('pattern:short:next'), null);
  const sessions = new PatternSessions({ now: () => 1000 });
  sessions.create('abcdefgh', { charts: entries(26) });
  assert.equal(sessions.move('abcdefgh', 'next').page, 1);
  assert.equal(sessions.move('abcdefgh', 'next').page, 1);
  assert.equal(sessions.move('abcdefgh', 'previous').page, 0);
});
