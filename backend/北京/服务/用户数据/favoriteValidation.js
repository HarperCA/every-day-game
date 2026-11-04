function requireFavoriteId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('invalid_edition_id');
  const editionId = value.trim();
  if (Array.from(editionId).length > 200) throw new Error('edition_id_too_long');
  return editionId;
}

function requireFavoriteFlag(value) {
  if (typeof value !== 'boolean') throw new Error('invalid_favorited');
  return value;
}

function requireIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_created_at');
  return date.toISOString();
}

function normalizeFavoriteBatch(records) {
  const ids = new Set();
  return records.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_favorite');
    const editionId = requireFavoriteId(item.editionId);
    if (ids.has(editionId)) throw new Error('duplicate_favorite_edition');
    ids.add(editionId);
    return { editionId, createdAt:requireIsoDate(item.createdAt || Date.now()) };
  });
}

module.exports = { normalizeFavoriteBatch, requireFavoriteFlag, requireFavoriteId };
