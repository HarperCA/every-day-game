import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizeFavoriteBatch, requireFavoriteFlag, requireFavoriteId } = require('../apps/miniprogram/cloudfunctions/userData/favoriteValidation.js');

describe('favorite input validation', () => {
  it('normalizes a valid offline favorite batch before any writes', () => {
    expect(normalizeFavoriteBatch([{ editionId:' edition-1 ', createdAt:'2026-09-08T00:00:00Z' }])).toEqual([
      { editionId:'edition-1', createdAt:'2026-09-08T00:00:00.000Z' },
    ]);
  });

  it('rejects duplicate or malformed batch entries', () => {
    expect(() => normalizeFavoriteBatch([{ editionId:'edition-1' }, { editionId:'edition-1' }])).toThrow('duplicate_favorite_edition');
    expect(() => normalizeFavoriteBatch([null])).toThrow('invalid_favorite');
    expect(() => normalizeFavoriteBatch([{ editionId:'edition-1', createdAt:'not-a-date' }])).toThrow('invalid_created_at');
  });

  it('requires an actual boolean favorite flag and bounded ID', () => {
    expect(requireFavoriteFlag(false)).toBe(false);
    expect(() => requireFavoriteFlag('false')).toThrow('invalid_favorited');
    expect(() => requireFavoriteId('x'.repeat(201))).toThrow('edition_id_too_long');
  });
});
