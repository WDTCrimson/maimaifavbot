import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareLinkedAuthForStorage,
  restoreLinkedAuthFromStorage
} from '../src/account-link-auth.js';

const TOKEN = 'A'.repeat(32);
const SECRET = 'test-only-encryption-secret';

test('linked auth encrypts an International clal token and round-trips it', () => {
  const stored = prepareLinkedAuthForStorage(
    { region: 'INTL', type: 'CLAL', token: `clal=${TOKEN}` },
    SECRET
  );

  assert.equal(stored.region, 'intl');
  assert.equal(stored.type, 'clal');
  assert.equal(stored.encrypted.version, 1);
  assert.equal(JSON.stringify(stored).includes(TOKEN), false);
  assert.deepEqual(restoreLinkedAuthFromStorage(stored, SECRET), {
    region: 'intl',
    type: 'clal',
    token: TOKEN
  });
});

test('linked auth ignores unsupported auth and rejects malformed or tampered data', () => {
  assert.equal(prepareLinkedAuthForStorage(null, SECRET), null);
  assert.equal(prepareLinkedAuthForStorage({ region: 'jp', type: 'cookie', token: TOKEN }, SECRET), null);
  assert.equal(restoreLinkedAuthFromStorage({ region: 'jp', type: 'cookie' }, SECRET), null);
  assert.throws(
    () => prepareLinkedAuthForStorage({ region: 'intl', type: 'clal', token: 'short' }, SECRET),
    /Invalid International/
  );

  const stored = prepareLinkedAuthForStorage({ region: 'intl', type: 'clal', token: TOKEN }, SECRET);
  assert.throws(() => restoreLinkedAuthFromStorage(stored, 'wrong-secret'));
  assert.throws(() => restoreLinkedAuthFromStorage({ ...stored, encrypted: { bad: true } }, SECRET));
});
