const test=require('node:test'),assert=require('node:assert/strict'),yazl=require('yazl');
const {inspectGlb,prepareGlbBuffer,validateSvgBuffer,isSvgBuffer}=require('../backend/src/providers/providerOutputFormats');
function glb(){const text=JSON.stringify({asset:{version:'2.0'},buffers:[{byteLength:4}],meshes:[{primitives:[]}]}),json=Buffer.from(text+' '.repeat((4-text.length%4)%4)),buf=Buffer.alloc(12+8+json.length+12);buf.write('glTF');buf.writeUInt32LE(2,4);buf.writeUInt32LE(buf.length,8);buf.writeUInt32LE(json.length,12);buf.writeUInt32LE(0x4e4f534a,16);json.copy(buf,20);buf.writeUInt32LE(4,20+json.length);buf.writeUInt32LE(0x004e4942,24+json.length);return buf;}
test('GLB validation checks full lengths and ZIP extraction preserves original archive bytes',async()=>{
 const bytes=glb();assert.equal(inspectGlb(bytes).asset.version,'2.0');assert.throws(()=>inspectGlb(bytes.subarray(0,-1)),/header/);
 const zip=new yazl.ZipFile();zip.addBuffer(bytes,'nested/model.glb');zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);const archive=Buffer.concat(chunks),result=await prepareGlbBuffer(archive);
 assert.deepEqual(result.buffer,bytes);assert.deepEqual(result.archive,archive);assert.deepEqual((await prepareGlbBuffer(bytes)).buffer,bytes);
 await assert.rejects(prepareGlbBuffer(Buffer.from('<html>error</html>')),/neither GLB/);
});
test('SVG preserves static vector bytes and rejects active or external content before materialization',async()=>{
 const source=Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect width="64" height="64" fill="url( #g )"/></svg>');
 assert.equal(isSvgBuffer(source),true);await validateSvgBuffer(source);
 for(const extra of ['<script>alert(1)</script>','<image href="https://invalid.example/a.png"/>','<rect onload="alert(1)"/>','<style>@import "https://invalid.example/style.css";</style>'])await assert.rejects(validateSvgBuffer(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">${extra}</svg>`)),/static drawing/);
 assert.equal(isSvgBuffer(Buffer.from('<html><svg></svg></html>')),false);
});
test('Creator SVG export validates XML-prefixed original vectors before committing files',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{CreatorActionExecutor}=require('../backend/src/services/creatorActionExecutor'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'t8-creator-vector-'));
 let bytes=Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="blue"/></svg>');
 const executor=new CreatorActionExecutor({config:{OUTPUT_DIR:scratch},remoteMediaDownload:async(_url,target)=>{fs.writeFileSync(target,bytes,{flag:'wx'});return {byteSize:bytes.length,contentType:'image/svg+xml'};}});
 try{
  const saved=await executor.download('https://provider.example/output.svg','image','test-vector');assert.equal(saved.extension,'svg');assert.deepEqual(fs.readFileSync(saved.absolute),bytes);fs.unlinkSync(saved.absolute);
  bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>');await assert.rejects(executor.download('https://provider.example/output.svg','image','test-vector'),/static drawing/);assert.deepEqual(fs.readdirSync(scratch),[]);
 }finally{assert.equal(path.dirname(scratch),path.resolve(os.tmpdir()));fs.rmSync(scratch,{recursive:true,force:true});}
});
