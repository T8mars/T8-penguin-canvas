'use strict';
// Self-authored deterministic scene bytes, no downloaded/user assets.
// Format evidence: https://github.com/antimatter15/splat/blob/main/main.js
// and https://github.com/mkkellogg/GaussianSplats3D/blob/main/src/loaders/SplatBuffer.js
// KSPLAT uses the official v0.1 uncompressed, one-section, SH-degree0 layout.
function gaussianFixture(format, count = 3) {
  if (!['splat', 'ksplat'].includes(format) || !Number.isSafeInteger(count) || count < 1 || count > 100000) throw Error('Invalid verification fixture');
  const stride = format === 'splat' ? 32 : 44, offset = format === 'splat' ? 0 : 5120;
  const bytes = Buffer.alloc(offset + count * stride);
  if (format === 'ksplat') {
    bytes[1] = 1; bytes.writeUInt32LE(1, 4); bytes.writeUInt32LE(1, 8); bytes.writeUInt32LE(count, 12); bytes.writeUInt32LE(count, 16);
    bytes.writeUInt32LE(count, 4096); bytes.writeUInt32LE(count, 4100); bytes.writeUInt32LE(count * stride, 4096 + 28);
  }
  const small = [[-.5, 0, 0, 245, 30, 30], [.5, 0, 0, 30, 245, 30], [0, .65, 0, 30, 30, 245]];
  for (let index = 0; index < count; index++) {
    const point = count === 3 ? small[index] : [(index % 100) / 25 - 2, Math.floor(index / 100) % 100 / 25 - 2, Math.floor(index / 10000) / 20 - .25, index % 3 === 0 ? 245 : 30, index % 3 === 1 ? 245 : 30, index % 3 === 2 ? 245 : 30];
    const base = offset + index * stride;
    for (let axis = 0; axis < 3; axis++) { bytes.writeFloatLE(point[axis], base + axis * 4); bytes.writeFloatLE(count === 3 ? .22 : .008, base + 12 + axis * 4); }
    if (format === 'splat') { bytes.set([...point.slice(3), 255], base + 24); bytes.set([255, 128, 128, 128], base + 28); }
    else { bytes.writeFloatLE(1, base + 24); bytes.set([...point.slice(3), 255], base + 40); }
  }
  return bytes;
}
module.exports = { gaussianFixture };
