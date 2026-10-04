const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const config = require('../backend/src/config');
const { ProjectDatabase, closeProjectDatabase } = require('../backend/src/services/projectDatabase');

test('real HTTP archive, old PUT/operation gates, canonical catalog and legacy hydration preserve identity', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'t8-archive33-http-'));
  const previous = Object.fromEntries(['PROJECT_DB_FILE','PROJECT_DB_BACKUP_FILE','DATA_DIR','CANVAS_FILE'].map((key) => [key,config[key]]));
  let seed, server;
  try {
    const data = path.join(directory,'data'); fs.mkdirSync(data);
    config.PROJECT_DB_FILE = path.join(directory,'project.sqlite3'); config.PROJECT_DB_BACKUP_FILE = `${config.PROJECT_DB_FILE}.backup`;
    config.DATA_DIR = data; config.CANVAS_FILE = path.join(data,'canvas_list.json');
    seed = new ProjectDatabase(config.PROJECT_DB_FILE,{ autoBackup:false });
    const doc = seed.ensureCanvas('http-original',{ name:'Original',nodes:[{id:'text-a',type:'text',data:{text:'immutable'},position:{x:0,y:0}}],edges:[] });
    await seed.close(); seed=null;
    fs.writeFileSync(config.CANVAS_FILE,JSON.stringify([{id:'http-original',name:'stale mirror',createdAt:1,updatedAt:1,nodeCount:0},{id:'legacy-other',name:'Legacy',createdAt:2,updatedAt:2,nodeCount:0}]));
    fs.writeFileSync(path.join(data,'canvas_legacy-other.json'),JSON.stringify({name:'Legacy',nodes:[],edges:[]}));
    const app=express(); app.use(express.json()); app.use('/api/canvas',require('../backend/src/routes/canvas'));
    server=await new Promise((resolve)=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
    const origin=`http://127.0.0.1:${server.address().port}/api/canvas`;
    const send=async(url,method='GET',body)=>{ const response=await fetch(`${origin}${url}`,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}); return { status:response.status,body:await response.json() }; };
    let page;
    for(let attempt=0;attempt<60;attempt++){ page=await send('/directory'); if(!page.body.meta?.partial) break; await new Promise((resolve)=>setTimeout(resolve,30)); }
    assert.equal(page.status,200); assert.equal(page.body.meta.partial,false); assert.equal(page.body.meta.counts.active,2);
    assert.equal(page.body.data.find((item)=>item.id==='http-original').name,'Original');
    const item=(await send('/http-original/metadata')).body.data;
    const input={catalogRevision:item.catalogRevision,baseRevision:item.revision,projectId:item.projectId,operationId:crypto.randomUUID()};
    const archived=await send('/http-original/archive','POST',input);
    assert.equal(archived.status,200); assert.equal(archived.body.data.item.status,'archived');
    const duplicate=await send('/http-original/archive','POST',input); assert.equal(duplicate.body.data.duplicate,true);
    const filtered=await send('/directory?activeId=http-original');
    assert.equal(filtered.body.meta.activeItem.status,'archived'); assert.equal(filtered.body.data.some((value)=>value.id==='http-original'),false);
    assert.equal((await send('/')).body.data.some((value)=>value.id==='http-original'),false);
    const after=(await send('/http-original')).body.data;
    assert.equal(after.revision,doc.revision); assert.equal(after.nodes[0].entityUid,doc.nodes[0].entityUid);
    const oldPut=await send('/http-original','PUT',{...after,name:'wrong'});
    assert.equal(oldPut.status,409); assert.equal(oldPut.body.code,'canvas_archived_read_only');
    const op=await send('/http-original/operations','POST',{expectedRevision:after.revision,operations:[{opId:crypto.randomUUID(),type:'node.move',payload:{nodeId:'text-a',position:{x:100,y:100}}}]});
    assert.equal(op.status,409); assert.equal(op.body.code,'canvas_archived_read_only');
    const profile=await send('/http-original/profile','POST',{pinned:true,opened:true}); assert.equal(profile.status,200); assert.equal(profile.body.data.updatedAt,item.updatedAt);
    const stale=await send('/http-original/restore','POST',{...input,operationId:crypto.randomUUID()}); assert.equal(stale.status,409);
    const restored=await send('/http-original/restore','POST',{...input,catalogRevision:archived.body.data.item.catalogRevision,operationId:crypto.randomUUID()});
    assert.equal(restored.status,200); assert.equal(restored.body.data.item.status,'active');
    const last=(await send('/http-original')).body.data; assert.deepEqual(last.nodes,after.nodes); assert.equal(last.revision,after.revision);
    assert.equal((await send('/directory?limit=201')).status,400); assert.equal((await send('/directory?status=bad')).status,400);
  } finally {
    if(server) await new Promise((resolve)=>server.close(resolve)); if(seed) await seed.close(); await closeProjectDatabase();
    Object.assign(config,previous); assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)); fs.rmSync(directory,{recursive:true,force:true});
  }
});
