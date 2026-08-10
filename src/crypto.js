// AES-256-GCM helpers for encrypting sensitive values at rest (currently:
// target-site auth passwords stored in scans.input JSONB — see jobStore.js).
//
// Key comes from CREDENTIALS_ENCRYPTION_KEY (32-byte hex string, same style
// as SESSION_SECRET) — generate with: openssl rand -hex 32

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is not set — required to store target-site auth credentials. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex string (64 hex characters)');
  }
  return key;
}

// Returns a self-describing ciphertext object — safe to JSON.stringify and
// store directly in a JSONB column.
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    enc: true,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    value: ciphertext.toString('base64'),
  };
}

function decrypt(encrypted) {
  if (!encrypted || !encrypted.enc) return null;
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.value, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
