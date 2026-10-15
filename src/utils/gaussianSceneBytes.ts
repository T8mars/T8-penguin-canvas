const PLY_SCALARS: Record<string, { bytes: number; method: string; min?: number; max?: number }> = {
  char: { bytes: 1, method: 'setInt8', min: -128, max: 127 }, uchar: { bytes: 1, method: 'setUint8', min: 0, max: 255 },
  short: { bytes: 2, method: 'setInt16', min: -32768, max: 32767 }, ushort: { bytes: 2, method: 'setUint16', min: 0, max: 65535 },
  int: { bytes: 4, method: 'setInt32', min: -2147483648, max: 2147483647 }, uint: { bytes: 4, method: 'setUint32', min: 0, max: 4294967295 },
  float: { bytes: 4, method: 'setFloat32' }, double: { bytes: 8, method: 'setFloat64' },
};
const aliases: Record<string, string> = { int8: 'char', uint8: 'uchar', int16: 'short', uint16: 'ushort', int32: 'int', uint32: 'uint', float32: 'float', float64: 'double' };

/** Spark accepts binary PLY. Convert ASCII point/Gaussian PLY automatically.
 * Yield in bounded chunks so importing a large ASCII file does not monopolize
 * the UI thread, and check cancellation before allocating/after every yield.
 */
export async function prepareGaussianSceneBytes(buffer: ArrayBuffer, signal?: AbortSignal): Promise<ArrayBuffer> {
  signal?.throwIfAborted();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 112 || bytes[1] !== 108 || bytes[2] !== 121) return buffer;
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const end = /(?:^|\r?\n)end_header\r?\n/.exec(prefix);
  if (!end) throw Error('PLY header is missing or too large');
  const header = prefix.slice(0, end.index + end[0].length);
  if (!/^format ascii 1\.0\r?$/m.test(header)) return buffer;
  let count = -1, element = '', stride = 0;
  const properties: Array<{ name: string; scalar: typeof PLY_SCALARS[string]; offset: number }> = [];
  for (const line of header.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'element') {
      element = parts[1]; const n = Number(parts[2]);
      if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid PLY element count');
      if (element === 'vertex') { if (count >= 0) throw Error('Duplicate PLY vertex element'); count = n; }
      else if (n > 0) throw Error('This ASCII PLY contains mesh/list elements, not a Gaussian point scene');
    }
    if (parts[0] === 'property' && element === 'vertex') {
      const scalar = PLY_SCALARS[aliases[parts[1]] || parts[1]];
      if (!scalar || parts.length !== 3) throw Error('Unsupported ASCII PLY property');
      properties.push({ name: parts[2], scalar, offset: stride }); stride += scalar.bytes;
    }
  }
  if (count < 1 || !['x', 'y', 'z'].every((key) => properties.some((p) => p.name === key))) throw Error('PLY has no valid point positions');
  const bodyOffset = new TextEncoder().encode(header).length;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(bodyOffset));
  const tokenCount = count * properties.length;
  const payloadBytes = count * stride;
  // Each scalar requires at least one character; reject impossible headers
  // before an untrusted count can trigger a huge allocation.
  if (!Number.isSafeInteger(payloadBytes) || !Number.isSafeInteger(tokenCount) || tokenCount > text.length) throw Error('PLY point data is truncated');
  const binaryHeader = new TextEncoder().encode(header.replace(/^format ascii 1\.0\r?$/m, 'format binary_little_endian 1.0'));
  signal?.throwIfAborted();
  const out = new Uint8Array(binaryHeader.length + payloadBytes); out.set(binaryHeader);
  const view = new DataView(out.buffer, binaryHeader.length);
  const tokens = /\S+/g;
  for (let point = 0; point < count; point++) {
    for (const property of properties) {
      const token = tokens.exec(text); if (!token) throw Error('PLY point data is truncated');
      const value = Number(token[0]), scalar = property.scalar;
      if (!Number.isFinite(value) || scalar.method === 'setFloat32' && Math.abs(value) > 3.402823466e38
        || scalar.min !== undefined && (!Number.isInteger(value) || value < scalar.min || value > scalar.max!)) throw Error('Invalid PLY scalar');
      (view[scalar.method as keyof DataView] as (offset: number, value: number, littleEndian?: boolean) => void).call(view, point * stride + property.offset, value, true);
    }
    if (point > 0 && point % 4096 === 0) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
  }
  if (tokens.exec(text)) throw Error('PLY data exceeds declared point count');
  return out.buffer;
}
