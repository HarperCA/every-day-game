const INITIAL_TIME = '1970-01-01T00:00:00.000Z';

function normalizeCursor(value, since = INITIAL_TIME) {
  const cursor = value || { at: since, id: '' };
  const at = String(cursor.at || '');
  const id = String(cursor.id || '');
  if (!Number.isFinite(Date.parse(at)) || at !== new Date(at).toISOString() || id.length > 200) throw new Error('invalid_log_cursor');
  return { at, id };
}

// Use two ordered queries instead of timestamp-only >=; equal-timestamp pages cannot stall.
async function pullIssuePage(db, params, missingCollection) {
  const cursor = normalizeCursor(params.cursor, params.since);
  const limit = Math.min(500, Math.max(1, Math.floor(Number(params.limit) || 200)));
  const command = db.command;
  const read = async where => db.collection('client_issues').where(where)
    .orderBy('received_at', 'asc').orderBy('_id', 'asc').limit(limit + 1).get()
    .then(result => result.data || []).catch(error => {
      if (missingCollection(error)) return [];
      throw error;
    });
  const same = cursor.id ? await read({ received_at: cursor.at, _id: command.gt(cursor.id) }) : [];
  const later = same.length > limit ? [] : await read({ received_at: cursor.id ? command.gt(cursor.at) : command.gte(cursor.at) });
  const candidates = [...same, ...later];
  const issues = candidates.slice(0, limit);
  const last = issues.at(-1);
  return { issues, hasMore: candidates.length > limit,
    nextCursor: last ? { at: last.received_at, id: last._id } : cursor, cursorVersion: 2 };
}

module.exports = { normalizeCursor, pullIssuePage };
