'use strict';

const { redactLocalPaths } = require('./assetPublicView');
const { isUuid } = require('../collaboration/protocol');
const { readGenerationHistoryInput, resolvedHistoryPrompt } = require('./generationHistoryInputs');
const { listReferenceRecoveries } = require('./generationHistoryReferenceRecovery');

const KINDS = ['image', 'video', 'audio', 'text', 'model3d', 'other'];
const SCHEMA = 't8-generation-history-v1';
function invalid(message, status = 400) {
  const error = new Error(message);
  error.code = status === 404 ? 'GENERATION_HISTORY_NOT_FOUND' : 'GENERATION_HISTORY_INVALID';
  error.status = status;
  throw error;
}
function identifier(value, required = false) {
  if (value == null || value === '') {
    if (required) invalid('缺少历史记录所属项目或画布');
    return null;
  }
  if (typeof value !== 'string' || value.length > 240 || /[\u0000-\u001f]/u.test(value)) invalid('历史记录查询范围无效');
  return value;
}
function integer(value, fallback, maximum) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) invalid('历史记录分页参数无效');
  return parsed;
}
function safeText(value, maximum = 240) {
  return redactLocalPaths(String(value || '')).slice(0, maximum);
}
function jsonObject(value) {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
}

// This is a read projection of the existing immutable lineage and output-slot
// ledgers. It neither records a second history nor enumerates local folders.
// Stable runtime UIDs distinguish generations even when a display ID or a
// deduplicated asset is reused. Lineage survives normal Run retention.
function listGenerationHistory(database, input = {}) {
  const projectId = identifier(input.projectId, true);
  const canvasId = identifier(input.canvasId, true);
  const nodeId = identifier(input.nodeId);
  const requestedNodeUid = identifier(input.nodeEntityUid);
  if (requestedNodeUid && (!nodeId || !isUuid(requestedNodeUid))) invalid('历史来源节点身份无效');
  const kind = input.kind || 'all';
  if (kind !== 'all' && !KINDS.includes(kind)) invalid('历史记录素材分类无效');
  const groupId = identifier(input.groupId);
  const includeInput = input.includeInput === true || input.includeInput === 'true' || input.includeInput === '1';
  if (includeInput && !groupId) invalid('请选择单次生成记录以查看原设置');
  const limit = Math.max(1, integer(input.limit, 24, 48));
  const outputOffset = integer(input.outputOffset, 0, 1_000_000);
  if (outputOffset && !groupId) invalid('请指定要展开的生成记录');
  let before = null;
  if (input.cursor != null) {
    if (typeof input.cursor !== 'string' || input.cursor.length > 2048 || groupId) invalid('历史记录游标无效');
    try { before = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')); }
    catch { invalid('历史记录游标无效'); }
    if (!before || before.v !== 1
      || !Number.isSafeInteger(before.time) || before.time < 0
      || typeof before.id !== 'string' || before.id.length > 240) invalid('历史记录游标与查询范围不一致');
  }
  const query = () => {
    const canvas = database.getCanvas(canvasId);
    if (!canvas || canvas.projectId !== projectId) invalid('画布不存在或不属于当前项目', 404);
    // Compatibility callers may supply only a display ID. Resolve it against
    // this exact read snapshot, never against all past incarnations of that ID.
    const currentNode = nodeId ? (canvas.nodes || []).find(node => node.id === nodeId) : null;
    const nodeEntityUid = requestedNodeUid?.toLowerCase()
      || (nodeId && isUuid(currentNode?.entityUid) ? currentNode.entityUid.toLowerCase() : null);
    const scope = { projectId, canvasId, nodeId, nodeEntityUid, kind };
    if (before && JSON.stringify(before.scope) !== JSON.stringify(scope)) invalid('历史记录游标与查询范围不一致');
    const values = [projectId, canvasId];
    const clauses = ['e.project_id = ?', 'e.canvas_id = ?', "e.source_type IN ('node-output', 'host-node-output', 'recovered-output')",
      // Only explicit immutable evidence excludes reuse. Neither equal bytes nor
      // an ephemeral Attempt join can distinguish generations after retention.
      "COALESCE(json_type(e.metadata_json, '$.reusedResult'), '') <> 'true'"];
    if (nodeId) {
      clauses.push('e.source_node_id = ?', 'e.source_node_entity_uid = ?');
      values.push(nodeId, nodeEntityUid);
    }
    const cte = `WITH candidates AS (
      SELECT e.id, e.asset_id, e.created_at, e.source_type,
        COALESCE('attempt:' || e.attempt_entity_uid, 'node:' || e.node_run_entity_uid,
          'legacy-attempt:' || e.attempt_id, 'legacy-node:' || e.node_run_id, 'event:' || e.id) AS group_id,
        COALESCE(e.output_ordinal, json_extract(e.metadata_json, '$.outputOrdinal'),
          json_extract(e.metadata_json, '$.outputIndex'), 0) AS ordinal,
        a.kind, a.filename, a.availability, a.content_hash AS current_hash,
        COALESCE(s.content_hash, CASE WHEN e.source_type = 'recovered-output' THEN json_extract(e.metadata_json, '$.contentHash') END) AS recorded_hash, s.reservation_state
      FROM asset_lineage_events e
      JOIN assets a ON a.id = e.asset_id AND a.project_id = e.project_id
        AND (e.asset_entity_uid IS NULL OR a.entity_uid = e.asset_entity_uid)
      LEFT JOIN run_output_slot_reservations s
        ON s.project_id = e.project_id AND s.canvas_id = e.canvas_id
        AND s.attempt_entity_uid = e.attempt_entity_uid AND s.output_ordinal = e.output_ordinal
        AND s.asset_id = e.asset_id AND s.asset_entity_uid = e.asset_entity_uid
      WHERE ${clauses.join(' AND ')}
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY group_id, asset_id, ordinal ORDER BY created_at ASC, id ASC
      ) AS duplicate_rank FROM candidates
    ), outputs AS (SELECT * FROM ranked WHERE duplicate_rank = 1),
    groups AS (SELECT group_id, MIN(created_at) AS first_at, COUNT(*) AS output_count FROM outputs
      ${kind === 'all' ? '' : 'WHERE kind = ?'} GROUP BY group_id)`;
    const scopedValues = kind === 'all' ? values : [...values, kind];
    const counts = Object.fromEntries(['all', ...KINDS].map(value => [value, 0]));
    for (const row of database.db.prepare(`${cte} SELECT kind, COUNT(DISTINCT group_id) AS count FROM outputs GROUP BY kind`).all(...scopedValues)) {
      if (KINDS.includes(row.kind)) counts[row.kind] = Number(row.count);
    }
    counts.all = Number(database.db.prepare(`${cte} SELECT COUNT(DISTINCT group_id) AS count FROM outputs`).get(...scopedValues).count);
    const total = kind === 'all' ? counts.all : counts[kind];
    let rows;
    if (groupId) {
      rows = database.db.prepare(`${cte} SELECT * FROM groups WHERE group_id = ?`).all(...scopedValues, groupId);
      if (!rows.length) invalid('这条生成记录不存在或不属于当前范围', 404);
    } else {
      rows = database.db.prepare(`${cte} SELECT * FROM groups
        ${before ? 'WHERE first_at < ? OR (first_at = ? AND group_id < ?)' : ''}
        ORDER BY first_at DESC, group_id DESC LIMIT ?`).all(...scopedValues,
        ...(before ? [before.time, before.time, before.id] : []), limit + 1);
    }
    const hasMore = !groupId && rows.length > limit;
    const page = rows.slice(0, groupId ? 1 : limit);
    // Read this bounded page in bulk. Do not carry full private input archives
    // through every counting/window pass or repeat the projection per card.
    const pageSize = groupId ? 24 : 4;
    const pageIds = page.map(row => row.group_id);
    const entriesByGroup = new Map(), firstByGroup = new Map();
    if (pageIds.length) {
      const selected = pageIds.map(() => '?').join(',');
      const entries = database.db.prepare(`${cte}, page_outputs AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY ordinal ASC, created_at ASC, id ASC) AS page_rank
        FROM outputs WHERE group_id IN (${selected}) ${kind === 'all' ? '' : 'AND kind = ?'}
      ) SELECT * FROM page_outputs WHERE page_rank > ? AND page_rank <= ? ORDER BY group_id, page_rank`)
        .all(...scopedValues, ...pageIds, ...(kind === 'all' ? [] : [kind]), outputOffset, outputOffset + pageSize);
      for (const entry of entries) {
        if (!entriesByGroup.has(entry.group_id)) entriesByGroup.set(entry.group_id, []);
        entriesByGroup.get(entry.group_id).push(entry);
      }
      // Earliest provenance is independent of a displayed kind or output page.
      // Fetch full immutable metadata only for these at most 48 source events.
      const firsts = database.db.prepare(`${cte}, page_first AS (
        SELECT id, group_id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY created_at ASC, id ASC) AS first_rank
        FROM outputs WHERE group_id IN (${selected})
      ) SELECT e.*, f.group_id FROM page_first f JOIN asset_lineage_events e ON e.id = f.id WHERE f.first_rank = 1`)
        .all(...scopedValues, ...pageIds);
      for (const first of firsts) firstByGroup.set(first.group_id, first);
    }
    const groups = page.map(row => {
      const entries = entriesByGroup.get(row.group_id) || [];
      // Metadata comes from this generation's immutable lineage, never from
      // the asset's mutable "last provenance" or today's edited canvas node.
      const first = firstByGroup.get(row.group_id);
      const metadata = jsonObject(first.metadata_json);
      const historyInput = readGenerationHistoryInput(database, first);
      const snapshotAvailable = historyInput.status === 'available';
      const resolvedPrompt = resolvedHistoryPrompt(historyInput.snapshot);
      return {
        id: row.group_id, createdAt: Number(row.first_at), recovered: first.source_type === 'recovered-output', nodeId: first.source_node_id || null,
        nodeEntityUid: first.source_node_entity_uid || null,
        nodeType: safeText(historyInput.snapshot?.node?.type || first.source_node_type, 120),
        sourceNodeExists: Boolean(first.source_node_entity_uid && (canvas.nodes || []).some(node => node.id === first.source_node_id
          && node.entityUid === first.source_node_entity_uid)),
        provider: safeText(metadata.provider) || null, model: safeText(metadata.model) || null,
        promptPreview: safeText(resolvedPrompt ?? (first.prompt_summary || historyInput.snapshot?.node?.data?.prompt), 280),
        snapshotAvailable, snapshotUnavailableReason: snapshotAvailable ? null : historyInput.reason,
        ...(includeInput ? { inputArchive: historyInput, referenceRecoveries: listReferenceRecoveries(database, historyInput) } : {}),
        outputCount: Number(row.output_count), outputOffset,
        hasMoreOutputs: outputOffset + entries.length < Number(row.output_count),
        outputs: entries.map(entry => {
          const changed = entry.recorded_hash && entry.recorded_hash !== entry.current_hash;
          const available = entry.availability === 'available' && !changed;
          return {
            assetId: entry.asset_id, kind: entry.kind, title: safeText(entry.filename),
            contentHash: entry.recorded_hash || entry.current_hash || null,
            outputOrdinal: Number(entry.ordinal),
            availability: changed ? 'changed' : entry.availability,
            mediaUrl: available ? `/api/project-assets/${encodeURIComponent(entry.asset_id)}/media` : null,
            evidence: entry.source_type === 'recovered-output' ? 'local-recovery' : entry.reservation_state === 'host-verified' ? 'host-recorded' : 'legacy-record',
          };
        }),
      };
    });
    const last = page.at(-1);
    return { schema: SCHEMA, scope, groups, total, counts,
      nextCursor: hasMore ? Buffer.from(JSON.stringify({ v: 1, scope, time: Number(last.first_at), id: last.group_id })).toString('base64url') : null,
    };
  };
  return database.withProjectDatabaseReadSnapshot('generation-history.list', query);
}

module.exports = { listGenerationHistory, GENERATION_HISTORY_SCHEMA: SCHEMA };
