import { Cursor } from './types';

/** Encode a composite cursor as an opaque base64url token. */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt}:${c.id}`, 'utf8').toString('base64url');
}

/** Decode an opaque cursor; returns undefined for missing/malformed input. */
export function decodeCursor(token?: string | null): Cursor | undefined {
  if (!token) return undefined;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const idx = raw.indexOf(':');
    if (idx < 0) return undefined;
    const createdAt = Number(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (!Number.isFinite(createdAt) || id.length === 0) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}
