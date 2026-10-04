import { createHash, randomBytes } from 'node:crypto';

/** What the database stores for a code or a token: never the value itself. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** A fresh opaque secret (256 bits, URL-safe). */
export const randomSecret = (): string => randomBytes(32).toString('base64url');
