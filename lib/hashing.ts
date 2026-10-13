/**
 * Brief canonicalisation and hashing.
 *
 * A brief's hash is what ties an accepted scope to a payment attempt, so the
 * canonical form has to be stable across whitespace noise and invisible
 * characters that arrive from pasted documents.
 */
import { createHash } from 'node:crypto';

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

export function canonicaliseBrief(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashBrief(raw: string): { canonicalText: string; textHash: string } {
  const canonicalText = canonicaliseBrief(raw);
  return { canonicalText, textHash: sha256Hex(canonicalText) };
}
