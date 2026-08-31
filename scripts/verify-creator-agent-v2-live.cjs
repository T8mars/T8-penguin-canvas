'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');

const creativeModelCatalog = require('../backend/src/shared/creativeModelCatalog.json');
const { createCreatorAgentV2Router } = require('../backend/src/routes/creatorAgentV2.js');
const { AssetIndexer } = require('../backend/src/services/assetIndexer.js');
const { AssetPreviewPipeline } = require('../backend/src/services/assetPreviewPipeline.js');
const { CreatorActionExecutor } = require('../backend/src/services/creatorActionExecutor.js');
const { CreatorConversationRepository } = require('../backend/src/services/creatorConversationRepository.js');
const { createCreatorLlmRuntimeV2 } = require('../backend/src/services/creatorLlmRuntimeV2.js');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase.js');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'creator-agent-v2-live');
const SETTINGS_FILE = path.join(ROOT, 'data', 'settings.json');
const FFMPEG = path.join(ROOT, 'tools', 'ffmpeg-runtime', 'ffmpeg.exe');
const FFPROBE = path.join(ROOT, 'tools', 'ffmpeg-runtime', 'ffprobe.exe');
const LLM_MODEL = 'zhenzhen/gk-4.6';
const IMAGE_MODEL = 'zhenzhen-image-gk-v2';
const VIDEO_MODEL = 'zhenzhen-video-g-omni-1.1-flash-lowprice';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safeError(error) {
  return String(error?.message || error || 'unknown')
    .replace(/sk-[A-Za-z0-9_-]+/giu, '[redacted-key]')
    .replace(/https?:\/\/\S+/giu, '[redacted-url]')
    .slice(0, 1_000);
}

function readCredentialSettings() {
  const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  const apiKey = String(parsed?.zhenzhenSd2ApiKey || '').trim();
  if (!/^sk-[A-Za-z0-9_-]{20,}$/u.test(apiKey)) throw new Error('现有 API 设置中没有可用于全链验收的平价小屋密钥');
  return Object.freeze({
    zhenzhenSd2ApiKey: apiKey,
    zhenzhenSd2BaseUrl: String(parsed?.zhenzhenSd2BaseUrl || 'https://api.seedance.nz').trim(),
  });
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

async function request(baseUrl, endpoint, init = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(`${endpoint} HTTP ${response.status}: ${body?.code || ''} ${body?.message || ''}`);
  }
  return { response, body };
}

function verifyImage(filename, asset) {
  const bytes = fs.readFileSync(filename);
  const validMagic = (bytes[0] === 0xff && bytes[1] === 0xd8)
    || bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP');
  assert.equal(validMagic, true, '图像结果文件签名无效');
  assert.equal(Number(asset?.metadata?.width) > 0, true, '图像资产没有解析宽度');
  assert.equal(Number(asset?.metadata?.height) > 0, true, '图像资产没有解析高度');
  return {
    file: path.basename(filename),
    bytes: bytes.length,
    sha256: sha256(bytes),
    width: Number(asset.metadata.width),
    height: Number(asset.metadata.height),
  };
}

function verifyVideo(filename) {
  assert.equal(fs.existsSync(FFMPEG), true, '缺少 FFmpeg 验证工具');
  assert.equal(fs.existsSync(FFPROBE), true, '缺少 FFprobe 验证工具');
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.subarray(0, 64).includes(Buffer.from('ftyp')), true, '最终视频不是可识别 MP4');
  const probe = spawnSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], {
    encoding: 'utf8', timeout: 120_000, windowsHide: true,
  });
  if (probe.status !== 0) throw new Error(`FFprobe 失败：${safeError(probe.stderr)}`);
  const metadata = JSON.parse(probe.stdout);
  const video = (metadata.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (metadata.streams || []).find((stream) => stream.codec_type === 'audio');
  const durationSeconds = Number(metadata.format?.duration || video?.duration || 0);
  assert.ok(video && Number(video.width) > 0 && Number(video.height) > 0 && durationSeconds > 0, '最终视频缺少有效视频流');
  // The bundled Windows nightly decoder can access-violate while fan-out
  // decoding otherwise valid H.264 evidence. A single decode thread keeps
  // this integrity gate deterministic without weakening the full-file pass.
  const decode = spawnSync(FFMPEG, ['-v', 'error', '-threads', '1', '-i', filename, '-f', 'null', '-'], {
    encoding: 'utf8', timeout: 300_000, windowsHide: true,
  });
  if (decode.status !== 0) throw new Error(`FFmpeg 全片解码失败：${safeError(decode.stderr)}`);
  return {
    file: path.basename(filename),
    bytes: bytes.length,
    sha256: sha256(bytes),
    codec: String(video.codec_name || ''),
    width: Number(video.width),
    height: Number(video.height),
    durationSeconds: Number(durationSeconds.toFixed(3)),
    hasAudio: Boolean(audio),
    fullDecodePassed: true,
  };
}

