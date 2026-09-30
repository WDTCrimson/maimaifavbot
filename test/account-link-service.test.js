import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLinkCallbackServerEnabled,
  buildAccountLinkUrl,
  createAccountLinkSignature,
  createAccountLinkToken,
  secretEquals,
  startAccountLinkCallbackServer,
  verifyAccountLinkSignature
} from '../src/account-link-service.js';

async function withServer(options, run) {
  const server = await startAccountLinkCallbackServer({ bind: '127.0.0.1', port: 0, ...options });
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function responseJson(url, options) {
  return fetch(url, options).then(async (response) => ({ response, body: await response.json() }));
}

test('account-link token, signatures, URLs, and enablement are consistent', () => {
  const token = createAccountLinkToken();
  const expiresAt = '2027-01-02T03:04:05.000Z';
  const signature = createAccountLinkSignature({ clientId: 'maideck', token, expiresAt, signingSecret: 'secret' });

  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(verifyAccountLinkSignature({ clientId: 'maideck', token, expiresAt, signature, signingSecret: 'secret' }), true);
  assert.equal(verifyAccountLinkSignature({ clientId: 'other', token, expiresAt, signature, signingSecret: 'secret' }), false);
  const url = new URL(buildAccountLinkUrl({ baseUrl: 'https://link.example/start?keep=1', clientId: 'maideck', token, expiresAt, signature }));
  assert.equal(url.searchParams.get('keep'), '1');
  assert.equal(url.searchParams.get('client_id'), 'maideck');
  assert.equal(url.searchParams.get('token'), token);
  assert.equal(accountLinkCallbackServerEnabled({ accountLinkCallbackPort: 8000, accountLinkSharedSecret: 'x' }), true);
  assert.equal(accountLinkCallbackServerEnabled({ accountLinkCallbackPort: null, accountLinkSharedSecret: 'x' }), false);
});

test('callback server exposes health and rejects unauthorized and unknown routes', async () => {
  const store = { cleanupExpiredAccountLinkSessions: async () => {}, getAccountLinkSession: () => null };
  await withServer({ sharedSecret: 'shared', store, normalizeImportedAccountSnapshot: (value) => value }, async (base) => {
    const health = await responseJson(`${base}/health`);
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { ok: true, service: 'account-link-callback' });

    const unauthorized = await responseJson(`${base}/account-link/callback`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(unauthorized.response.status, 401);
    assert.equal(unauthorized.body.code, 'CALLBACK-UNAUTHORIZED');

    const missing = await responseJson(`${base}/missing`);
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.code, 'CALLBACK-ROUTE-NOT-FOUND');
  });
});

test('callback server returns only enabled public profile payloads to the linker', async () => {
  const store = { cleanupExpiredAccountLinkSessions: async () => {}, getAccountLinkSession: () => null };
  await withServer({
    sharedSecret: 'shared', store, normalizeImportedAccountSnapshot: (value) => value,
    getPublicProfile: (id) => id === 'abcdefghijklmnopqrstuvwx'
      ? { player: { name: 'Alice' }, songs: [] }
      : null,
    getPublicJacket: (songId) => songId === 'song:1234567890abcdef'
      ? { data: Buffer.from('jacket-bytes'), contentType: 'image/jpeg' }
      : null
  }, async (base) => {
    const unauthorized = await responseJson(`${base}/public-profile/abcdefghijklmnopqrstuvwx`);
    assert.equal(unauthorized.response.status, 401);

    const found = await responseJson(`${base}/public-profile/abcdefghijklmnopqrstuvwx`, {
      headers: { 'x-account-link-secret': 'shared' }
    });
    assert.equal(found.response.status, 200);
    assert.deepEqual(found.body.profile, { player: { name: 'Alice' }, songs: [] });
    assert.equal(found.response.headers.get('cache-control'), 'private, no-store');

    const missing = await responseJson(`${base}/public-profile/zyxwvutsrqponmlkjihgfedc`, {
      headers: { 'x-account-link-secret': 'shared' }
    });
    assert.equal(missing.response.status, 404);

    const unauthorizedJacket = await fetch(`${base}/public-jacket/song%3A1234567890abcdef`);
    assert.equal(unauthorizedJacket.status, 401);
    const jacket = await fetch(`${base}/public-jacket/song%3A1234567890abcdef`, {
      headers: { 'x-account-link-secret': 'shared' }
    });
    assert.equal(jacket.status, 200);
    assert.equal(jacket.headers.get('content-type'), 'image/jpeg');
    assert.equal(await jacket.text(), 'jacket-bytes');
  });
});

