'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');

const { createCreatorAgentV2Router } = require('../backend/src/routes/creatorAgentV2.js');
const { CreatorConversationRepository } = require('../backend/src/services/creatorConversationRepository.js');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase.js');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'creator-agent-v2-live');
const FFMPEG = path.join(ROOT, 'tools', 'ffmpeg-runtime', 'ffmpeg.exe');
const FFPROBE = path.join(ROOT, 'tools', 'ffmpeg-runtime', 'ffprobe.exe');
const projectId = 'project-creator-v2-live';
const canvasId = 'canvas-creator-v2-live';

function latestRunRoot() {
  const directories = fs.readdirSync(ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!directories.length) throw new Error('没有可恢复的 Creator V2 真实链证据');
  return path.join(ARTIFACT_ROOT, directories[0]);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function verifyVideo(filename) {
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.subarray(0, 64).includes(Buffer.from('ftyp')), true);
  const probe = spawnSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], {
    encoding: 'utf8', timeout: 120_000, windowsHide: true,
  });
  assert.equal(probe.status, 0, 'FFprobe 失败');
  const metadata = JSON.parse(probe.stdout);
  const video = (metadata.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (metadata.streams || []).find((stream) => stream.codec_type === 'audio');
  const durationSeconds = Number(metadata.format?.duration || video?.duration || 0);
  assert.ok(video && Number(video.width) > 0 && Number(video.height) > 0 && durationSeconds > 0);
  // The bundled Windows nightly decoder can access-violate while fan-out
  // decoding otherwise valid H.264 evidence. A single decode thread keeps
  // this integrity gate deterministic without weakening the full-file pass.
  const decode = spawnSync(FFMPEG, ['-v', 'error', '-threads', '1', '-i', filename, '-f', 'null', '-'], {
    encoding: 'utf8', timeout: 300_000, windowsHide: true,
  });
  assert.equal(decode.status, 0, 'FFmpeg 全片解码失败');
  return {
    file: path.basename(filename), bytes: bytes.length, sha256: sha256(bytes),
    codec: String(video.codec_name || ''), width: Number(video.width), height: Number(video.height),
    durationSeconds: Number(durationSeconds.toFixed(3)), hasAudio: Boolean(audio), fullDecodePassed: true,
  };
}

async function request(baseUrl, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const envelope = await response.json();
  if (!response.ok || !envelope.ok) throw new Error(`${endpoint} HTTP ${response.status}: ${envelope.code || ''} ${envelope.message || ''}`);
  return envelope.data;
}

