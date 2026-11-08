import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeMediaNodeDefaults, resolveNewMediaNodeData, MEDIA_NODE_DEFAULT_FIELDS, type MediaNodeDefaultSource } from '../src/utils/mediaNodeDefaults.ts';
import { videoModelsForSource, videoModelOptionsForSource } from '../src/providers/models.ts';
const require = createRequire(import.meta.url);
const backend = require('../backend/src/utils/mediaNodeDefaults.js');
const sources: MediaNodeDefaultSource[] = ['product-default', 'zhenzhen', 'seedance-nz'];

for (const imageSource of sources) for (const videoSource of sources) {
  test(`shared defaults agree for ${imageSource}/${videoSource}`, () => {
    const prefs = { version: 1, imageSource, videoSource };
    assert.deepEqual(normalizeMediaNodeDefaults(prefs), backend.normalizeMediaNodeDefaults(prefs));
    for (const type of ['image', 'edit', 'video']) {
      const base = { prompt: 'keep', referenceImages: ['asset'], reuseResult: false };
      const data = resolveNewMediaNodeData(type, base, {}, prefs);
      assert.deepEqual(data, backend.resolveNewMediaNodeData(type, base, {}, prefs));
      assert.equal(data.prompt, 'keep');
      assert.deepEqual(data.referenceImages, ['asset']);
      const source = (type === 'video' ? videoSource : imageSource) === 'zhenzhen' ? 'zhenzhen' : 'seedance-nz';
      assert.equal(data[type === 'video' ? 'videoBuiltinSource' : 'imageBuiltinSource'], source);
      if (type === 'video') {
        const family = videoModelsForSource(source).find((item) => item.id === data.mainId);
        assert.ok(family);
        assert.ok(videoModelOptionsForSource(family, source).some((item) => item.value === data.model));
      }
    }
  });
}
test('strict prefs reject malformed versions, enums and unexpected secret fields identically', () => {
  for (const value of [null, [], 'seedance-nz', {}, { version: 2, imageSource: 'zhenzhen', videoSource: 'zhenzhen' },
    { version: 1, imageSource: 'unknown', videoSource: 'zhenzhen' },
    { version: 1, imageSource: 'zhenzhen', videoSource: 'zhenzhen', apiKey: 'must-not-persist' },
    { version: 1, imageSource: { toString: () => 'zhenzhen' }, videoSource: 'zhenzhen' }]) {
    assert.throws(() => normalizeMediaNodeDefaults(value), /media_node_defaults_invalid/);
    assert.throws(() => backend.normalizeMediaNodeDefaults(value), /media_node_defaults_invalid/);
  }
  assert.deepEqual(normalizeMediaNodeDefaults(undefined), backend.normalizeMediaNodeDefaults(undefined));
});
test('explicit identities and nonblank intents preserve all original fields', () => {
  const prefs = { version: 1, imageSource: 'seedance-nz', videoSource: 'seedance-nz' };
  const base = { model: 'old-model', providerSource: 'fal', duration: 123, referenceImages: ['keep'], title: 'old' };
  for (const field of ['model', 'apiModel', 'mainId', 'providerSource', 'providerId', 'providerModel', 'imageBuiltinSource', 'videoBuiltinSource']) {
    const explicit = { [field]: 'explicit' };
    assert.deepEqual(resolveNewMediaNodeData('image', base, explicit, prefs), { ...base, ...explicit });
  }
  for (const intent of ['clone', 'import', 'history', 'template'] as const) {
    assert.deepEqual(resolveNewMediaNodeData('video', base, {}, prefs, intent), base);
  }
  for (const type of ['rh', 'story', 'seedance25']) assert.deepEqual(resolveNewMediaNodeData(type, base, {}, prefs), base);
  assert.equal(resolveNewMediaNodeData('edit', {}, {}, prefs).apiModel, 'zhenzhen-image-g2-i2i');
});

