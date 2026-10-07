import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { IMAGE_MODELS, ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS } from '../src/providers/models.ts';

const require = createRequire(import.meta.url);
const newModel = 'gemini-nano-banana-2.1';
const family = IMAGE_MODELS.find((item) => item.id === 'nano-banana-2')!;

test('workshop adds only the requested Nano Banana 2.1 option, preserving all legacy defaults', () => {
  assert.deepEqual(family.apiModelOptions.map((item) => item.value), [
    'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'nano-banana-2-fal', newModel,
  ]);
  assert.equal(family.apiModelOptions.at(-1)?.label, newModel);
  assert.equal(family.apiModel, 'gemini-3.1-flash-image');
  assert.equal(family.defaultAspectRatio, '1:1');
  assert.equal(family.defaultSize, '2K');
  assert.equal(family.paramKind, 'banana-ratio');
  assert.equal(family.maxReferenceImages, 5);
  assert.deepEqual(family.sizes, ['1K', '2K', '4K']);
  assert.deepEqual(family.aspectRatios, ['Auto', '1:1', '16:9', '4:3', '4:5', '3:2', '2:3', '3:4', '5:4', '9:16', '21:9', '9:21', '1:4', '4:1', '1:8', '8:1']);
  assert.deepEqual(family.capabilities, ['t2i', 'i2i']);
  assert.ok(!ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS.some((item) => item.value === newModel));
  assert.equal(IMAGE_MODELS.filter((item) => item.apiModelOptions.some((option) => option.value === newModel)).length, 1);
});

test('production ImageNode selection and standard request preserve the exact new model ID', () => {
  const source = fs.readFileSync(new URL('../src/components/nodes/ImageNode.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('ImageNode.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let selectedModel: ts.Expression | undefined;
  let request: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'apiModel') selectedModel = node.initializer;
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'submitImageAsync'
      && ts.isObjectLiteralExpression(node.arguments[0])) request = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(selectedModel && request);
  const evaluate = (expression: ts.Expression, context: Record<string, unknown>) => {
    runInNewContext(ts.transpileModule(`result=(${expression.getText(parsed)});`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    return context.result;
  };
  const context = { builtinApiModelOptions: family.apiModelOptions, savedApiModel: newModel,
    modelDef: family, isZhenzhenBudgetImageSelected: false };
  assert.equal(evaluate(selectedModel!, context), newModel);
  assert.equal(evaluate(selectedModel!, { ...context, savedApiModel: undefined }), family.apiModel);
  const refs = ['/api/resources/file/res_fixture'];
  const actual = evaluate(request!, { modelDef: family, apiModel: newModel, isGptImage25: false,
    isSeedream: false, isStandardGptImage2: false, finalPrompt: 'test prompt', effectiveAspectRatio: '16:9',
    effectiveSizeLevel: '2K', allRefs: refs, providerParams: undefined });
  assert.equal(actual.model, 'nano-banana-2');
  assert.equal(actual.apiModel, newModel);
  assert.equal(actual.paramKind, 'banana-ratio');
  assert.equal(actual.aspect_ratio, '16:9');
  assert.equal(actual.image_size, '2K');
  assert.equal(actual.images, refs);
});

test('production workshop routes keep existing T2I JSON and I2I multipart protocols for Nano Banana 2.1', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-nano21-contract-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}t8-nano21-contract-`));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const png = await sharp({ create: { width: 16, height: 16, channels: 4,
    background: { r: 15, g: 100, b: 170, alpha: 1 } } }).png().toBuffer();
  const calls: any[] = [];
  const upstream = express();
  upstream.use(express.json());
  const response = { data: [{ b64_json: png.toString('base64'), mime_type: 'image/png' }] };
  upstream.post('/v1/images/generations', (req, res) => {
    calls.push({ path: req.path, query: req.query, body: req.body, auth: req.header('authorization') });
    res.json(response);
  });
  upstream.post('/v1/images/edits', multer({ storage: multer.memoryStorage() }).any(), (req, res) => {
    calls.push({ path: req.path, query: req.query, body: req.body, files: req.files, auth: req.header('authorization') });
    res.json(response);
  });
  const listen = (app: any) => new Promise<any>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const upstreamServer = await listen(upstream);
  t.after(() => upstreamServer.close());
  const isolatedEnv = {
    T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: directory,
    T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1',
    T8_COLLAB_MANAGEMENT_TOKEN: randomBytes(32).toString('base64url'),
  };
  const priorEnv = Object.fromEntries(Object.keys(isolatedEnv).map((name) => [name, process.env[name]]));
  Object.assign(process.env, isolatedEnv);
  t.after(() => {
    for (const [name, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const config = require('../backend/src/config.js');
  const original = { SETTINGS_FILE: config.SETTINGS_FILE, OUTPUT_DIR: config.OUTPUT_DIR, ZHENZHEN_BASE_URL: config.ZHENZHEN_BASE_URL };
  t.after(() => Object.assign(config, original));
  config.SETTINGS_FILE = path.join(directory, 'settings.json');
  config.OUTPUT_DIR = path.join(directory, 'output');
  config.ZHENZHEN_BASE_URL = `http://127.0.0.1:${upstreamServer.address().port}`;
  fs.mkdirSync(config.OUTPUT_DIR);
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ nanoBananaApiKey: 'synthetic-nano-key', zhenzhenApiKey: 'synthetic-general-key' }));
  const proxyRouter = require('../backend/src/routes/proxy.js');
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api/proxy', proxyRouter);
  const server = await listen(app);
  t.after(() => server.close());
  for (const images of [[], [`data:image/png;base64,${png.toString('base64')}`]]) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/image/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: family.id, apiModel: newModel, paramKind: family.paramKind,
        prompt: 'test prompt', aspect_ratio: '16:9', image_size: '2K', images }),
    });
    const result = await r.json();
    assert.equal(r.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.sync, true);
    assert.match(result.data.urls[0], /^\/files\/output\/img_/);
  }
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.auth, 'Bearer synthetic-nano-key');
    assert.equal(call.body.model, newModel);
    assert.equal(call.body.aspect_ratio, '16:9');
    assert.equal(call.body.image_size, '2K');
    assert.equal(call.query.async, 'true');
    assert.equal(call.body.generationConfig, undefined);
  }
  assert.equal(calls[0].path, '/v1/images/generations');
  assert.equal(calls[1].path, '/v1/images/edits');
  assert.equal(calls[1].files.length, 1);
  assert.equal(calls[1].files[0].fieldname, 'image');
  assert.equal(calls[1].files[0].mimetype, 'image/png');
  assert.ok(png.equals(calls[1].files[0].buffer));
});
