'use strict';

// Doubao / the reference ComfyUI client define raw PCM as signed 16-bit LE,
// mono. A sample rate must come from the submitted contract, never a filename.
const rates = new Set(require('../shared/nbLowpriceDoubaoContract.json').audio.iclFields.sample_rate.options.map(Number));
function hasAudioContainerHeader(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const first = buffer.subarray(0, 4).toString('ascii');
  return (first === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE')
    || ['OggS', 'fLaC'].includes(first) || first.startsWith('ID3')
    || buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}
function wrapPcm16MonoWav(buffer, sampleRate, maxBytes = 50 * 1024 * 1024) {
  const rate = Number(sampleRate);
  if (!rates.has(rate)) throw new Error('PCM 采样率不在 Doubao 合同内');
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length % 2 || buffer.length + 44 > maxBytes) {
    throw new Error('PCM 音频为空、帧不完整或超过大小限制');
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(buffer.length + 36, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(buffer.length, 40);
  return Buffer.concat([head, buffer]);
}
module.exports = { wrapPcm16MonoWav, hasAudioContainerHeader };
