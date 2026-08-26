'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeTags(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，\n]/);
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean).map((item) => item.slice(0, 32)))].slice(0, 12);
}

function createCatalogStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let state = { schema: 't8-volc-asset-catalog-v1', assets: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.assets && typeof parsed.assets === 'object') state = parsed;
  } catch (_) {}

  function flush() {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  }

  return {
    tagsFor(assetId) {
      const item = state.assets[String(assetId || '')];
      return normalizeTags(item?.tags);
    },
    tagsForMany(assetIds) {
      const out = {};
      for (const assetId of Array.isArray(assetIds) ? assetIds : []) {
        const id = String(assetId || '').trim();
        if (id) out[id] = this.tagsFor(id);
      }
      return out;
    },
    setTags(assetId, tags) {
      const id = String(assetId || '').trim();
      if (!id) throw new Error('assetId 必填');
      state.assets[id] = { tags: normalizeTags(tags), updatedAt: new Date().toISOString() };
      flush();
      return state.assets[id].tags;
    },
  };
}

module.exports = { createCatalogStore, normalizeTags };