async function main() {
  const runId = makeRunId();
  const runRoot = path.join(ARTIFACT_ROOT, runId);
  const outputDir = path.join(runRoot, 'output');
  const inputDir = path.join(runRoot, 'input');
  const thumbnailsDir = path.join(runRoot, 'thumbnails');
  const previewsDir = path.join(thumbnailsDir, 'asset-previews');
  [runRoot, outputDir, inputDir, thumbnailsDir, previewsDir].forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
  const settings = readCredentialSettings();
  const config = {
    DATA_DIR: path.join(runRoot, 'data'),
    SETTINGS_FILE: path.join(runRoot, 'settings-never-written.json'),
    INPUT_DIR: inputDir,
    OUTPUT_DIR: outputDir,
    THUMBNAILS_DIR: thumbnailsDir,
    ASSET_PREVIEWS_DIR: previewsDir,
    ASSET_PREVIEW_CONCURRENCY: 1,
    ASSET_PREVIEW_MAX_ATTEMPTS: 2,
    ASSET_PREVIEW_RETRY_BASE_MS: 25,
    ASSET_PREVIEW_PIPELINE_VERSION: 'asset-preview-v1',
  };
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  const database = new ProjectDatabase(path.join(runRoot, 'project.sqlite3'), { autoBackup: false });
  const repository = new CreatorConversationRepository({ filename: path.join(runRoot, 'creator.sqlite3') });
  const previewPipeline = new AssetPreviewPipeline(config, database, { autoStart: false, recover: false });
  previewPipeline.schedulePump = () => {};
  const assetIndexer = new AssetIndexer(config, database, { previewPipeline });
  const llmRuntime = createCreatorLlmRuntimeV2({
    config,
    settingsProvider: () => settings,
    timeoutMs: 300_000,
  });
  const actionExecutor = new CreatorActionExecutor({
    config,
    database,
    repository,
    settingsProvider: () => settings,
    assetIndexer,
    pollIntervalMs: 3_000,
    timeoutMs: 15 * 60_000,
  });
  const projectId = 'project-creator-v2-live';
  const canvasId = 'canvas-creator-v2-live';
  database.ensureCanvas(canvasId, {
    schema: 't8-canvas-document', schemaVersion: 2, projectId, canvasId, revision: 1,
    nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  }, projectId);

  const app = express();
  app.use(express.json({ limit: '1mb', strict: true }));
  const router = createCreatorAgentV2Router({
    config,
    database,
    repository,
    llmRuntime,
    actionExecutor,
    assetIndexer,
    settingsProvider: () => settings,
    llmTimeoutMs: 300_000,
    actionTimeoutMs: 15 * 60_000,
  });
  app.use('/api/creator-agent/v2', router);
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/creator-agent/v2`;
  const stageTimes = {};
  const startedAt = Date.now();

  try {
    process.stdout.write('[creator-v2-live] 1/5 real LLM plans an image\n');
    let marker = Date.now();
    await request(baseUrl, '/settings', {
      method: 'PUT',
      body: JSON.stringify({
        projectId, canvasId,
        preferences: {
          providerId: 'seedance-nz',
          llm: { providerId: 'seedance-nz', modelId: LLM_MODEL },
          image: { providerId: 'seedance-nz', modelId: IMAGE_MODEL },
          video: { providerId: 'seedance-nz', modelId: VIDEO_MODEL },
          catalogDigest: creativeModelCatalog.sourceDigest,
        },
      }),
    });
    const created = await request(baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, canvasId, title: '纸企鹅的夜航' }),
    });
    const sessionId = created.body.data.conversation.id;
    const imageTurn = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId, clientRequestId: `live-image-${runId}`,
        text: '请直接为我生成一张 16:9 电影感画面：一只小纸艺企鹅站在薄雾笼罩的青绿色夜航码头，暖色引航灯照亮它，构图简洁、主体清楚、无文字。信息已经完整，不要继续提问。',
      }),
    });
    stageTimes.llmToImageDecisionMs = Date.now() - marker;
    const imageAction = imageTurn.body.data.pendingAction;
    assert.equal(imageTurn.body.data.evidence.providerCalls, 1, '图片创作回复没有恰好调用一次 LLM');
    assert.equal(imageTurn.body.data.assistant.suggestions.length, 3, '图片回复没有三个建议');
    assert.equal(imageAction?.type, 'image', 'LLM 没有形成图片确认动作');

    process.stdout.write('[creator-v2-live] 2/5 real image generation and managed asset\n');
    marker = Date.now();
    await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(imageAction.id)}/confirm`, {
      method: 'POST', body: JSON.stringify({ projectId, canvasId }),
    });
    await actionExecutor.wait(imageAction.id);
    const completedImageAction = repository.getAction(imageAction.id, sessionId, { projectId, canvasId });
    assert.equal(completedImageAction.status, 'completed', completedImageAction.errorMessage || '图片生成未完成');
    assert.equal(completedImageAction.resultAssets.length, 1, '图片结果没有形成唯一资产');
    const imageRef = completedImageAction.resultAssets[0];
    const imageAsset = database.getAsset(imageRef.assetId);
    const imageFile = path.join(outputDir, imageRef.title);
    const imageArtifact = verifyImage(imageFile, imageAsset);
    stageTimes.imageGenerationMs = Date.now() - marker;

    process.stdout.write('[creator-v2-live] 3/5 real LLM turns the image into a video decision\n');
    marker = Date.now();
    const videoTurn = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId, clientRequestId: `live-video-${runId}`,
        text: '把刚生成的图片直接做成 4 秒 16:9、720p 视频：镜头非常缓慢地向企鹅推进，薄雾轻轻流动，远处引航灯有自然呼吸感，主体身份和构图保持稳定，无文字。请使用我提供的图片作为参考。',
        attachments: [imageRef],
      }),
    });
    stageTimes.llmToVideoDecisionMs = Date.now() - marker;
    const videoAction = videoTurn.body.data.pendingAction;
    assert.equal(videoTurn.body.data.evidence.providerCalls, 1, '视频创作回复没有恰好调用一次 LLM');
    assert.equal(videoTurn.body.data.assistant.suggestions.length, 3, '视频回复没有三个建议');
    assert.equal(videoAction?.type, 'video', 'LLM 没有形成视频确认动作');
    assert.deepEqual(videoAction.inputAssetIds, [imageRef.assetId], '视频动作没有绑定刚生成的真实图片资产');

    process.stdout.write('[creator-v2-live] 4/5 real reference-video generation and full decode\n');
    marker = Date.now();
    await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(videoAction.id)}/confirm`, {
      method: 'POST', body: JSON.stringify({ projectId, canvasId }),
    });
    await actionExecutor.wait(videoAction.id);
    const completedVideoAction = repository.getAction(videoAction.id, sessionId, { projectId, canvasId });
    assert.equal(completedVideoAction.status, 'completed', completedVideoAction.errorMessage || '视频生成未完成');
    assert.equal(completedVideoAction.resultAssets.length, 1, '视频结果没有形成唯一资产');
    const videoRef = completedVideoAction.resultAssets[0];
    const videoFile = path.join(outputDir, videoRef.title);
    const videoArtifact = verifyVideo(videoFile);
    stageTimes.videoGenerationMs = Date.now() - marker;

    process.stdout.write('[creator-v2-live] 5/5 send final video to canvas exactly once\n');
    marker = Date.now();
    const endpoint = `/sessions/${encodeURIComponent(sessionId)}/media/${encodeURIComponent(videoRef.assetId)}/send-to-canvas`;
    const sendBody = JSON.stringify({ projectId, canvasId, actionId: videoAction.id });
    const firstSend = await request(baseUrl, endpoint, { method: 'POST', body: sendBody });
    const secondSend = await request(baseUrl, endpoint, { method: 'POST', body: sendBody });
    const finalCanvas = database.getCanvas(canvasId);
    assert.equal(firstSend.body.data.duplicate, false, '首次发送被错误识别为重复');
    assert.equal(secondSend.body.data.duplicate, true, '重复发送没有 exactly-once 恢复');
    assert.equal(firstSend.body.data.nodeId, secondSend.body.data.nodeId, '重复发送创建了不同节点身份');
    assert.equal(finalCanvas.nodes.length, 1, '最终视频没有只形成一个画布节点');
    stageTimes.sendToCanvasMs = Date.now() - marker;

    const report = {
      schema: 't8-creator-agent-v2-live-verification-v1',
      verifiedAt: new Date().toISOString(),
      status: 'passed',
      provider: 'seedance-nz',
      models: { llm: LLM_MODEL, image: IMAGE_MODEL, video: VIDEO_MODEL },
      chain: ['real-llm-image-decision', 'real-image', 'real-llm-video-decision', 'real-reference-video', 'canvas-exactly-once'],
      providerCalls: { llm: 2, imageSubmissions: 1, videoSubmissions: 1 },
      suggestionsPerTurn: [3, 3],
      stageTimes,
      totalMs: Date.now() - startedAt,
      image: imageArtifact,
      video: videoArtifact,
      canvas: {
        revision: finalCanvas.revision,
        nodeCount: finalCanvas.nodes.length,
        stableNodeId: firstSend.body.data.nodeId,
        duplicateSuppressed: true,
      },
      persistedEvidence: {
        projectDatabase: 'project.sqlite3',
        conversationDatabase: 'creator.sqlite3',
        apiKey: false,
        remoteTaskIdInReport: false,
        remoteUrlInReport: false,
        rawProviderResponse: false,
      },
    };
    fs.writeFileSync(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(ARTIFACT_ROOT, 'latest.json'), `${JSON.stringify({ runId, report: `${runId}/report.json`, image: `${runId}/output/${imageArtifact.file}`, video: `${runId}/output/${videoArtifact.file}` }, null, 2)}\n`, 'utf8');
    process.stdout.write(`[creator-v2-live] passed ${videoArtifact.width}x${videoArtifact.height} ${videoArtifact.durationSeconds}s ${videoArtifact.bytes} bytes\n`);
    process.stdout.write(`[creator-v2-live] artifact ${runRoot}\n`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    previewPipeline.close?.();
    repository.close();
    database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`[creator-v2-live] failed: ${safeError(error)}\n`);
  process.exitCode = 1;
});
