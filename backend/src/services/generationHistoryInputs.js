'use strict';

const crypto = require('node:crypto');
const { isRunSecretKey, redactInlineSecrets } = require('./runRedaction');
const { redactLocalPaths } = require('./assetPublicView');
const settingsContract = require('../shared/generationHistoryInputContract.json');
const { captureReferenceManifest, validManifest } = require('./generationHistoryReferences');
const SCHEMA = 't8-generation-input-archive-v1';
const INPUT_SCHEMA = 't8-run-node-input-v1';
const SOURCES = new Set(['node-output', 'host-node-output']);
const MAX_BYTES = 512 * 1024;
const PRIVATE_INPUT_KEY = '__generationHistoryInput';
const PRIVATE_REFERENCES_KEY = '__generationHistoryReferences';
const privateKeyPattern = new RegExp(settingsContract.privateKeyPattern, 'i');
const tokenCountPattern = new RegExp(settingsContract.safeTokenCountPattern, 'i');
function historySecretKey(key) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return isRunSecretKey(key) || (!tokenCountPattern.test(normalized) && privateKeyPattern.test(normalized));
}
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const unavailable = reason => ({ schema: SCHEMA, status: 'unavailable', reason });
const digest = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
function parse(value) { try { return JSON.parse(value); } catch { return {}; } }

