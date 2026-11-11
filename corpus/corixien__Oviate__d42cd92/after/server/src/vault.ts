// API keys of a user, encrypted at rest (AES-256-GCM) with a key from the server environment, so a copy of the database alone does not reveal them.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export interface Vault { seal(userId: string, name: string, value: string): string; open(userId: string, name: string, sealed: string): string | null }

/** Keys the apps may store (the names of the desktop keyring entries). */
export const SECRET_NAMES = ['alpaca_key_id', 'alpaca_secret', 'finnhub_key', 'newsapi_key', 'groq_key', 'openrouter_key', 'fmp_key'];

export function makeVault(secret: string): Vault {
  const key = scryptSync(secret, 'oviate-secrets-v1', 32);
  return {
    seal(userId, name, value) {
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(`${userId}|${name}`)); // a sealed value cannot be moved to another user or key name
      const ct = Buffer.concat([c.update(value, 'utf8'), c.final()]);
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
    },
    open(userId, name, sealed) {
      try {
        const [v, iv, tag, ct] = sealed.split('.');
        if (v !== 'v1') return null;
        const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        d.setAAD(Buffer.from(`${userId}|${name}`)); d.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
      } catch { return null; } // another SECRETS_KEY or damaged data
    },
  };
}
