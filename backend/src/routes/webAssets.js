'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const config = require('../config');

const router = express.Router();

const MAX_ITEMS = 80;
const MAX_ITEM_BYTES = 80 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 30_000;
const IMAGE_MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

function cleanText(value, maxLen = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function safeFilenameStem(value, fallback = 'web-image') {
  const clean = cleanText(value, 120)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[._-]+$/g, '')
    .replace(/^[._-]+/g, '')
    .slice(0, 80);
  return clean || fallback;
}

function mimeToExt(mime) {
  const clean = String(mime || '').split(';', 1)[0].trim().toLowerCase();
  return IMAGE_MIME_EXT[clean] || '';
}

function sniffImageExt(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.subarray(4, 12).toString('ascii') === 'ftypavif') return 'avif';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp';
  return '';
}

function imageMimeFromExt(ext) {
  const clean = String(ext || '').toLowerCase();
  if (clean === 'jpg' || clean === 'jpeg') return 'image/jpeg';
  if (clean === 'png') return 'image/png';
  if (clean === 'webp') return 'image/webp';
  if (clean === 'gif') return 'image/gif';
  if (clean === 'avif') return 'image/avif';
  if (clean === 'bmp') return 'image/bmp';
  return 'application/octet-stream';
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpe?g|webp|gif|avif|bmp));base64,([\s\S]+)$/i.exec(String(dataUrl || '').trim());
  if (!match) throw new Error('dataUrl 只支持常见图片格式');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('图片数据为空');
  if (buffer.length > MAX_ITEM_BYTES) throw new Error('图片超过网页采集导入上限');
  const ext = sniffImageExt(buffer) || mimeToExt(match[1]);
  if (!ext) throw new Error('无法识别图片格式');
  return { buffer, mime: imageMimeFromExt(ext), ext };
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((part) => Number(part));
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0
    );
  }
  const clean = ip.toLowerCase();
  return clean === '::1' || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:');
}

async function assertSafeRemoteUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('远程图片 URL 不合法');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('远程图片仅支持 http(s)');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('不允许从本机地址采集远程图片');
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error('不允许从内网地址采集远程图片');
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: false });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new Error('远程图片地址解析到不安全的网络位置');
  }
  return parsed;
}

async function fetchRemoteImage(rawUrl) {
  let parsed = await assertSafeRemoteUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  try {
    let response = null;
    for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
      response = await fetch(parsed.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'T8-PenguinCanvas-WebAssetImporter/1.0' },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) throw new Error('远程图片重定向缺少 Location');
      parsed = await assertSafeRemoteUrl(new URL(location, parsed.href).href);
    }
    if (!response) throw new Error('远程图片下载失败');
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      throw new Error('远程图片重定向次数过多');
    }
    if (!response.ok) throw new Error(`远程图片下载失败: HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_ITEM_BYTES) throw new Error('图片超过网页采集导入上限');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('远程图片为空');
    if (buffer.length > MAX_ITEM_BYTES) throw new Error('图片超过网页采集导入上限');
    const ext = sniffImageExt(buffer) || mimeToExt(response.headers.get('content-type')) || path.extname(parsed.pathname).replace(/^\./, '').toLowerCase();
    if (!IMAGE_MIME_EXT[imageMimeFromExt(ext)]) throw new Error('远程资源不是支持的图片格式');
    return { buffer, mime: imageMimeFromExt(ext), ext };
  } finally {
    clearTimeout(timer);
  }
}

function sourceName(entry, index) {
  const explicit = safeFilenameStem(entry?.name || entry?.filename || '', '');
  if (explicit) return explicit;
  try {
    const url = new URL(String(entry?.url || ''));
    return safeFilenameStem(decodeURIComponent(path.basename(url.pathname || '')), `web-image-${index + 1}`);
  } catch {
    return `web-image-${index + 1}`;
  }
}

function saveImportedImage(entry, index, image) {
  if (!fs.existsSync(config.INPUT_DIR)) fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  const stem = sourceName(entry, index);
  const filename = `web_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}_${stem}.${image.ext}`;
  const target = path.join(config.INPUT_DIR, filename);
  fs.writeFileSync(target, image.buffer);
  return {
    ok: true,
    filename,
    url: `/files/input/${filename}`,
    kind: 'image',
    name: `${stem}.${image.ext}`,
    size: image.buffer.length,
    mime: image.mime,
    sourceUrl: cleanText(entry?.url, 2048),
    pageUrl: cleanText(entry?.pageUrl, 2048),
    pageTitle: cleanText(entry?.pageTitle, 200),
  };
}

router.post('/import', express.json({ limit: '120mb' }), async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length === 0) {
      return res.status(400).json({ success: false, error: '缺少网页素材 items' });
    }
    const items = [];
    for (const [index, entry] of rawItems.slice(0, MAX_ITEMS).entries()) {
      try {
        const dataUrl = String(entry?.dataUrl || entry?.data || '').trim().slice(0, 140_000_000);
        const url = cleanText(entry?.url, 4096);
        if (!dataUrl && !url) throw new Error('缺少图片 URL 或 dataUrl');
        const image = dataUrl ? parseDataUrl(dataUrl) : await fetchRemoteImage(url);
        items.push(saveImportedImage(entry, index, image));
      } catch (error) {
        items.push({
          ok: false,
          url: cleanText(entry?.url, 2048),
          name: cleanText(entry?.name || entry?.filename, 200),
          error: error?.message || '导入失败',
        });
      }
    }
    res.json({
      success: true,
      data: {
        count: items.filter((item) => item.ok).length,
        failed: items.filter((item) => !item.ok).length,
        items,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error?.message || String(error) });
  }
});

module.exports = router;
