'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../backend/src/config');
const seedanceNz = require('../backend/src/providers/seedanceNz');
const creativeModelCatalog = require('../backend/src/shared/creativeModelCatalog.json');
const { AssetIndexer } = require('../backend/src/services/assetIndexer');
const { AssetPreviewPipeline } = require('../backend/src/services/assetPreviewPipeline');
const { CreatorActionExecutor } = require('../backend/src/services/creatorActionExecutor');
const { CreatorConversationRepository } = require('../backend/src/services/creatorConversationRepository');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');
const { safeRemoteMediaDownload } = require('../backend/src/utils/safeRemoteMediaFetch');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_FILE = path.join(ROOT, 'data', 'settings.json');
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'creator-agent-v2-download-recovery');
const MODEL = 'zhenzhen-image-gk-v2';

function runId() {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readSettings() {
  const value = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  const apiKey = String(value?.zhenzhenSd2ApiKey || '').trim();
  assert.match(apiKey, /^sk-[A-Za-z0-9_-]{20,}$/u, '缺少可用于真实恢复验收的平价小屋 API Key');
  return Object.freeze({
    zhenzhenSd2ApiKey: apiKey,
    zhenzhenSd2BaseUrl: String(value?.zhenzhenSd2BaseUrl || 'https://api.seedance.nz').trim(),
  });
}

function validImage(bytes) {
  return (bytes[0] === 0xff && bytes[1] === 0xd8)
    || bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP');
}

async function main() {
  const id = runId();
  const root = path.join(ARTIFACT_ROOT, id);
  const outputDir = path.join(root, 'output');
  const thumbnailsDir = path.join(root, 'thumbnails');
  const previewDir = path.join(thumbnailsDir, 'asset-previews');
  [root, outputDir, thumbnailsDir, previewDir].forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
  const settings = readSettings();
  const runtimeConfig = {
    ...config,
    DATA_DIR: path.join(root, 'data'),
    OUTPUT_DIR: outputDir,
    THUMBNAILS_DIR: thumbnailsDir,
    ASSET_PREVIEWS_DIR: previewDir,
    ASSET_PREVIEW_CONCURRENCY: 1,
    ASSET_PREVIEW_MAX_ATTEMPTS: 1,
    ASSET_PREVIEW_RETRY_BASE_MS: 25,
  };
  fs.mkdirSync(runtimeConfig.DATA_DIR, { recursive: true });
  const database = new ProjectDatabase(path.join(root, 'project.sqlite3'), { autoBackup: false });
  const repository = new CreatorConversationRepository({ filename: path.join(root, 'creator.sqlite3') });
  const previewPipeline = new AssetPreviewPipeline(runtimeConfig, database, { autoStart: false, recover: false });
  previewPipeline.schedulePump = () => {};
  const assetIndexer = new AssetIndexer(runtimeConfig, database, { previewPipeline });
  const projectId = 'project-creator-download-recovery-live';
  const canvasId = 'canvas-creator-download-recovery-live';
  const sessionId = 'session-creator-download-recovery-live';
  const actionId = `action-download-recovery-${id}`;
  database.ensureCanvas(canvasId, {
    schema: 't8-canvas-document', schemaVersion: 2, projectId, canvasId, revision: 1,
    nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  }, projectId);
  const conversation = repository.createConversation({ id: sessionId, projectId, canvasId });
  const user = repository.appendUserMessage(conversation.id, {
    body: '生成一张简洁的纸艺企鹅夜航电影画面', clientRequestId: `request-download-recovery-${id}`,
  });
  const response = repository.startAssistantResponse(conversation.id, {
    responseId: `response-download-recovery-${id}`, replyToMessageId: user.message.id,
  });
  repository.completeAssistantResponse(conversation.id, response.responseId, {
    body: '画面会保持简洁，让纸艺企鹅和暖色引航灯成为唯一焦点。',
    suggestions: [
      { label: '开始生成', sendText: '按这个方向生成图片。', intentKind: 'recommended-generate', role: 'recommended' },
      { label: '改成清晨', sendText: '把夜航改成清晨薄雾。', intentKind: 'alternative-morning', role: 'alternative' },
      { label: '确认执行', sendText: '确认并立即执行当前图片方案。', intentKind: 'execute-current', role: 'execute' },
    ],
    action: {
      id: actionId,
      type: 'image',
      prompt: '16:9 cinematic paper-craft scene, one small paper penguin at a misty teal night harbor, one warm navigation light, clean composition, clear subject, no text',
      parameters: { ratio: '16:9', count: 1 },
      modelSnapshot: {
        kind: 'image', providerId: 'seedance-nz', modelId: MODEL, catalogDigest: creativeModelCatalog.sourceDigest,
      },
    },
  });

  let submissions = 0;
  let queries = 0;
  let injectedDownloadFailures = 0;
  const provider = {
    submitImageTask: async (...args) => {
      submissions += 1;
      return seedanceNz.submitImageTask(...args);
    },
    queryImageTask: async (...args) => {
      queries += 1;
      return seedanceNz.queryImageTask(...args);
    },
  };
  const executor = new CreatorActionExecutor({
    config: runtimeConfig,
    database,
    repository,
    provider,
    assetIndexer,
    settingsProvider: () => settings,
    pollIntervalMs: 3_000,
    timeoutMs: 15 * 60_000,
    remoteMediaDownload: async (...args) => {
      if (injectedDownloadFailures < 3) {
        injectedDownloadFailures += 1;
        const error = new Error('injected download interruption');
        error.code = 'ECONNRESET';
        throw error;
      }
      return safeRemoteMediaDownload(...args);
    },
  });

  const startedAt = Date.now();
  try {
    process.stdout.write('[creator-v2-download-live] submitting one real image task\n');
    executor.start(conversation.id, actionId, { projectId, canvasId });
    await executor.wait(actionId);
    const interrupted = repository.getAction(actionId, conversation.id, { projectId, canvasId });
    assert.equal(interrupted.status, 'ambiguous', '下载中断后不应把已生成任务判死');
    assert.equal(interrupted.errorCode, 'CREATOR_RESULT_DOWNLOAD_FAILED');
    assert.equal(submissions, 1);
    assert.equal(database.getRun(interrupted.runId)?.status, 'running');
    const queriesBeforeRecovery = queries;

    process.stdout.write('[creator-v2-download-live] waiting for automatic same-task download recovery\n');
    const recoveryDeadline = Date.now() + 3 * 60_000;
    let completed = repository.getAction(actionId, conversation.id, { projectId, canvasId });
    while (completed.status !== 'completed' && Date.now() < recoveryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      completed = repository.getAction(actionId, conversation.id, { projectId, canvasId });
    }
    assert.equal(completed.status, 'completed');
    assert.equal(submissions, 1, '恢复下载时发生了第二次付费生成提交');
    assert.equal(completed.resultAssets.length, 1);
    const run = database.getRun(completed.runId);
    assert.equal(run?.status, 'succeeded');
    assert.equal(run?.summary?.recoveredWithoutResubmit, true);
    const asset = database.getAsset(completed.resultAssets[0].assetId);
    assert.ok(asset?.managedPath && fs.existsSync(asset.managedPath), '恢复结果没有形成物理项目素材');
    const bytes = fs.readFileSync(asset.managedPath);
    assert.equal(validImage(bytes), true, '恢复结果不是有效图片');
    assert.ok(Number(asset.metadata?.width || 0) > 0 && Number(asset.metadata?.height || 0) > 0, '恢复图片缺少尺寸证据');

    const report = {
      schema: 't8-creator-agent-v2-download-recovery-live-v1',
      status: 'passed',
      verifiedAt: new Date().toISOString(),
      provider: 'seedance-nz',
      model: MODEL,
      execution: {
        serial: true,
        providerSubmissions: submissions,
        providerQueriesBeforeRecovery: queriesBeforeRecovery,
        providerQueriesTotal: queries,
        injectedDownloadFailures,
        recoverySubmissions: submissions - 1,
        elapsedMs: Date.now() - startedAt,
      },
      recoveredAsset: {
        filename: path.basename(asset.managedPath),
        bytes: bytes.length,
        sha256: sha256(bytes),
        width: Number(asset.metadata.width),
        height: Number(asset.metadata.height),
        validMagic: true,
      },
      persistedSecrets: { apiKey: false, taskId: false, signedUrl: false, rawProviderResponse: false },
    };
    fs.writeFileSync(path.join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(ARTIFACT_ROOT, 'latest.json'), `${JSON.stringify({ runId: id, report: `${id}/report.json` }, null, 2)}\n`, 'utf8');
    process.stdout.write(`[creator-v2-download-live] passed ${report.recoveredAsset.width}x${report.recoveredAsset.height} ${report.recoveredAsset.bytes} bytes\n`);
    process.stdout.write(`[creator-v2-download-live] artifact ${path.join(root, 'report.json')}\n`);
  } finally {
    repository.close();
    database.close();
  }
}

main().catch((error) => {
  const safe = String(error?.message || error || 'unknown')
    .replace(/sk-[A-Za-z0-9_-]+/giu, '[redacted-key]')
    .replace(/https?:\/\/\S+/giu, '[redacted-url]')
    .slice(0, 1_000);
  process.stderr.write(`[creator-v2-download-live] failed: ${safe}\n`);
  process.exitCode = 1;
});
