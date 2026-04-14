import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 1024 * 1024;

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function createCallbackErrorCode() {
  return `CALLBACK-${randomBytes(4).toString('hex').toUpperCase()}`;
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
  prepareLinkedAuth,
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
        writeJson(response, 401, { ok: false, error: 'Unauthorized.', code: 'CALLBACK-UNAUTHORIZED' });
        return;
      }

      try {
        await store.cleanupExpiredAccountLinkSessions();

        const body = await readJsonBody(request);
        const token = String(body.token || '').trim();
        if (!token) {
          writeJson(response, 400, { ok: false, error: 'Invalid request.', code: 'CALLBACK-BAD-REQUEST' });
          return;
        }

        const session = store.getAccountLinkSession(token);
        if (!session) {
          writeJson(response, 404, { ok: false, error: 'Not found.', code: 'CALLBACK-NOT-FOUND' });
          return;
        }

        const expiresAt = Date.parse(session.expiresAt || '');
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          writeJson(response, 410, { ok: false, error: 'Expired.', code: 'CALLBACK-EXPIRED' });
          return;
        }

        if (session.status !== 'pending') {
          writeJson(response, 409, { ok: false, error: 'Conflict.', code: 'CALLBACK-CONFLICT' });
          return;
        }

        const payload = body.account || body.snapshot || body.data || body.profile;
        if (!payload || typeof payload !== 'object') {
          writeJson(response, 400, { ok: false, error: 'Invalid request.', code: 'CALLBACK-BAD-REQUEST' });
          return;
        }

        const provider = String(body.provider || 'manual').trim().toLowerCase() || 'manual';
        const normalizedAccount = normalizeImportedAccountSnapshot(payload, provider);
        const linkedAuth = prepareLinkedAuth ? prepareLinkedAuth(body.auth || null) : null;
        const storedAccount = await store.setAccount(session.userId, {
          ...normalizedAccount,
          linkMethod: 'web',
          linkedAuth
        });

        await store.completeAccountLinkSession(token, {
          completedAt: new Date().toISOString()
        });

        writeJson(response, 200, {
          ok: true,
          provider: storedAccount.provider
        });
      } catch (error) {
        const reference = createCallbackErrorCode();
        logger.error(`[${reference}] Account link callback error:`, error);
        writeJson(response, 400, {
          ok: false,
          error: 'Request failed.',
          code: reference
        });
      }

      return;
    }

    writeJson(response, 404, { ok: false, error: 'Not found.', code: 'CALLBACK-ROUTE-NOT-FOUND' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bind, resolve);
  });

  return server;
}
