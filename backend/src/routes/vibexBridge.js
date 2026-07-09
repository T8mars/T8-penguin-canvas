const express = require('express');

const router = express.Router();

const VIBEX_MESSAGE_TYPE = 't8:vibex-result';
const VIBEX_MESSAGE_SOURCE = 'vibex-workbench';
const WEB_IMAGE_MESSAGE_TYPE = 't8:web-image-result';
const WEB_IMAGE_MESSAGE_SOURCE = 't8-web-image-extension';
const MAX_QUEUE_SIZE = 80;
const MAX_SEEN_IDS = 240;

let queue = [];
let seenMessageIds = [];

function cleanText(value, maxLen = 8000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function cleanUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^(https?:\/\/|data:|\/files\/|\/output\/|\/input\/)/i.test(text)) return text.slice(0, 4096);
  return '';
}

function pushUniqueUrl(out, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => pushUniqueUrl(out, item));
    return;
  }
  const raw = value && typeof value === 'object'
    ? value.url || value.videoUrl || value.imageUrl || value.audioUrl || value.resultUrl
    : value;
  const url = cleanUrl(raw);
  if (url && !out.includes(url)) out.push(url);
}

function collectUrls(...values) {
  const out = [];
  values.forEach((value) => pushUniqueUrl(out, value));
  return out.slice(0, 24);
}

function cleanMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/api|key|token|secret|password|credential|cookie/i.test(key)) continue;
    if (raw == null) continue;
    if (typeof raw === 'number' || typeof raw === 'boolean') {
      out[key] = raw;
    } else {
      out[key] = cleanText(raw, 500);
    }
  }
  return out;
}

function normalizeMessage(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : raw;
  if (raw.type === WEB_IMAGE_MESSAGE_TYPE || raw.source === WEB_IMAGE_MESSAGE_SOURCE) {
    const images = collectUrls(payload.images, payload.imageUrls, payload.imageUrl);
    const prompt = cleanText(payload.prompt || payload.text || payload.outputText);
    if (images.length === 0 && !prompt) return null;

    const mode = ['prompt', 'image', 'both', 'reference'].includes(String(payload.mode || '').trim())
      ? String(payload.mode || '').trim()
      : 'both';
    const messageId = cleanText(payload.messageId || raw.messageId || `web-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 180);
    return {
      type: WEB_IMAGE_MESSAGE_TYPE,
      source: WEB_IMAGE_MESSAGE_SOURCE,
      receivedAt: new Date().toISOString(),
      payload: {
        messageId,
        mode,
        prompt,
        images,
        imageUrls: images,
        sourceImageUrl: cleanUrl(payload.sourceImageUrl),
        pageUrl: cleanText(payload.pageUrl || raw.pageUrl, 2048),
        pageTitle: cleanText(payload.pageTitle || raw.pageTitle, 200),
        source: cleanText(payload.source, 120) || 'web-image-reverse',
        createdAt: Number(payload.createdAt) || Date.now(),
        metadata: {
          ...cleanMetadata(payload.metadata),
          sentVia: 'browser-extension-local-bridge',
        },
      },
    };
  }

  const videoUrls = collectUrls(payload.videoUrls, payload.videos, payload.videoUrl, payload.resultUrl, payload.currentVideoUrl);
  const imageUrls = collectUrls(payload.imageUrls, payload.images, payload.imageUrl, payload.coverUrl, payload.thumbnailUrl);
  const audioUrls = collectUrls(payload.audioUrls, payload.audios, payload.audioUrl);
  const prompt = cleanText(payload.prompt || payload.textPrompt || payload.imagePrompt || payload.description);
  if (videoUrls.length === 0 && imageUrls.length === 0 && audioUrls.length === 0 && !prompt) return null;

  const messageId = cleanText(payload.messageId || raw.messageId || `vibex-web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 180);
  return {
    type: VIBEX_MESSAGE_TYPE,
    source: VIBEX_MESSAGE_SOURCE,
    receivedAt: new Date().toISOString(),
    payload: {
      messageId,
      prompt,
      model: cleanText(payload.model || payload.modelName || payload.tier, 200),
      taskId: cleanText(payload.taskId || payload.task_id, 200),
      rhTaskId: cleanText(payload.rhTaskId || payload.rh_task_id, 200),
      pageUrl: cleanText(payload.pageUrl || raw.pageUrl, 2048),
      pageTitle: cleanText(payload.pageTitle || raw.pageTitle, 200),
      videoUrls,
      imageUrls,
      audioUrls,
      metadata: {
        ...cleanMetadata(payload.metadata),
        ratio: cleanText(payload.ratio, 80),
        duration: cleanText(payload.duration, 80),
        resolution: cleanText(payload.resolution, 80),
        mode: cleanText(payload.mode || payload.activeTab, 80),
        sentVia: 'browser-extension-local-bridge',
      },
    },
  };
}

function rememberMessageId(messageId) {
  if (!messageId) return;
  seenMessageIds.push(messageId);
  if (seenMessageIds.length > MAX_SEEN_IDS) {
    seenMessageIds = seenMessageIds.slice(-Math.floor(MAX_SEEN_IDS / 2));
  }
}

router.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      ok: true,
      queueSize: queue.length,
      messageType: VIBEX_MESSAGE_TYPE,
      messageSource: VIBEX_MESSAGE_SOURCE,
      supportedMessageTypes: [VIBEX_MESSAGE_TYPE, WEB_IMAGE_MESSAGE_TYPE],
      supportedMessageSources: [VIBEX_MESSAGE_SOURCE, WEB_IMAGE_MESSAGE_SOURCE],
    },
  });
});

router.post('/messages', (req, res) => {
  const normalized = normalizeMessage(req.body || {});
  if (!normalized) {
    return res.status(400).json({
      success: false,
      error: 'empty_vibex_result',
      message: '没有发现可发送到画布的视频、图片、音频或提示词。',
    });
  }

  const messageId = normalized.payload.messageId;
  if (seenMessageIds.includes(messageId) || queue.some((item) => item.payload.messageId === messageId)) {
    return res.json({
      success: true,
      data: {
        messageId,
        queued: false,
        duplicate: true,
        queueSize: queue.length,
      },
    });
  }

  queue.push(normalized);
  rememberMessageId(messageId);
  if (queue.length > MAX_QUEUE_SIZE) {
    queue = queue.slice(-MAX_QUEUE_SIZE);
  }
  return res.json({
    success: true,
    data: {
      messageId,
      queued: true,
      duplicate: false,
      queueSize: queue.length,
    },
  });
});

router.get('/pending', (req, res) => {
  const limit = Math.max(1, Math.min(24, Number(req.query.limit || 12) || 12));
  const messages = queue.splice(0, limit);
  return res.json({
    success: true,
    data: {
      messages,
      remaining: queue.length,
    },
  });
});

module.exports = router;