// A separate settings-only contract permits complete long prompts without
// granting replay/execution authority or changing the shared log redactor.
function safeJson(value, depth = 0, seen = new WeakSet(), budget = { remaining: MAX_BYTES }, maxStringChars = 4000, field = '') {
  budget.remaining -= 8;
  if (depth > 7 || budget.remaining < 0) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    budget.remaining -= Buffer.byteLength(value);
    if (budget.remaining < 0) return false;
    // Material identities embed a URL after a typed prefix. Validate the URL
    // separately only in these fields; never exempt arbitrary prompt/path text.
    const material = (['materialOrder', 'excludedMaterialIds', 'materialKey'].includes(field)
      ? value.match(/^[A-Za-z0-9_-]+::(?:[A-Za-z0-9_-]+:)?(?:image|video|audio):((?:https?:\/\/|\/(?:api|files|input|output)\/).+)$/) : null
    ) || (field === 'materialKey' ? value.match(/^(?:image|video|audio):((?:https?:\/\/|\/(?:api|files|input|output)\/).+)$/) : null);
    const pathValue = material ? material[1] : value;
    if (value.length > maxStringChars || /\[redacted|%5bredacted%5d|base64 omitted|max depth|\[circular\]|^data:|^blob:|^file:|^[a-z]:[\\/]|^\\\\/i.test(value)
      || redactInlineSecrets(value) !== value
      || redactLocalPaths(pathValue, { preservePublicUrl: /^(https?:\/\/|\/(api|files|input|output)\/)/i.test(pathValue) }) !== pathValue
      || /^bearer\s/i.test(value)) return false;
    try {
      const url = new URL(pathValue, 'http://t8-history.invalid');
      if (url.username || url.password || [...url.searchParams.keys()].some(key => isRunSecretKey(key)
        || /(?:signature|credential|token|secret)/i.test(key) || /^(sig|expires|key)$/i.test(key))) return false;
    } catch { /* ordinary prompt */ }
    return true;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (Array.isArray(value) && value.length > 100) return false;
  if (!Array.isArray(value) && !plain(value)) return false;
  seen.add(value);
  const entries = Object.entries(value);
  const ok = entries.length <= (Array.isArray(value) ? 100 : 200)
    && entries.every(([key, item]) => {
      budget.remaining -= Buffer.byteLength(key);
      const captureMetadata = depth === 0 && value.schema === settingsContract.schema
        && key === 'credentialsOmitted' && typeof item === 'boolean';
      return (captureMetadata || !historySecretKey(key)) && !['__proto__', 'constructor', 'prototype'].includes(key)
        && safeJson(item, depth + 1, seen, budget, maxStringChars, Array.isArray(value) ? field : key);
    });
  seen.delete(value);
  return ok;
}
function completeSnapshot(snapshot, expectedNodeId) {
  const settingsOnly = snapshot?.schema === settingsContract.schema;
  if (!plain(snapshot) || (settingsOnly
    ? snapshot.purpose !== settingsContract.purpose || snapshot.complete !== true || typeof snapshot.credentialsOmitted !== 'boolean'
    : snapshot.schema !== INPUT_SCHEMA || snapshot.replayable !== true)
    || !Array.isArray(snapshot.upstreamNodes) || !Array.isArray(snapshot.incomingEdges)
    || snapshot.upstreamNodes.length >= 80 || snapshot.incomingEdges.length > 90) return false;
  const nodes = [snapshot.node, ...snapshot.upstreamNodes];
  if (nodes.some(node => !plain(node) || typeof node.id !== 'string' || !node.id || typeof node.type !== 'string' || !node.type
    || !plain(node.data) || !plain(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) return false;
  if (snapshot.node.id !== expectedNodeId) return false;
  const ids = new Set(nodes.map(node => node.id));
  if (ids.size !== nodes.length || snapshot.incomingEdges.some(edge => !plain(edge) || typeof edge.id !== 'string'
    || !ids.has(edge.source) || !ids.has(edge.target))) return false;
  if (!safeJson(snapshot, 0, new WeakSet(), { remaining: MAX_BYTES }, settingsOnly ? settingsContract.maxStringChars : 4000)) return false;
  return Buffer.byteLength(JSON.stringify(snapshot)) <= MAX_BYTES;
}
function runInputWithoutHistory(value) {
  const result = plain(value) ? { ...value } : {};
  delete result[PRIVATE_INPUT_KEY];
  delete result[PRIVATE_REFERENCES_KEY];
  return result;
}
function storedRunInput(legacy, history, expectedNodeId, context) {
  const result = runInputWithoutHistory(legacy);
  if (history !== undefined) result[PRIVATE_INPUT_KEY] = history?.schema === settingsContract.schema && completeSnapshot(history, expectedNodeId)
    ? JSON.parse(JSON.stringify(history))
    : { schema: settingsContract.schema, purpose: settingsContract.purpose, complete: false, reason: 'input-incomplete-or-unsafe' };
  const snapshot = history === undefined ? result : result[PRIVATE_INPUT_KEY];
  if (context?.database && context.projectId && completeSnapshot(snapshot, expectedNodeId)) {
    result[PRIVATE_REFERENCES_KEY] = captureReferenceManifest(context.database, context.projectId, snapshot);
  }
  return result;
}
function bindingFor(run, nodeRun, attempt) {
  return { projectId: run.projectId, canvasId: run.canvasId, runEntityUid: run.entityUid,
    nodeRunEntityUid: nodeRun.entityUid, attemptEntityUid: attempt?.entityUid || null,
    nodeId: nodeRun.originalNodeId || nodeRun.nodeId, nodeEntityUid: nodeRun.nodeEntityUid || null };
}
function archiveInput(run, nodeRun, attempt) {
  const snapshot = nodeRun.historyInputSnapshot === undefined ? nodeRun.inputSnapshot : nodeRun.historyInputSnapshot;
  if (!completeSnapshot(snapshot, nodeRun.originalNodeId || nodeRun.nodeId)) return unavailable('input-incomplete-or-unsafe');
  const references = nodeRun.historyReferenceManifest;
  if (references !== undefined && (!validManifest(references, snapshot) || !safeJson(references))) return unavailable('input-incomplete-or-unsafe');
  const payload = { binding: bindingFor(run, nodeRun, attempt), snapshot, ...(references === undefined ? {} : { references }) };
  return { schema: SCHEMA, status: 'available', ...JSON.parse(JSON.stringify(payload)), digest: digest(payload) };
}

// Called only inside the existing lineage writer transaction. Store once per
// generation; subsequent outputs/parent edges reference that immutable event.
// The permanent lineage ledger survives Run retention and asset tombstones.
function generationInputMetadata(database, { run, nodeRun, attempt, sourceType, metadata }) {
  const result = { ...metadata };
  delete result.generationInput; delete result.generationInputRef;
  if (!SOURCES.has(sourceType) || !run || !nodeRun || attempt?.metadata?.reusedResult === true) return result;
  const prior = database.db.prepare(`SELECT id FROM asset_lineage_events
    WHERE run_id = ? AND node_run_id = ? AND attempt_id IS ?
      AND project_id = ? AND run_entity_uid = ? AND node_run_entity_uid = ? AND attempt_entity_uid IS ?
      AND source_type IN ('node-output', 'host-node-output')
      AND json_type(metadata_json, '$.generationInput') = 'object'
    ORDER BY created_at, id LIMIT 1`).get(run.id, nodeRun.id, attempt?.id || null,
      run.projectId, run.entityUid, nodeRun.entityUid, attempt?.entityUid || null);
  if (prior) result.generationInputRef = prior.id;
  else {
    const stored = database.db.prepare('SELECT input_json FROM node_runs WHERE id = ? AND entity_uid = ?').get(nodeRun.id, nodeRun.entityUid);
    const input = parse(stored?.input_json);
    result.generationInput = archiveInput(run, { ...nodeRun, historyInputSnapshot: input[PRIVATE_INPUT_KEY], historyReferenceManifest: input[PRIVATE_REFERENCES_KEY] }, attempt);
  }
  return result;
}
function generationReferenceAssets(database, run, nodeRun) {
  const row = database.db.prepare('SELECT input_json FROM node_runs WHERE id = ? AND entity_uid = ?').get(nodeRun.id, nodeRun.entityUid);
  const input = parse(row?.input_json);
  const references = input[PRIVATE_REFERENCES_KEY];
  if (references === undefined) return null; // Legacy records retain their existing lineage path.
  const snapshot = input[PRIVATE_INPUT_KEY] === undefined ? runInputWithoutHistory(input) : input[PRIVATE_INPUT_KEY];
  if (!validManifest(references, snapshot) || references.status !== 'captured') return [];
  const assets = new Map();
  for (const entry of references.entries) {
    if (entry.status !== 'bound' || assets.has(entry.assetId)) continue;
    const asset = database.getAssetByEntityUid(entry.entityUid, run.projectId);
    if (asset?.id === entry.assetId && asset.contentHash === entry.contentHash) assets.set(asset.id, asset);
  }
  return [...assets.values()];
}
function readGenerationHistoryInput(database, event) {
  let metadata = parse(event.metadata_json);
  if (metadata.generationInputRef) {
    if (typeof metadata.generationInputRef !== 'string') return unavailable('archive-invalid');
    const target = database.db.prepare(`SELECT * FROM asset_lineage_events WHERE id = ? AND project_id = ?
      AND canvas_id = ? AND run_entity_uid IS ? AND node_run_entity_uid IS ? AND attempt_entity_uid IS ?`).get(
      metadata.generationInputRef, event.project_id, event.canvas_id, event.run_entity_uid, event.node_run_entity_uid, event.attempt_entity_uid);
    if (!target || !SOURCES.has(target.source_type)) return unavailable('archive-invalid');
    metadata = parse(target.metadata_json);
  }
  const archive = metadata.generationInput;
  if (!archive) return unavailable('input-not-archived');
  if (archive.schema !== SCHEMA) return unavailable('archive-invalid');
  if (archive.status !== 'available') return unavailable('input-incomplete-or-unsafe');
  const binding = archive.binding;
  if (!binding || binding.projectId !== event.project_id || binding.canvasId !== event.canvas_id
    || binding.runEntityUid !== event.run_entity_uid || binding.nodeRunEntityUid !== event.node_run_entity_uid
    || binding.attemptEntityUid !== event.attempt_entity_uid || binding.nodeEntityUid !== event.source_node_entity_uid
    || binding.nodeId !== event.source_node_id || !completeSnapshot(archive.snapshot, binding.nodeId)
    || (archive.references !== undefined && (!validManifest(archive.references, archive.snapshot) || !safeJson(archive.references)))
    || archive.digest !== digest({ binding, snapshot: archive.snapshot, ...(archive.references === undefined ? {} : { references: archive.references }) })) return unavailable('archive-invalid');
  return archive;
}
function resolvedHistoryPrompt(snapshot) {
  const input = snapshot?.node?.data?.historyResolvedInput;
  if (!input || typeof input.prompt !== 'string') return null;
  if (snapshot.node.type === 'code-animation' && input.schema === 't8-motion-video-input-v1') return input.prompt;
  if (input.schema === settingsContract.seedanceResolvedInputSchema && input.origin === 'frontend-request') return input.prompt;
  if (snapshot.node.type === 'image' && [settingsContract.imageInputContextSchema, settingsContract.imageSettingsContextSchema].includes(input.schema)
    && input.origin === 'frontend-common-context' && Array.isArray(input.referenceImages)
    && input.referenceImages.every(value => typeof value === 'string')) return input.prompt;
  return null;
}
module.exports = { generationInputMetadata, generationReferenceAssets, readGenerationHistoryInput, archiveInput, completeSnapshot, storedRunInput, runInputWithoutHistory, resolvedHistoryPrompt };
