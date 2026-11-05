const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('Generated vector preview is sandboxed; save-to-disk preserves SVG/GIF bytes and correct extensions',async()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'t8-vector-save-')),config=require('../backend/src/config');
 const dirs={INPUT_DIR:path.join(scratch,'input'),OUTPUT_DIR:path.join(scratch,'output'),DATA_DIR:path.join(scratch,'data'),THUMBNAILS_DIR:path.join(scratch,'thumbs'),DEFAULT_LOCAL_SAVE_DIR:path.join(scratch,'saved')};
 for(const dir of Object.values(dirs))fs.mkdirSync(dir,{recursive:true});Object.assign(config,dirs,{SETTINGS_FILE:path.join(dirs.DATA_DIR,'settings.json')});fs.writeFileSync(config.SETTINGS_FILE,JSON.stringify({fileSavePath:dirs.DEFAULT_LOCAL_SAVE_DIR}));
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="blue"/></svg>'),gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
 const {commitMaterializedOutputBuffer}=require('../backend/src/services/materializedOutputStore');
 const vector=commitMaterializedOutputBuffer({outputDir:config.OUTPUT_DIR,buffer:svg,prefix:'img',extension:'svg',materializationKey:'vector-test'}),animation=commitMaterializedOutputBuffer({outputDir:config.OUTPUT_DIR,buffer:gif,prefix:'img',extension:'gif',materializationKey:'gif-test'});
 const express=require('express'),app=express(),router=require('../backend/src/routes/files');app.use('/api/files',router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const preview=await fetch(base+'/api/files/vector/'+vector.filename);assert.equal(preview.status,200);assert.match(preview.headers.get('content-security-policy'),/sandbox/);assert.equal(preview.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),svg);
  assert.equal((await fetch(base+'/api/files/vector/uncommitted.svg')).status,404);
  for(const [item,bytes,ext]of [[vector,svg,'svg'],[animation,gif,'gif']]){
   const response=await fetch(base+'/api/files/save-to-disk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'/files/output/'+item.filename,filename:'original.png',kind:'image'})}),body=await response.json();
   assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.success,true);const name=body.data?.filename||body.filename;assert.ok(name&&name.endsWith('.'+ext));assert.deepEqual(fs.readFileSync(path.join(dirs.DEFAULT_LOCAL_SAVE_DIR,name)),bytes);
  }
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));const resolved=path.resolve(scratch);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));fs.rmSync(resolved,{recursive:true,force:true});}
});
