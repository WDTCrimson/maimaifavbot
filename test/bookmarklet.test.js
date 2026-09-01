import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBookmarkletCode,
  createInstallMessage,
  createLoadoutPayload,
  createPayloadMessage
} from '../src/bookmarklet.js';

function decode(payload) {
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

test('loadout payload versions preserve canonical IDs, titles, and valid targets', () => {
  const base = { name: 'Goals', songs: ['song:0000000000000001'] };
  assert.deepEqual(decode(createLoadoutPayload(base)), { version: 1, name: 'Goals', songIds: base.songs });

  const titled = decode(createLoadoutPayload(base, { songs: [{ title: '  KING  ' }, { title: '' }, null] }));
  assert.equal(titled.version, 2);
  assert.deepEqual(titled.songs, [{ title: 'KING', target: null }]);

  const targeted = decode(createLoadoutPayload({
    ...base,
    targets: {
      [base.songs[0]]: { achievementRate: 100.5, difficulty: 'master' },
      ignored: null,
      incomplete: { difficulty: 'expert' }
    }
  }, { songs: [{ title: 'KING', target: { achievementRate: 100.5 } }] }));
  assert.equal(targeted.version, 3);
  assert.deepEqual(Object.keys(targeted.targets), [base.songs[0]]);
});

test('bookmarklet and user-facing messages contain executable and copyable content', () => {
  const loadout = { name: 'Goals', songs: ['1'], targets: {} };
  assert.match(createBookmarkletCode(), /^javascript:/);
  assert.match(createInstallMessage(), /Create a browser bookmark/);
  const message = createPayloadMessage(loadout);
  assert.match(message, /Songs: 1\/30/);
  assert.deepEqual(decode(message.split('\n').at(-1)).songIds, ['1']);
});
