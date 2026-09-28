import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecentCreditNavigation,
  parseRecentCreditCustomId,
  RecentCreditSessions
} from '../src/account-recent-view.js';
import { groupRecentCredits } from '../src/account-recent-graphic.js';

test('groupRecentCredits separates newest-first track sequences', () => {
  const credits = groupRecentCredits([
    { title: 'C', track: 3 }, { title: 'B', track: 2 }, { title: 'A', track: 1 },
    { title: 'E', track: 2 }, { title: 'D', track: 1 }
  ]);
  assert.deepEqual(credits.map((credit) => credit.map((play) => play.title)), [
    ['C', 'B', 'A'], ['E', 'D']
  ]);
});

test('recent credit navigation identifies controls and page state', () => {
  assert.deepEqual(parseRecentCreditCustomId('recent:abcdefgh:older'), {
    sessionId: 'abcdefgh', action: 'older'
  });
  assert.equal(parseRecentCreditCustomId('recent:abcdefgh:page'), null);

  const row = buildRecentCreditNavigation('abcdefgh', 1, 3).toJSON().components;
  assert.equal(row[0].disabled, false);
  assert.equal(row[2].label, '2/3');
  assert.equal(row[4].disabled, false);
});

test('RecentCreditSessions moves within bounds and expires', () => {
  let now = 1000;
  const sessions = new RecentCreditSessions({ ttlMs: 500, now: () => now });
  sessions.create('abcdefgh', { ownerId: 'user', creditCount: 3 });
  assert.equal(sessions.move('abcdefgh', 'older').creditIndex, 1);
  assert.equal(sessions.move('abcdefgh', 'oldest').creditIndex, 2);
  assert.equal(sessions.move('abcdefgh', 'older').creditIndex, 2);
  assert.equal(sessions.move('abcdefgh', 'latest').creditIndex, 0);
  now = 1500;
  assert.equal(sessions.get('abcdefgh'), null);
});
