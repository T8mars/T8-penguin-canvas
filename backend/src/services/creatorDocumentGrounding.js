'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CREATOR_DOCUMENT_OBSERVATION_SCHEMA = 't8-creator-document-observation-v1';
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TOTAL_CHARACTER_BUDGET = 96_000;
const DEFAULT_PER_DOCUMENT_CHARACTER_BUDGET = 30_000;
const MAX_LONG_SCRIPT_CHARACTERS = 2_000_000;
const DIGEST_RE = /^[a-f0-9]{64}$/u;

function boundedText(value, maximum = 2_000) {
  return String(value == null ? '' : value).replace(/\r\n?/gu, '\n').trim().slice(0, maximum);
}

function stableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`)
    .join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableString(value)).digest('hex');
}

function normalizedContentHash(value) {
  const hash = boundedText(value, 128).toLowerCase().replace(/^sha256:/u, '');
  return DIGEST_RE.test(hash) ? hash : '';
}

function documentType(attachment = {}) {
  const mime = boundedText(attachment.mimeType, 120).toLowerCase().split(';')[0];
  const extension = path.extname(boundedText(attachment.title || attachment.mediaUrl, 500)).toLowerCase();
  if (mime === 'application/pdf' || extension === '.pdf') return 'pdf';
  if (mime === 'text/markdown' || ['.md', '.markdown'].includes(extension)) return 'markdown';
  if (mime.startsWith('text/') || extension === '.txt') return 'text';
  return '';
}

function observationPayload(value) {
  return {
    schema: CREATOR_DOCUMENT_OBSERVATION_SCHEMA,
    assetId: value.assetId,
    contentRevision: value.contentRevision,
    contentHash: value.contentHash,
    mimeType: value.mimeType,
    documentType: value.documentType,
    text: value.text,
    pageCount: value.pageCount,
    extractedPageCount: value.extractedPageCount,
    truncated: value.truncated,
    limitation: value.limitation,
    observedAt: value.observedAt,
  };
}

function normalizeCreatorDocumentObservation(value, attachment = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== CREATOR_DOCUMENT_OBSERVATION_SCHEMA) return null;
  const normalized = {
    schema: CREATOR_DOCUMENT_OBSERVATION_SCHEMA,
    assetId: boundedText(value.assetId, 180),
    contentRevision: Math.max(1, Math.trunc(Number(value.contentRevision) || 0)),
    contentHash: normalizedContentHash(value.contentHash),
    mimeType: boundedText(value.mimeType, 120).toLowerCase() || 'application/octet-stream',
    documentType: ['text', 'markdown', 'pdf'].includes(value.documentType) ? value.documentType : '',
    text: boundedText(value.text, DEFAULT_PER_DOCUMENT_CHARACTER_BUDGET),
    pageCount: Math.max(0, Math.trunc(Number(value.pageCount) || 0)) || null,
    extractedPageCount: Math.max(0, Math.trunc(Number(value.extractedPageCount) || 0)) || null,
    truncated: value.truncated === true,
    limitation: boundedText(value.limitation, 1_000),
    observedAt: boundedText(value.observedAt, 80),
  };
  const observationDigest = boundedText(value.observationDigest, 64).toLowerCase();
  if (!normalized.assetId || !normalized.contentHash || !normalized.documentType
    || !normalized.text || !normalized.limitation || !normalized.observedAt
    || !DIGEST_RE.test(observationDigest)
    || digest(observationPayload(normalized)) !== observationDigest) return null;
  if (attachment) {
    const attachmentHash = normalizedContentHash(attachment.contentHash);
    const attachmentRevision = Math.max(1, Math.trunc(Number(attachment.contentRevision) || 0));
    if (boundedText(attachment.assetId, 180) !== normalized.assetId
      || (attachmentHash && attachmentHash !== normalized.contentHash)
      || attachmentRevision !== normalized.contentRevision) return null;
  }
  return { ...normalized, observationDigest };
}

async function readBoundedFile(filename, maximumBytes = MAX_DOCUMENT_BYTES) {
  const stat = await fs.promises.stat(filename);
  if (!stat.isFile()) throw new Error('文档素材不是可读取文件');
  const handle = await fs.promises.open(filename, 'r');
  try {
    const length = Math.min(stat.size, maximumBytes);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return { buffer: buffer.subarray(0, bytesRead), byteTruncated: stat.size > bytesRead };
  } finally {
    await handle.close();
  }
}

async function hashFile(filename) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filename);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function normalizeExtractedText(value, maximumCharacters) {
  return boundedText(String(value || '')
    .replace(/^\uFEFF/u, '')
    .replace(/[\t ]+\n/gu, '\n')
    .replace(/\n{4,}/gu, '\n\n\n'), maximumCharacters);
}

async function extractPlainText(filename, maximumCharacters) {
  const { buffer, byteTruncated } = await readBoundedFile(filename);
  const nulBytes = [...buffer.subarray(0, Math.min(buffer.length, 32_768))].filter((byte) => byte === 0).length;
  if (nulBytes > 8) throw new Error('文本文件编码无法可靠识别');
  const source = buffer.toString('utf8');
  const text = normalizeExtractedText(source, maximumCharacters);
  if (!text) throw new Error('文档中没有可读取的文本');
  return {
    text,
    pageCount: null,
    extractedPageCount: null,
    truncated: byteTruncated || source.trim().length > text.length,
  };
}

async function extractPdfText(filename, maximumCharacters) {
  const { buffer, byteTruncated } = await readBoundedFile(filename);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const document = await task.promise;
  const pageCount = document.numPages;
  const pages = [];
  let extractedPageCount = 0;
  let characterCount = 0;
  let truncated = byteTruncated;
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (characterCount >= maximumCharacters) {
        truncated = true;
        break;
      }
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => {
        const text = typeof item?.str === 'string' ? item.str : '';
        return `${text}${item?.hasEOL ? '\n' : ' '}`;
      }).join('').replace(/[ \t]+\n/gu, '\n').replace(/[ \t]{2,}/gu, ' ').trim();
      extractedPageCount += 1;
      if (!pageText) continue;
      const remaining = maximumCharacters - characterCount;
      const clipped = pageText.slice(0, remaining);
      pages.push(`[第 ${pageNumber} 页]\n${clipped}`);
      characterCount += clipped.length;
      if (clipped.length < pageText.length) truncated = true;
    }
  } finally {
    await document.destroy();
  }
  const text = normalizeExtractedText(pages.join('\n\n'), maximumCharacters);
  if (!text) throw new Error('PDF 中没有可提取的文字；扫描件请先转成图片或完成 OCR');
  return {
    text,
    pageCount,
    extractedPageCount,
    truncated: truncated || extractedPageCount < pageCount,
  };
}

async function readCreatorLongScriptDocument(attachment, options = {}) {
  const type = documentType(attachment);
  if (!type) return null;
  const filename = path.resolve(String(attachment.mediaUrl || ''));
  const maximumCharacters = Math.max(1_000, Math.min(
    MAX_LONG_SCRIPT_CHARACTERS,
    Number(options.maximumCharacters) || MAX_LONG_SCRIPT_CHARACTERS,
  ));
  let source = '';
  let truncated = false;
  if (type === 'pdf') {
    const extracted = await extractPdfText(filename, maximumCharacters + 1);
    source = extracted.text;
    truncated = extracted.truncated || source.length > maximumCharacters;
  } else {
    const { buffer, byteTruncated } = await readBoundedFile(filename);
    const nulBytes = [...buffer.subarray(0, Math.min(buffer.length, 32_768))]
      .filter((byte) => byte === 0).length;
    if (nulBytes > 8) throw new Error('文本文件编码无法可靠识别');
    source = buffer.toString('utf8').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
    truncated = byteTruncated || source.length > maximumCharacters;
  }
  if (truncated) {
    const error = new Error('长剧本文档超过 2,000,000 字符或 8 MiB，请拆成同一项目内的多个剧本卷后再导入');
    error.code = 'CREATOR_LONG_SCRIPT_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  if (!source.trim()) throw new Error('文档中没有可读取的文本');
  const actualHash = await hashFile(filename);
  const expectedHash = normalizedContentHash(
    attachment.contentHash || attachment.documentObservation?.contentHash,
  );
  if (expectedHash && expectedHash !== actualHash) {
    const error = new Error('长剧本文档内容已经变化，请重新选择文件');
    error.code = 'CREATOR_DOCUMENT_CHANGED';
    error.status = 409;
    throw error;
  }
  return {
    source,
    documentType: type,
    contentHash: actualHash,
    characterCount: source.length,
  };
}

async function createCreatorDocumentObservation(attachment, options = {}) {
  const type = documentType(attachment);
  if (!type) return null;
  const filename = path.resolve(String(attachment.mediaUrl || ''));
  const maximumCharacters = Math.max(1_000, Math.min(
    DEFAULT_PER_DOCUMENT_CHARACTER_BUDGET,
    Number(options.maximumCharacters) || DEFAULT_PER_DOCUMENT_CHARACTER_BUDGET,
  ));
  const extracted = type === 'pdf'
    ? await extractPdfText(filename, maximumCharacters)
    : await extractPlainText(filename, maximumCharacters);
  const fileHash = normalizedContentHash(attachment.contentHash)
    || await hashFile(filename);
  const value = {
    schema: CREATOR_DOCUMENT_OBSERVATION_SCHEMA,
    assetId: boundedText(attachment.assetId, 180),
    contentRevision: Math.max(1, Math.trunc(Number(attachment.contentRevision) || 0)),
    contentHash: fileHash,
    mimeType: boundedText(attachment.mimeType, 120).toLowerCase() || (type === 'pdf' ? 'application/pdf' : 'text/plain'),
    documentType: type,
    text: extracted.text,
    pageCount: extracted.pageCount,
    extractedPageCount: extracted.extractedPageCount,
    truncated: extracted.truncated,
    limitation: extracted.truncated
      ? '已读取文档正文，但因单轮上下文上限只使用了前部内容；回复不得假装看过未读取部分。'
      : '已读取该文档的可提取文字；图片、复杂版式、批注和扫描件内容不在本次文字观察范围内。',
    observedAt: typeof options.now === 'function' ? options.now() : new Date().toISOString(),
  };
  value.observationDigest = digest(observationPayload(value));
  return normalizeCreatorDocumentObservation(value, { ...attachment, contentHash: fileHash });
}

async function groundCreatorDocumentAttachments(attachments = [], options = {}) {
  const source = Array.isArray(attachments) ? attachments : [];
  const documentCount = source.filter((attachment) => attachment?.kind === 'file' && documentType(attachment)).length;
  if (!documentCount) return { attachments: source, observations: [] };
  const maximumTotalCharacters = Math.max(4_000, Number(options.maximumTotalCharacters)
    || DEFAULT_TOTAL_CHARACTER_BUDGET);
  let remainingCharacters = maximumTotalCharacters;
  let remainingDocuments = documentCount;
  const grounded = [];
  const observations = [];
  for (const attachment of source) {
    if (attachment?.kind !== 'file' || !documentType(attachment)) {
      grounded.push(attachment);
      continue;
    }
    const existing = normalizeCreatorDocumentObservation(attachment.documentObservation, attachment);
    if (existing) {
      observations.push(existing);
      grounded.push({ ...attachment, documentObservation: existing });
      remainingCharacters = Math.max(0, remainingCharacters - existing.text.length);
      remainingDocuments -= 1;
      continue;
    }
    const fairShare = Math.max(1_000, Math.min(
      DEFAULT_PER_DOCUMENT_CHARACTER_BUDGET,
      Math.floor(remainingCharacters / Math.max(1, remainingDocuments)),
    ));
    let observation;
    try {
      observation = await createCreatorDocumentObservation(attachment, {
        ...options,
        maximumCharacters: fairShare,
      });
    } catch (error) {
      const wrapped = new Error(`${boundedText(attachment.title, 160) || '文档'} 无法读取：${boundedText(error?.message, 300) || '未知错误'}`);
      wrapped.code = 'CREATOR_DOCUMENT_READ_FAILED';
      throw wrapped;
    }
    if (!observation) {
      const error = new Error(`${boundedText(attachment.title, 160) || '文档'} 的格式暂不支持读取`);
      error.code = 'CREATOR_DOCUMENT_FORMAT_UNSUPPORTED';
      throw error;
    }
    observations.push(observation);
    grounded.push({ ...attachment, documentObservation: observation });
    remainingCharacters = Math.max(0, remainingCharacters - observation.text.length);
    remainingDocuments -= 1;
  }
  return { attachments: grounded, observations };
}

module.exports = {
  CREATOR_DOCUMENT_OBSERVATION_SCHEMA,
  createCreatorDocumentObservation,
  documentType,
  groundCreatorDocumentAttachments,
  normalizeCreatorDocumentObservation,
  readCreatorLongScriptDocument,
};