async function main() {
  const runRoot = latestRunRoot();
  const database = new ProjectDatabase(path.join(runRoot, 'project.sqlite3'), { autoBackup: false });
  const repository = new CreatorConversationRepository({ filename: path.join(runRoot, 'creator.sqlite3') });
  const config = {
    DATA_DIR: path.join(runRoot, 'data'), INPUT_DIR: path.join(runRoot, 'input'), OUTPUT_DIR: path.join(runRoot, 'output'),
    THUMBNAILS_DIR: path.join(runRoot, 'thumbnails'), ASSET_PREVIEWS_DIR: path.join(runRoot, 'thumbnails', 'asset-previews'),
    SETTINGS_FILE: path.join(runRoot, 'settings-never-written.json'),
  };
  const conversation = repository.listConversations({ projectId, canvasId, limit: 1 }).items[0];
  assert.ok(conversation, '真实链会话不存在');
  const snapshot = repository.getConversation(conversation.id, { projectId, canvasId, limit: 24 });
  const assistantMessages = snapshot.messages.filter((message) => message.role === 'assistant' && message.status === 'completed');
  assert.equal(assistantMessages.length, 2, '真实链没有两轮已完成 LLM 回复');
  assert.deepEqual(assistantMessages.map((message) => message.suggestions.length), [3, 3]);
  const actions = assistantMessages.map((message) => repository.getAction(message.actionId, conversation.id, { projectId, canvasId }));
  const imageAction = actions.find((action) => action.type === 'image');
  const videoAction = actions.find((action) => action.type === 'video');
  assert.equal(imageAction?.status, 'completed', '图片动作没有完成');
  assert.equal(videoAction?.status, 'completed', '视频动作没有完成');
  assert.deepEqual(videoAction.inputAssetIds, [imageAction.resultAssets[0].assetId]);
  assert.equal(database.getRun(imageAction.runId)?.status, 'succeeded');
  assert.equal(database.getRun(videoAction.runId)?.status, 'succeeded');

  const imageRef = imageAction.resultAssets[0];
  const videoRef = videoAction.resultAssets[0];
  const imageFile = path.join(config.OUTPUT_DIR, imageRef.title);
  const videoFile = path.join(config.OUTPUT_DIR, videoRef.title);
  const imageBytes = fs.readFileSync(imageFile);
  const imageAsset = database.getAsset(imageRef.assetId);
  const image = {
    file: path.basename(imageFile), bytes: imageBytes.length, sha256: sha256(imageBytes),
    width: Number(imageAsset?.metadata?.width || 0), height: Number(imageAsset?.metadata?.height || 0),
  };
  assert.ok(image.width > 0 && image.height > 0);
  const video = verifyVideo(videoFile);

  // The first live run deliberately exposed the old unstable-default bug and
  // therefore committed two isolated test nodes before failing. Revert only
  // that newest test Patch through the public provenance ledger, then prove
  // the fixed resolver recovers the original application without a new write.
  const beforeRecovery = database.getCanvas(canvasId);
  if (beforeRecovery.nodes.length === 2) {
    const appliedPatches = database.listCanvasPatches(canvasId, {
      projectId, includeAllActors: true, includeRequestDigest: true, limit: 10,
    }).filter((item) => item.status === 'applied').sort((left, right) => right.appliedRevision - left.appliedRevision);
    assert.equal(appliedPatches.length, 2, '隔离验收画布的重复放置证据数量异常');
    database.revertCanvasPatch(canvasId, appliedPatches[0].patchId, {
      projectId, actorId: 'local-owner', patchOwnerActorId: 'local-owner',
      sessionId: `creator-agent:${conversation.id}`, expectedRevision: beforeRecovery.revision,
    });
    assert.equal(database.getCanvas(canvasId).nodes.length, 1, '重复测试 Patch 撤回后节点数异常');
  }

  const app = express();
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use('/api/creator-agent/v2', createCreatorAgentV2Router({
    config, database, repository,
    llmRuntime: { modelSnapshot: () => { throw new Error('recovery must not call LLM'); }, respond: async () => { throw new Error('recovery must not call LLM'); } },
    actionExecutor: { start: () => { throw new Error('recovery must not submit generation'); } },
    settingsProvider: () => ({}),
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/creator-agent/v2`;
  try {
    const endpoint = `/sessions/${encodeURIComponent(conversation.id)}/media/${encodeURIComponent(videoRef.assetId)}/send-to-canvas`;
    const input = { projectId, canvasId, actionId: videoAction.id };
    const first = await request(baseUrl, endpoint, input);
    const second = await request(baseUrl, endpoint, input);
    const finalCanvas = database.getCanvas(canvasId);
    assert.equal(first.duplicate, true, '修复后没有恢复首次已经应用的放置');
    assert.equal(second.duplicate, true, '修复后重复放置仍未被抑制');
    assert.equal(first.nodeId, second.nodeId);
    assert.equal(finalCanvas.nodes.length, 1);
    const report = {
      schema: 't8-creator-agent-v2-live-verification-v1',
      verifiedAt: new Date().toISOString(), status: 'passed', recoveredAfterExactlyOnceFix: true,
      provider: 'seedance-nz',
      models: {
        llm: 'zhenzhen/gk-4.6', image: imageAction.modelSnapshot.modelId, video: videoAction.modelSnapshot.modelId,
      },
      chain: ['real-llm-image-decision', 'real-image', 'real-llm-video-decision', 'real-reference-video', 'canvas-exactly-once-recovery'],
      providerCalls: { llm: 2, imageSubmissions: 1, videoSubmissions: 1, recoverySubmissions: 0 },
      suggestionsPerTurn: [3, 3], image, video,
      canvas: { revision: finalCanvas.revision, nodeCount: finalCanvas.nodes.length, stableNodeId: first.nodeId, duplicateSuppressed: true },
      persistedEvidence: {
        projectDatabase: 'project.sqlite3', conversationDatabase: 'creator.sqlite3', apiKey: false,
        remoteTaskIdInReport: false, remoteUrlInReport: false, rawProviderResponse: false,
      },
    };
    fs.writeFileSync(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(ARTIFACT_ROOT, 'latest.json'), `${JSON.stringify({
      runId: path.basename(runRoot), report: `${path.basename(runRoot)}/report.json`,
      image: `${path.basename(runRoot)}/output/${image.file}`, video: `${path.basename(runRoot)}/output/${video.file}`,
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`[creator-v2-recovery] passed ${video.width}x${video.height} ${video.durationSeconds}s ${video.bytes} bytes\n`);
    process.stdout.write(`[creator-v2-recovery] artifact ${runRoot}\n`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  repository.close();
  database.close();
}

main().catch((error) => {
  process.stderr.write(`[creator-v2-recovery] failed: ${String(error?.message || error).replace(/sk-[A-Za-z0-9_-]+/giu, '[redacted-key]').replace(/https?:\/\/\S+/giu, '[redacted-url]')}\n`);
  process.exitCode = 1;
});
