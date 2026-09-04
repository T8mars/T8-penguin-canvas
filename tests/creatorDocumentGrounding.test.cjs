'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CREATOR_DOCUMENT_OBSERVATION_SCHEMA,
  createCreatorDocumentObservation,
  documentType,
  groundCreatorDocumentAttachments,
  normalizeCreatorDocumentObservation,
  readCreatorLongScriptDocument,
} = require('../backend/src/services/creatorDocumentGrounding.js');

function escapePdfText(value) {
  return String(value).replace(/\\/gu, '\\\\').replace(/\(/gu, '\\(').replace(/\)/gu, '\\)');
}

function minimalPdf(text = '') {
  const content = text
    ? `BT /F1 18 Tf 50 750 Td (${escapePdfText(text)}) Tj ET`
    : 'q Q';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, 'binary');
}

async function withTempDirectory(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 't8-creator-document-'));
  t.after(async () => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

function attachment(filename, overrides = {}) {
  return {
    assetId: 'asset-document-1',
    kind: 'file',
    title: path.basename(filename),
    mimeType: 'text/plain',
    mediaUrl: filename,
    contentRevision: 1,
    contentHash: '',
    ...overrides,
  };
}

test('Creator document grounding reads TXT and Markdown with digest-backed observations', async (t) => {
  const directory = await withTempDirectory(t);
  const textFile = path.join(directory, 'brief.txt');
  const markdownFile = path.join(directory, 'notes.md');
  await fs.promises.writeFile(textFile, '\uFEFF主角在雨夜站台等车。\n结尾保留晨光。', 'utf8');
  await fs.promises.writeFile(markdownFile, '# 视觉方向\n\n冷蓝环境，暖色列车灯。', 'utf8');

  assert.equal(documentType(attachment(textFile)), 'text');
  assert.equal(documentType(attachment(markdownFile, { mimeType: 'text/markdown' })), 'markdown');

  const grounded = await groundCreatorDocumentAttachments([
    attachment(textFile),
    attachment(markdownFile, { assetId: 'asset-document-2', mimeType: 'text/markdown' }),
  ], { now: () => '2026-09-01T00:00:00.000Z' });

  assert.equal(grounded.observations.length, 2);
  assert.match(grounded.observations[0].text, /雨夜站台/u);
  assert.match(grounded.observations[1].text, /冷蓝环境/u);
  for (const observation of grounded.observations) {
    assert.equal(observation.schema, CREATOR_DOCUMENT_OBSERVATION_SCHEMA);
    assert.match(observation.contentHash, /^[a-f0-9]{64}$/u);
    assert.match(observation.observationDigest, /^[a-f0-9]{64}$/u);
    assert.ok(normalizeCreatorDocumentObservation(observation));
  }
});

test('Creator document grounding extracts text from a real PDF page', async (t) => {
  const directory = await withTempDirectory(t);
  const filename = path.join(directory, 'brief.pdf');
  await fs.promises.writeFile(filename, minimalPdf('Creator PDF reference line'));

  const observation = await createCreatorDocumentObservation(attachment(filename, {
    mimeType: 'application/pdf',
  }), { now: () => '2026-09-01T00:00:00.000Z' });

  assert.equal(observation.documentType, 'pdf');
  assert.equal(observation.pageCount, 1);
  assert.equal(observation.extractedPageCount, 1);
  assert.match(observation.text, /Creator PDF reference line/u);
  assert.match(observation.text, /第 1 页/u);
});

test('Creator document grounding reports truncation instead of pretending it read the full file', async (t) => {
  const directory = await withTempDirectory(t);
  const filename = path.join(directory, 'long.txt');
  await fs.promises.writeFile(filename, `开头事实。${'镜头描述。'.repeat(800)}`, 'utf8');

  const observation = await createCreatorDocumentObservation(attachment(filename), {
    maximumCharacters: 1_000,
    now: () => '2026-09-01T00:00:00.000Z',
  });

  assert.equal(observation.truncated, true);
  assert.ok(observation.text.length <= 1_000);
  assert.match(observation.limitation, /只使用了前部内容/u);
});

test('Creator long-script import rereads the verified full managed document beyond the 30k LLM window', async (t) => {
  const directory = await withTempDirectory(t);
  const filename = path.join(directory, 'full-long-script.txt');
  const source = [
    '第一场：长夜',
    '甲'.repeat(31_000),
    '第二场：黎明',
    '最后一句必须被导入。',
  ].join('\n');
  await fs.promises.writeFile(filename, source, 'utf8');
  const sourceAttachment = attachment(filename);
  const observation = await createCreatorDocumentObservation(sourceAttachment);
  assert.equal(observation.truncated, true);
  assert.ok(observation.text.length <= 30_000);
  assert.doesNotMatch(observation.text, /第二场：黎明/u);

  const full = await readCreatorLongScriptDocument({
    ...sourceAttachment,
    contentHash: observation.contentHash,
    documentObservation: observation,
  });
  assert.equal(full.source, source);
  assert.equal(full.characterCount, source.length);
  assert.match(full.source, /第二场：黎明/u);
  assert.match(full.source, /最后一句必须被导入/u);
});

test('Creator document grounding reuses a valid cached observation without reopening the file', async (t) => {
  const directory = await withTempDirectory(t);
  const filename = path.join(directory, 'cached.md');
  const sourceAttachment = attachment(filename, { mimeType: 'text/markdown' });
  await fs.promises.writeFile(filename, '# 已确认设定\n保持人物造型一致。', 'utf8');
  const cached = await createCreatorDocumentObservation(sourceAttachment, {
    now: () => '2026-09-01T00:00:00.000Z',
  });
  await fs.promises.rm(filename);

  const result = await groundCreatorDocumentAttachments([{
    ...sourceAttachment,
    contentHash: cached.contentHash,
    documentObservation: cached,
  }]);

  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].observationDigest, cached.observationDigest);
  assert.match(result.observations[0].text, /人物造型一致/u);
});

test('Creator document grounding fails clearly for a PDF without extractable text', async (t) => {
  const directory = await withTempDirectory(t);
  const filename = path.join(directory, 'scan.pdf');
  await fs.promises.writeFile(filename, minimalPdf());

  await assert.rejects(
    () => groundCreatorDocumentAttachments([attachment(filename, { mimeType: 'application/pdf' })]),
    (error) => error?.code === 'CREATOR_DOCUMENT_READ_FAILED'
      && /没有可提取的文字/u.test(error.message)
      && /OCR/u.test(error.message),
  );
});
