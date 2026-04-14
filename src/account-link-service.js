import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 1024 * 1024;

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error(`Request body exceeded ${maxBytes} bytes.`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

export function createAccountLinkToken() {
  return randomBytes(24).toString('base64url');
}

function buildSigningPayload({ token, expiresAt }) {
  return `${token}:${expiresAt}`;
}

export function createAccountLinkSignature({ token, expiresAt, signingSecret }) {
  return createHmac('sha256', signingSecret)
    .update(buildSigningPayload({ token, expiresAt }))
    .digest('base64url');
}

export function verifyAccountLinkSignature({ token, expiresAt, signature, signingSecret }) {
  const expected = createAccountLinkSignature({ token, expiresAt, signingSecret });
  const actualBuffer = Buffer.from(String(signature || ''), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function buildAccountLinkUrl({ baseUrl, token, expiresAt, signature }) {
  const url = new URL(baseUrl);
  url.searchParams.set('token', token);
  url.searchParams.set('expires_at', expiresAt);
  url.searchParams.set('sig', signature);
  return url.toString();
}

export function accountLinkCallbackServerEnabled(config) {
  return Boolean(config.accountLinkCallbackPort && config.accountLinkSharedSecret);
}

export async function startAccountLinkCallbackServer({
  bind,
  port,
  sharedSecret,
  store,
  normalizeImportedAccountSnapshot,
  logger = console
}) {
  const server = createServer(async (request, response) => {
    const method = String(request.method || 'GET').toUpperCase();
    const url = new URL(request.url || '/', 'http://localhost');

    if (method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, { ok: true, service: 'account-link-callback' });
      return;
    }

    if (method === 'POST' && url.pathname === '/account-link/callback') {
      const providedSecret = String(request.headers['x-account-link-secret'] || '').trim();
      if (!providedSecret || providedSecret !== sharedSecret) {
        writeJson(response, 401, { ok: false, error: 'Unauthorized callback secret.' });
        return;
      }

      try {
        await store.cleanupExpiredAccountLinkSessions();

        const body = await readJsonBody(request);
        const token = String(body.token || '').trim();
        if (!token) {
          writeJson(response, 400, { ok: false, error: 'Missing token.' });
          return;
        }

        const session = store.getAccountLinkSession(token);
        if (!session) {
          writeJson(response, 404, { ok: false, error: 'Link session not found.' });
          return;
        }

        const expiresAt = Date.parse(session.expiresAt || '');
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          writeJson(response, 410, { ok: false, error: 'Link session expired.' });
          return;
        }

        if (session.status !== 'pending') {
          writeJson(response, 409, { ok: false, error: 'Link session is not pending.' });
          return;
        }

        const payload = body.account || body.snapshot || body.data || body.profile;
        if (!payload || typeof payload !== 'object') {
          writeJson(response, 400, { ok: false, error: 'Missing account payload object.' });
          return;
        }

        const provider = String(body.provider || 'manual').trim().toLowerCase() || 'manual';
        const normalizedAccount = normalizeImportedAccountSnapshot(payload, provider);
        const storedAccount = await store.setAccount(session.userId, {
          ...normalizedAccount,
          linkMethod: 'web',
          linkSession: {
            reference: `${session.token.slice(0, 4)}...${session.token.slice(-4)}`,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            completedAt: new Date().toISOString()
          }
        });

        await store.completeAccountLinkSession(token, {
          completedAt: new Date().toISOString(),
          provider: storedAccount.provider,
          playerName: storedAccount.player?.name || null,
          accountUpdatedAt: storedAccount.updatedAt
        });

        writeJson(response, 200, {
          ok: true,
          provider: storedAccount.provider,
          playerName: storedAccount.player?.name || null
        });
      } catch (error) {
        logger.error('Account link callback error:', error);
        writeJson(response, 400, {
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown callback error.'
        });
      }

      return;
    }

    writeJson(response, 404, { ok: false, error: 'Not found.' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bind, resolve);
  });

  return server;
}
