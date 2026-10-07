const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const config = require('../backend/src/config');
const { ProjectDatabase, closeProjectDatabase } = require('../backend/src/services/projectDatabase');
const storagePolicy = require('./helpers/startupStoragePolicy32.cjs');

test('real HTTP archive, old PUT/operation gates, canonical catalog and legacy hydration preserve identity', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'t8-archive33-http-'));
  const previous = Object.fromEntries(['PROJECT_DB_FILE','PROJECT_DB_BACKUP_FILE','DATA_DIR','CANVAS_FILE','PROJECT_DB_STORAGE_POLICY_32'].map((key) => [key,config[key]]));
  let seed, server;
  try {
    const data = path.join(directory,'data'); fs.mkdirSync(data);
    config.PROJECT_DB_FILE = path.join(directory,'project.sqlite3'); config.PROJECT_DB_BACKUP_FILE = `${config.PROJECT_DB_FILE}.backup`;
    config.DATA_DIR = data; config.CANVAS_FILE = path.join(data,'canvas_list.json');
    config.PROJECT_DB_STORAGE_POLICY_32 = storagePolicy;
    seed = new ProjectDatabase(config.PROJECT_DB_FILE,{ autoBackup:false, projectDatabaseStoragePolicy32: storagePolicy });
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

test('an already-hydrated directory recovers legacy-only names without overwriting canonical names or archived identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-directory-legacy-names-'));
  const keys = ['PROJECT_DB_FILE','PROJECT_DB_BACKUP_FILE','DATA_DIR','CANVAS_FILE','PROJECT_DB_STORAGE_POLICY_32'];
  const previous = Object.fromEntries(keys.map((key) => [key, config[key]]));
  let seed, server;
  try {
    config.DATA_DIR = root; config.CANVAS_FILE = path.join(root, 'canvas_list.json');
    config.PROJECT_DB_FILE = path.join(root, 'project.sqlite3'); config.PROJECT_DB_BACKUP_FILE = `${config.PROJECT_DB_FILE}.backup`;
    config.PROJECT_DB_STORAGE_POLICY_32 = storagePolicy;
    seed = new ProjectDatabase(config.PROJECT_DB_FILE, { autoBackup: false, projectDatabaseStoragePolicy32: storagePolicy });
    const document = seed.ensureCanvas('legacy-no-name', { nodes: [], edges: [] });
    const archivedDocument = seed.ensureCanvas('legacy-archived', { nodes: [], edges: [] });
    seed.ensureCanvas('named', { name: 'Canonical wins', nodes: [], edges: [] });
    seed.ensureCanvas('explicit-id', { name: 'explicit-id', nodes: [], edges: [] });
    const entry = seed.getCanvasDirectoryEntry(archivedDocument.canvasId);
    const archived = seed.transitionCanvasArchive(archivedDocument.canvasId, 'archive', {
      catalogRevision: entry.catalogRevision, baseRevision: entry.revision, operationId: crypto.randomUUID(),
    }).item;
    seed.completeCanvasDirectoryHydration(); // Reproduce users already upgraded to schema33.
    await seed.close(); seed = null;
    fs.writeFileSync(config.CANVAS_FILE, JSON.stringify([
      { id: document.canvasId, name: '历史中文画布名称', updatedAt: document.updatedAt },
      { id: archivedDocument.canvasId, name: '已归档历史名称', updatedAt: archivedDocument.updatedAt },
      { id: 'named', name: 'Stale mirror name' }, { id: 'explicit-id', name: 'Must not overwrite' },
    ]));
    const app = express(); app.use('/api/canvas', require('../backend/src/routes/canvas'));
    server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const origin = `http://127.0.0.1:${server.address().port}/api/canvas`;
    const read = async (url) => (await fetch(`${origin}${url}`)).json();
    let page;
    for (let attempt = 0; attempt < 60; attempt++) {
      page = await read('/directory');
      if (!page.meta.partial) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(page.meta.partial, false);
    assert.equal(page.data.find((item) => item.id === document.canvasId).name, '历史中文画布名称');
    assert.equal(page.data.find((item) => item.id === 'named').name, 'Canonical wins');
    assert.equal(page.data.find((item) => item.id === 'explicit-id').name, 'explicit-id');
    assert.equal((await read(`/directory?q=${encodeURIComponent('中文画布名称')}`)).data.length, 1);
    const archive = (await read('/directory?status=archived')).data[0];
    assert.equal(archive.name, archivedDocument.canvasId, 'archived documents must not be rewritten by name recovery');
    assert.equal(archive.catalogRevision, archived.catalogRevision);
    for (const original of [document, archivedDocument]) {
      const repaired = (await read(`/${original.canvasId}`)).data;
      assert.equal(repaired.revision, original.revision);
      assert.equal(repaired.updatedAt, original.updatedAt);
      assert.deepEqual(repaired.nodes, original.nodes);
      assert.equal(repaired.entityUid, original.entityUid);
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await seed?.close(); await closeProjectDatabase(); Object.assign(config, previous);
    assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