test('all seven blank core types use Budget AI House while explicit workshop preferences remain exact', () => {
  for (const [field, type] of MEDIA_NODE_DEFAULT_FIELDS) {
    for (const choice of sources) {
      const prefs = { version: 1, imageSource: 'product-default', videoSource: 'product-default', [field]: choice };
      const data = resolveNewMediaNodeData(type, { prompt: 'keep' }, {}, prefs);
      assert.deepEqual(data, backend.resolveNewMediaNodeData(type, { prompt: 'keep' }, {}, prefs));
      const source = choice === 'zhenzhen' ? 'zhenzhen' : 'seedance-nz';
      assert.equal(backend.effectiveMediaNodeDefaultSource(type, prefs), source);
      if (type === 'llm') assert.equal(data.llmApiSource, source);
      else if (type === 'audio') assert.equal(data.sunoPlatform, source);
      else if (type === 'seedance' || type === 'director-storyboard') assert.equal(data.seedanceApiSource, source === 'zhenzhen' ? 'zhenzhen-legacy' : source);
      else assert.equal(data[type === 'video' ? 'videoBuiltinSource' : 'imageBuiltinSource'], source);
      assert.equal(data.prompt, 'keep');
    }
  }
  assert.equal(resolveNewMediaNodeData('edit', {}, {}, undefined).imageBuiltinSource, 'seedance-nz');
});

test('legacy preference shapes round-trip and expanded preference fields reject invalid values', () => {
  const old = {version:1,imageSource:'zhenzhen',videoSource:'zhenzhen'};
  assert.deepEqual(normalizeMediaNodeDefaults(old), old);
  for (const [field] of MEDIA_NODE_DEFAULT_FIELDS.slice(2)) {
    const expanded = {...old,[field]:'seedance-nz'};
    assert.deepEqual(normalizeMediaNodeDefaults(expanded), backend.normalizeMediaNodeDefaults(expanded));
    for (const value of [null, false, 'unknown', undefined]) {
      assert.throws(() => normalizeMediaNodeDefaults({...old,[field]:value}));
      assert.throws(() => backend.normalizeMediaNodeDefaults({...old,[field]:value}));
    }
  }
});

test('existing core data is preserved across clone/import/history/template and explicit source creation', () => {
  for (const type of ['image','edit','video','llm','audio','seedance','director-storyboard']) {
    const old = {model:'old',providerSource:'custom',prompt:'untouched',localRefImages:['own'],status:'success'};
    for (const intent of ['clone','import','history','template'] as const) {
      assert.deepEqual(resolveNewMediaNodeData(type, old, {}, undefined, intent), old);
      assert.deepEqual(backend.resolveNewMediaNodeData(type, old, {}, undefined, intent), old);
    }
    for (const field of ['model','llmApiSource','sunoPlatform','seedanceApiSource','seedanceNzModel','version']) {
      const explicit = {[field]:'chosen'};
      assert.deepEqual(resolveNewMediaNodeData(type, old, explicit, undefined), {...old,...explicit});
    }
  }
});
test('Creator defaults apply before synthetic providers and respect models/templates', () => {
  const prefs = { version: 1, imageSource: 'seedance-nz', videoSource: 'seedance-nz' };
  assert.deepEqual(backend.applyCreatorMediaNodeDefaults('edit-image', { prompt: 'edit' }, prefs), {
    prompt: 'edit', imageProvider: 'seedance-nz', imageModel: 'zhenzhen-image-g2-i2i', ratio: 'adaptive',
  });
  for (const explicit of [{ model: 'chosen' }, { imageModel: 'chosen' }, { imageProvider: 'zhenzhen' }]) {
    assert.equal(backend.applyCreatorMediaNodeDefaults('image', explicit, prefs), explicit);
  }
  const dedicated = { prompt: 'video' };
  assert.equal(backend.applyCreatorMediaNodeDefaults('video', dedicated, prefs), dedicated);
});
