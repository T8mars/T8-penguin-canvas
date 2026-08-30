'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const provider = require('../backend/src/providers/seedanceNz');

const MODEL = 'zhenzhen-video-g-omni-1.1-flash-lowprice';
const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'veo-omni11-live');
const RECOVERY_FILE = path.join(ROOT, '.tmp', 'veo-omni11-live-recovery.json');
const REPORT_FILE = path.join(OUTPUT_DIR, 'report.json');
const VIDEO_FILE = path.join(OUTPUT_DIR, 'veo-omni11-text-4s.mp4');
const FFMPEG = path.join(ROOT, 'tools', 'ffmpeg-runtime', 'ffmpeg.exe');
const FFPROBE = path.join(ROOT, 'tools', 'ffmpeg-runtime', 'ffprobe.exe');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function readApiKey() {
  const value = String(process.env.SEEDANCE_NZ_LIVE_API_KEY || '').trim();
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(value)) {
    throw new Error('SEEDANCE_NZ_LIVE_API_KEY 未提供有效的一次性测试密钥');
  }
  return value;
}

function safeError(error) {
  return String(error?.message || error || 'unknown')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/https?:\/\/\S+/g, '[redacted-url]');
}

async function poll(taskId, apiKey, maxPolls = 720) {
  for (let pollCount = 1; pollCount <= maxPolls; pollCount += 1) {
    const value = await provider.queryTask(taskId, apiKey);
    if (value.status === 'failed') {
      throw new Error(`上游任务失败：${value.failReason || value.error || 'unknown'}`);
    }
    if ((value.status === 'succeeded' || value.status === 'completed') && value.videoUrl) {
      return { videoUrl: value.videoUrl, pollCount };
    }
    if (pollCount % 6 === 0) process.stdout.write(`[veo-omni11-live] waiting (${pollCount})\n`);
    await sleep(5000);
  }
  throw new Error('轮询超时，任务保持在恢复文件中，未自动重复提交');
}

async function downloadVideo(url) {
  const response = await provider.fetchRemote(url, { headers: { Accept: 'video/*,*/*' } });
  if (!response.ok) throw new Error(`结果下载 HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error(`视频结果过小：${buffer.length} bytes`);
  if (!buffer.subarray(0, 64).includes(Buffer.from('ftyp'))) throw new Error('视频结果不是可识别的 MP4');
  fs.writeFileSync(VIDEO_FILE, buffer);
  return buffer;
}

function verifyVideo(buffer) {
  for (const binary of [FFMPEG, FFPROBE]) {
    if (!fs.existsSync(binary)) throw new Error(`缺少媒体验证工具：${path.basename(binary)}`);
  }
  const probe = spawnSync(FFPROBE, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', VIDEO_FILE,
  ], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (probe.status !== 0) throw new Error(`ffprobe 失败：${safeError(probe.stderr)}`);
  const metadata = JSON.parse(probe.stdout);
  const stream = (metadata.streams || []).find((item) => item.codec_type === 'video');
  const durationSeconds = Number(metadata.format?.duration || stream?.duration || 0);
  if (!stream || Number(stream.width) <= 0 || Number(stream.height) <= 0 || durationSeconds <= 0) {
    throw new Error('视频缺少有效的视频流、尺寸或时长');
  }
  const decode = spawnSync(FFMPEG, [
    '-v', 'error', '-i', VIDEO_FILE, '-map', '0:v:0', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 300000, windowsHide: true });
  if (decode.status !== 0) throw new Error(`ffmpeg 全量解码失败：${safeError(decode.stderr)}`);
  return {
    file: path.basename(VIDEO_FILE),
    bytes: buffer.length,
    sha256: sha256(buffer),
    codec: String(stream.codec_name || ''),
    width: Number(stream.width),
    height: Number(stream.height),
    durationSeconds: Number(durationSeconds.toFixed(3)),
    fullDecodePassed: true,
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(RECOVERY_FILE), { recursive: true });
  const apiKey = readApiKey();
  process.stdout.write(`[veo-omni11-live] submit ${MODEL}\n`);
  const submitted = await provider.submitTask({
    model: MODEL,
    mode: 'text',
    prompt: 'A small origami penguin walks across a clean mint-green studio table, gentle dolly-in, stable cinematic lighting, no text',
    seconds: 4,
    resolution: '720p',
    aspect_ratio: '16:9',
    nsfw_check: false,
  }, apiKey);
  fs.writeFileSync(RECOVERY_FILE, `${JSON.stringify({
    schema: 't8-veo-omni11-live-recovery-v1',
    model: MODEL,
    taskId: submitted.taskId,
    submittedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  const completed = await poll(submitted.taskId, apiKey);
  const buffer = await downloadVideo(completed.videoUrl);
  const artifact = verifyVideo(buffer);
  const report = {
    schema: 't8-veo-omni11-live-verification-v1',
    verifiedAt: new Date().toISOString(),
    provider: 'seedance-nz',
    model: MODEL,
    endpoint: '/v1/videos',
    mode: 'text',
    payloadContract: {
      seconds: '4',
      resolution: '720p',
      aspect_ratio: '16:9',
      nsfw_check: false,
    },
    submissionCount: 1,
    pollCount: completed.pollCount,
    status: 'passed',
    artifact,
    apiKeyPersisted: false,
    taskIdPersistedInReport: false,
    remoteUrlPersisted: false,
    rawResponsePersisted: false,
  };
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.rmSync(RECOVERY_FILE, { force: true });
  process.stdout.write(`[veo-omni11-live] passed ${artifact.width}x${artifact.height} ${artifact.durationSeconds}s ${artifact.bytes} bytes\n`);
}

main().catch((error) => {
  process.stderr.write(`[veo-omni11-live] failed: ${safeError(error)}\n`);
  process.exitCode = 1;
});