test('callback server validates sessions, normalizes snapshots, stores auth in the bound profile, and consumes the token', async () => {
  const calls = [];
  const future = new Date(Date.now() + 60_000).toISOString();
  const store = {
    cleanupExpiredAccountLinkSessions: async () => calls.push('cleanup'),
    getAccountLinkSession: (token) => token === 'valid'
      ? { userId: 'user-1', profileName: 'friend', status: 'pending', expiresAt: future }
      : null,
    setAccount: async (userId, account, profileName) => {
      calls.push(['set', userId, account, profileName]);
      return account;
    },
    completeAccountLinkSession: async (token) => calls.push(['complete', token])
  };
  await withServer({
    sharedSecret: 'shared', store,
    normalizeImportedAccountSnapshot: (snapshot, provider) => ({ provider, player: snapshot }),
    prepareLinkedAuth: (auth) => ({ encrypted: auth.token })
  }, async (base) => {
    const result = await responseJson(`${base}/account-link/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-account-link-secret': 'shared' },
      body: JSON.stringify({ token: 'valid', provider: 'Tomomai', account: { name: 'Alice' }, auth: { token: 'cookie' } })
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { ok: true, provider: 'tomomai' });
    assert.deepEqual(calls[1], ['set', 'user-1', {
      provider: 'tomomai', player: { name: 'Alice' }, linkMethod: 'web', linkedAuth: { encrypted: 'cookie' }
    }, 'friend']);
    assert.deepEqual(calls[2].slice(0, 2), ['complete', 'valid']);

    const unknown = await responseJson(`${base}/account-link/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-account-link-secret': 'shared' },
      body: JSON.stringify({ token: 'unknown', account: {} })
    });
    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.body.code, 'CALLBACK-NOT-FOUND');
  });
});

test('callback server returns stable validation errors and hides internal failures', async () => {
  const errors = [];
  const future = new Date(Date.now() + 60_000).toISOString();
  const store = {
    cleanupExpiredAccountLinkSessions: async () => {},
    getAccountLinkSession: () => ({ userId: 'user-1', status: 'pending', expiresAt: future }),
    setAccount: async () => { throw new Error('database password must not leak'); },
    completeAccountLinkSession: async () => {}
  };
  await withServer({
    sharedSecret: 'shared', store,
    normalizeImportedAccountSnapshot: (value) => value,
    logger: { error: (...args) => errors.push(args) }
  }, async (base) => {
    const malformed = await responseJson(`${base}/account-link/callback`, {
      method: 'POST', headers: { 'x-account-link-secret': 'shared' }, body: '{'
    });
    assert.equal(malformed.response.status, 400);
    assert.match(malformed.body.code, /^CALLBACK-/);

    const failed = await responseJson(`${base}/account-link/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-account-link-secret': 'shared' },
      body: JSON.stringify({ token: 'valid', account: { name: 'Alice' } })
    });
    assert.equal(failed.response.status, 400);
    assert.equal(JSON.stringify(failed.body).includes('database password'), false);
    assert.ok(errors.length >= 2);
  });
});

test('secretEquals matches only the exact shared secret', () => {
  assert.equal(secretEquals('shared', 'shared'), true);
  assert.equal(secretEquals('shared-but-longer', 'shared'), false);
  assert.equal(secretEquals('share', 'shared'), false);
  assert.equal(secretEquals('', 'shared'), false);
  assert.equal(secretEquals('shared', ''), false);
  assert.equal(secretEquals(undefined, undefined), false);
});

test('every secret-checked callback route rejects a wrong secret', async () => {
  const store = { cleanupExpiredAccountLinkSessions: async () => {}, getAccountLinkSession: () => null };
  await withServer({
    sharedSecret: 'shared', store, normalizeImportedAccountSnapshot: (value) => value,
    getPublicProfile: () => ({ player: { name: 'Alice' }, songs: [] }),
    getPublicJacket: () => ({ data: Buffer.from('jacket-bytes'), contentType: 'image/jpeg' })
  }, async (base) => {
    const wrong = { 'x-account-link-secret': 'shared-wrong' };
    const profile = await fetch(`${base}/public-profile/abcdefghijklmnopqrstuvwx`, { headers: wrong });
    assert.equal(profile.status, 401);
    const jacket = await fetch(`${base}/public-jacket/song%3A1234567890abcdef`, { headers: wrong });
    assert.equal(jacket.status, 401);
    const callback = await fetch(`${base}/account-link/callback`, {
      method: 'POST',
      headers: { ...wrong, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'abc' })
    });
    assert.equal(callback.status, 401);
  });
});
