'use strict';
const PROFILE = 'desktop-local';
function error(code, message, status = 409) { return Object.assign(new Error(message), { code, status, statusCode: status }); }
function entry(row) {
  return row ? { id: row.canvas_id, projectId: row.project_id, name: row.name, nodeCount: row.node_count,
    revision: row.content_revision, createdAt: row.created_at, updatedAt: row.updated_at,
    status: row.status, archivedAt: row.archived_at, catalogRevision: row.catalog_revision,
    pinned: Boolean(row.pinned), openedAt: Number(row.opened_at || 0) } : null;
}
function get(database, canvasId) {
  return entry(database.prepare(`SELECT c.*,p.pinned,p.opened_at FROM canvas_directory c
    LEFT JOIN canvas_directory_profile p ON p.canvas_id=c.canvas_id AND p.profile_id=? WHERE c.canvas_id=?`).get(PROFILE, String(canvasId)));
}
function writable(database, canvasId) {
  if (get(database, canvasId)?.status === 'archived') throw error('canvas_archived_read_only', '画布已归档；请先恢复后再编辑或运行');
}
function page(database, projectId, options = {}) {
  const limit = options.limit == null ? 50 : Number(options.limit);
  const status = options.status || 'active', sort = options.sort || 'updated';
  const query = String(options.query || '').trim().toLocaleLowerCase();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !['active','archived'].includes(status)
    || !['updated','opened'].includes(sort) || query.length > 240 || /[\x00-\x1f]/.test(query)) throw error('canvas_list_query_invalid', '画布目录查询无效', 400);
  const scope = JSON.stringify([1, projectId, status, sort, query]);
  let cursor;
  if (options.cursor) {
    try {
      if (typeof options.cursor !== 'string' || options.cursor.length > 4096) throw new Error();
      cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
      if (cursor.scope !== scope || ![0,1].includes(cursor.pin) || !Number.isSafeInteger(cursor.score) || cursor.score < 0
        || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 240) throw new Error();
    } catch { throw error('canvas_list_cursor_invalid', '目录筛选已变化或游标无效，请重新加载', 400); }
  }
  const score = sort === 'opened' ? 'COALESCE(p.opened_at,0)' : 'c.updated_at';
  const pin = 'COALESCE(p.pinned,0)';
  const clauses = ['c.project_id=?','c.status=?'];
  const parameters = [String(projectId), status];
  if (query) { clauses.push('(instr(lower(c.name),?)>0 OR instr(lower(c.canvas_id),?)>0)'); parameters.push(query, query); }
  const where = clauses.join(' AND ');
  const count = database.prepare(`SELECT COUNT(*) AS count FROM canvas_directory c WHERE ${where}`).get(...parameters).count;
  if (cursor) {
    clauses.push(`(${pin} < ? OR (${pin} = ? AND (${score} < ? OR (${score} = ? AND c.canvas_id > ?))))`);
    parameters.push(cursor.pin, cursor.pin, cursor.score, cursor.score, cursor.id);
  }
  const rows = database.prepare(`SELECT c.*,p.pinned,p.opened_at FROM canvas_directory c
    LEFT JOIN canvas_directory_profile p ON p.canvas_id=c.canvas_id AND p.profile_id=?
    WHERE ${clauses.join(' AND ')} ORDER BY ${pin} DESC,${score} DESC,c.canvas_id ASC LIMIT ?`).all(PROFILE, ...parameters, limit + 1);
  const hasMore = rows.length > limit, selected = rows.slice(0, limit);
  const last = selected[selected.length - 1];
  const counts = database.prepare("SELECT status,COUNT(*) AS count FROM canvas_directory WHERE project_id=? GROUP BY status").all(String(projectId));
  return { items: selected.map(entry), total: Number(count), hasMore,
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ scope, pin: Number(last.pinned || 0), score: sort === 'opened' ? Number(last.opened_at || 0) : last.updated_at, id: last.canvas_id })).toString('base64url') : null,
    counts: { active: counts.find((row) => row.status === 'active')?.count || 0, archived: counts.find((row) => row.status === 'archived')?.count || 0 } };
}
module.exports = { get, page, writable, error };
