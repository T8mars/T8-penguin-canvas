'use strict';
const yauzl = require('yauzl');
const MAX_GLB_BYTES = 512 * 1024 * 1024;
function inspectGlb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.toString('ascii',0,4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw new Error('Invalid or incomplete GLB header');
  let offset = 12, document = null, binaryBytes = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error('Incomplete GLB chunk');
    const length = buffer.readUInt32LE(offset), type = buffer.readUInt32LE(offset+4);
    if (length % 4 || offset+8+length > buffer.length) throw new Error('Invalid GLB chunk length');
    if (offset === 12) {
      if (type !== 0x4e4f534a || length > 64*1024*1024) throw new Error('Invalid GLB JSON chunk');
      document = JSON.parse(buffer.subarray(offset+8,offset+8+length).toString('utf8').trim());
    } else if (type === 0x004e4942) binaryBytes += length;
    offset += 8+length;
  }
  if (document?.asset?.version !== '2.0') throw new Error('Invalid GLB asset version');
  for (const item of [...(document.buffers || []),...(document.images || [])]) if (item.uri && !/^data:/i.test(item.uri)) throw new Error('GLB must be self-contained');
  for (const item of document.buffers || []) if (!item.uri && (!Number.isSafeInteger(item.byteLength) || item.byteLength > binaryBytes)) throw new Error('Incomplete GLB binary buffer');
  return document;
}
async function prepareGlbBuffer(buffer) {
  if (buffer.subarray(0,4).toString('ascii') === 'glTF') { inspectGlb(buffer); return { buffer, archive: null }; }
  if (!buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) throw new Error('Provider result is neither GLB nor ZIP');
  return new Promise((resolve,reject) => {
    yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(error,zip) => {
      if (error) return reject(error);
      let entries = 0, settled = false;
      const finish = (error,result) => { if (settled) return; settled = true; zip.close(); error ? reject(error) : resolve(result); };
      zip.on('error',error=>finish(error)); zip.on('end',()=>finish(new Error('3D ZIP contains no self-contained GLB')));
      zip.on('entry',entry=>{
        if (++entries > 10000) return finish(new Error('Too many ZIP entries'));
        if (!/\.glb$/i.test(entry.fileName) || /\/$/.test(entry.fileName)) return zip.readEntry();
        if (entry.generalPurposeBitFlag & 1 || entry.uncompressedSize > MAX_GLB_BYTES) return finish(new Error('GLB ZIP member is encrypted or too large'));
        zip.openReadStream(entry,(error,stream)=>{
          if (error) return finish(error);
          const chunks=[]; let size=0;
          stream.on('error',error=>finish(error));
          stream.on('data',chunk=>{size+=chunk.length;if(size>MAX_GLB_BYTES){stream.destroy();finish(new Error('GLB ZIP member exceeds size limit'));}else chunks.push(chunk);});
          stream.on('end',()=>{try {if(size!==entry.uncompressedSize)throw new Error('Truncated ZIP member');const model=Buffer.concat(chunks);inspectGlb(model);finish(null,{buffer:model,archive:buffer});}catch(error){finish(error);}});
        });
      });
      zip.readEntry();
    });
  });
}
function isSvgBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const prefix = buffer.subarray(0,65536).toString('utf8').replace(/^\uFEFF/,'').trimStart().replace(/^<\?xml[^?]*\?>\s*/i,'').replace(/^(?:<!--[\s\S]*?-->\s*)+/,'');
  return /^<svg(?:\s|>)/i.test(prefix);
}
async function validateSvgBuffer(buffer) {
  if (!isSvgBuffer(buffer)) throw new Error('Invalid SVG root');
  const text=buffer.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|@import/i.test(text)
    || [...text.matchAll(/(?:href\s*=\s*['"])([^'"]*)['"]/gi)].some(m=>!m[1].trim().startsWith('#'))
    || [...text.matchAll(/url\(([^)]*)\)/gi)].some(m=>!m[1].trim().replace(/^['"]|['"]$/g,'').trim().startsWith('#'))) throw new Error('SVG must be a self-contained static drawing');
  const sharp=require('sharp');
  const decoded=await sharp(buffer,{failOn:'error',limitInputPixels:64*1024*1024}).png().toBuffer();
  if (!decoded.length) throw new Error('SVG failed to render');
}
module.exports = { inspectGlb, prepareGlbBuffer, isSvgBuffer, validateSvgBuffer };
