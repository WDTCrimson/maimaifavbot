import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function deriveKey(secret) {
  return createHash('sha256').update(String(secret || ''), 'utf8').digest();
}

function normalizeIntlClalToken(value) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error('Missing International maimai auth token.');
  }

  const withoutPrefix = text.startsWith('clal=') ? text.slice(5) : text;
  if (!/^[A-Za-z0-9]{32,128}$/.test(withoutPrefix)) {
    throw new Error('Invalid International maimai auth token format.');
  }

  return withoutPrefix;
}

function encryptJson(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: encrypted.toString('base64url')
  };
}

function decryptJson(payload, secret) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Encrypted linked auth payload is invalid.');
  }

  const iv = Buffer.from(String(payload.iv || ''), 'base64url');
  const tag = Buffer.from(String(payload.tag || ''), 'base64url');
  const data = Buffer.from(String(payload.data || ''), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted);
}

export function prepareLinkedAuthForStorage(rawAuth, secret) {
  if (!rawAuth || typeof rawAuth !== 'object') {
    return null;
  }

  const region = String(rawAuth.region || '').trim().toLowerCase();
  const type = String(rawAuth.type || '').trim().toLowerCase();

  if (region !== 'intl' || type !== 'clal') {
    return null;
  }

  const token = normalizeIntlClalToken(rawAuth.token);
  const encrypted = encryptJson(
    {
      region: 'intl',
      type: 'clal',
      token
    },
    secret
  );

  return {
    region: 'intl',
    type: 'clal',
    encrypted,
    updatedAt: new Date().toISOString()
  };
}

export function restoreLinkedAuthFromStorage(storedAuth, secret) {
  if (!storedAuth || typeof storedAuth !== 'object') {
    return null;
  }

  const region = String(storedAuth.region || '').trim().toLowerCase();
  const type = String(storedAuth.type || '').trim().toLowerCase();
  if (region !== 'intl' || type !== 'clal') {
    return null;
  }

  const decrypted = decryptJson(storedAuth.encrypted, secret);
  return {
    region: 'intl',
    type: 'clal',
    token: normalizeIntlClalToken(decrypted.token)
  };
}
