'use strict';
// Production React handlers + production local image routes + a fresh SQLite
// canvas only. Never opens an existing user's database or calls a Provider.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/artcraft-ux-verification');
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const { app, BrowserWindow } = require('electron'), scratch = process.env.T8_CREATIVE_STORAGE_SCRATCH;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-creative-storage-')) throw Error('Fresh temporary profile required');
  app.setPath('userData', scratch); app.on('window-all-closed', () => {}); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu');
  process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '256MiB';
  process.env.T8PC_PACKAGED = '0'; process.env.T8PC_DEV_DATA_ROOT = path.join(scratch, 'isolated-backend');
  process.env.T8PC_DEV_PROJECT_DB_STORAGE_PROFILE = 'acceptance-small-v1'; process.env.T8_COLLAB_MANAGEMENT_TOKEN = crypto.randomBytes(32).toString('base64url');
  let win, server, database, deadline, phase = 'initialize', releaseCrop, held = 0, cropMode = 'normal', crops = 0, finishedCrops = 0, uploads = 0, providers = 0;
  try {
    const config = require('../backend/src/config'), sharp = require('sharp');
    assert.equal(path.dirname(path.dirname(config.PROJECT_DB_FILE)), path.join(scratch, 'isolated-backend'));
    for (const directory of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR]) { assert.ok(path.resolve(directory).startsWith(path.resolve(scratch) + path.sep)); fs.mkdirSync(directory, { recursive: true }); }
    const original = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#37b8b0' } }).png().toBuffer();
    fs.writeFileSync(path.join(config.INPUT_DIR, 'original.png'), original);
    const url = '/files/input/original.png', canvasId = 'creative-storage-' + crypto.randomUUID();
    const items = [{ id: 'slot-a', kind: 'image', url, name: 'A' }, { id: 'slot-b', kind: 'image', url, name: 'B repeated slot' }];
    const layers = [{ id: 'layer-1', kind: 'layer', name: 'Keep editable', elements: [{ id: 'shape-1', kind: 'rect', x: 10, y: 10, w: 30, h: 20, color: '#37b8b0', size: 2, fillMode: 'fill' }] }];
    const nodes = [
      { id: 'materials', entityUid: crypto.randomUUID(), type: 'material-set', position: { x: 5, y: 5 }, data: { materialSetKind: 'image', materialSetItems: items, imageUrls: [url, url] } },
      { id: 'board', entityUid: crypto.randomUUID(), type: 'drawing-board', position: { x: 500, y: 5 }, selected: true, data: { boardWidth: 160, boardHeight: 120, boardLayers: layers, outputImageUrl: url, status: 'success' } },
    ];
    const storage = require('../backend/src/services/projectRuntime'); database = storage.getProjectStorageRuntime(config).database;
    database.ensureCanvas(canvasId, { nodes, edges: [] }, require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
    const express = require('express'), httpApp = express(); httpApp.use(express.json({ limit: '20mb' }));
    // Fault/latency injection only wraps the real local route, never its result.
    httpApp.use('/api/image/crop', async (_req, res, next) => { crops++; res.once('finish', () => finishedCrops++); if (cropMode === 'fail') { cropMode = 'normal'; return res.status(503).json({ success: false, error: 'Fixture local operation unavailable' }); }
      if (cropMode === 'hold') { cropMode = 'normal'; held++; await new Promise(resolve => { releaseCrop = resolve; }); } next(); });
    httpApp.use('/api/files/upload-base64', (_req, _res, next) => { uploads++; next(); });
    httpApp.use('/api/image', require('../backend/src/routes/imageOps')); httpApp.use('/api/files', require('../backend/src/routes/files'));
    httpApp.use('/api/proxy', (_req, res) => { providers++; res.sendStatus(500); });
    httpApp.use('/files/input', express.static(config.INPUT_DIR)); httpApp.use('/files/output', express.static(config.OUTPUT_DIR));
    httpApp.get('/fixture/graph', (_req, res) => res.json(database.getCanvas(canvasId)));
    httpApp.post('/fixture/save', (req, res) => { const current = database.getCanvas(canvasId); const saved = database.saveCanvasSnapshot(canvasId, req.body, { expectedRevision: current.revision }); res.json({ success: true, revision: saved.revision }); });
    const bundle = await require('esbuild').build({ bundle: true, write: false, outdir: path.join(scratch, 'bundle'), format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
      stdin: { sourcefile: 'creative-storage-fixture.tsx', resolveDir: root, loader: 'tsx', contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import {ReactFlow,ReactFlowProvider,useReactFlow} from '@xyflow/react';import '@xyflow/react/dist/style.css';
        import i18next from 'i18next';import {initReactI18next} from 'react-i18next';
        import Materials from './src/components/nodes/MaterialSetNode';import Board from './src/components/nodes/DrawingBoardNode';
        import {CanvasNodeRenderModeProvider} from './src/components/CanvasNodeRenderMode';import {useCanvasStore} from './src/stores/canvas';
        import {creativeUxZh,creativeUxEn} from './src/i18n/creativeUxCatalog';
        i18next.use(initReactI18next).init({lng:'zh',resources:{zh:{creativeUx:creativeUxZh},en:{creativeUx:creativeUxEn}}});
        const canvasId=${JSON.stringify(canvasId)};useCanvasStore.setState({activeId:canvasId,canvases:[{id:canvasId,name:'Fresh creative storage',status:'active'}] as any});
        let rf:any;const errors:any[]=[];window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
        function Probe(){rf=useReactFlow();return null}function WrappedBoard(props){return <CanvasNodeRenderModeProvider mode="hot"><Board {...props}/></CanvasNodeRenderModeProvider>}
        const graph=await fetch('/fixture/graph').then(r=>r.json());const types={'material-set':Materials,'drawing-board':WrappedBoard,output:()=>null,upload:()=>null};
        flushSync(()=>createRoot(document.getElementById('root')!).render(<ReactFlowProvider><ReactFlow defaultNodes={graph.nodes} defaultEdges={graph.edges} nodeTypes={types}/><Probe/></ReactFlowProvider>));
        window.fixture={state:()=>({nodes:rf.getNodes(),errors}),patch:(id,patch)=>rf.setNodes(nodes=>nodes.map(n=>n.id===id?{...n,data:{...n.data,...patch}}:n)),
          archive:value=>useCanvasStore.setState({canvases:[{id:canvasId,name:'Fresh creative storage',status:value?'archived':'active'}] as any}),
          save:async()=>{const r=await fetch('/fixture/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodes:rf.getNodes(),edges:rf.getEdges()})});if(!r.ok)throw Error('Save failed');return r.json()}};
      ` } });
    const tailwind = (await import(require('node:url').pathToFileURL(path.join(root, 'tailwind.config.js')).href)).default;
    const styles = await require('postcss')([require('tailwindcss')({ ...tailwind, content: ['src/components/nodes/DrawingBoardNode.tsx', 'src/components/nodes/MaterialSetNode.tsx', 'src/components/nodes/ImageEditModal.tsx'] })])
      .process(fs.readFileSync(path.join(root, 'src/styles/index.css'), 'utf8').replace(/^@import[^;]+;/gm, ''), { from: path.join(root, 'src/styles/index.css') });
    const core = fs.readFileSync(path.join(root, 'src/styles/theme-core.css'), 'utf8'), css = bundle.outputFiles.filter(f => f.path.endsWith('.css')).map(f => f.text).join('\n');
    httpApp.get('/fixture.js', (_req, res) => res.type('text/javascript').send(Buffer.from(bundle.outputFiles.find(f => f.path.endsWith('.js')).contents)));
    httpApp.get('/', (_req, res) => res.type('html').send(`<!doctype html><html data-theme-mode="dark"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'unsafe-inline';connect-src 'self';img-src 'self' data: blob:"><style>${core}\n${styles.css}\n${css}\n#root{width:1280px;height:900px}body{margin:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`));
    server = httpApp.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
    await app.whenReady(); win = new BrowserWindow({ show: false, width: 1280, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    deadline = setTimeout(() => { process.stderr.write('Creative storage exceeded60s at ' + phase + '\n'); app.exit(1); }, 60000);
    const errors = []; win.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !/favicon/i.test(message)) errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    const frame = () => js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const wait = async code => { for (let n = 0; n < 150; n++) { if (await js(code)) return; if (errors.length) throw Error(errors.join('\n')); await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('UI condition not met at ' + phase + ': ' + code); };
    const click = async text => { await js(`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>!b.closest('[inert]')).find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.title===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Button unavailable: '+${JSON.stringify(text)});b.click()})()`); await frame(); };
    const selectCard = async id => { await js(`document.querySelector('[data-moodboard-card="${id}"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,button:0}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,button:0}))`); await frame(); };
    const input = async (selector, value) => { await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await frame(); };
    const outputCount = () => js('fixture.state().nodes.filter(n=>n.type==="output").length');
    await win.loadURL(origin); await wait('Boolean(window.fixture)'); phase = 'material layout'; await click('素材灵感板'); await wait('Boolean(document.querySelector("[data-material-moodboard]"))');
    await selectCard('slot-a'); await input('input[aria-label="旋转"]', '25'); await click('保存布局'); await wait('!document.querySelector("[data-material-moodboard]")');
    let state = await js('fixture.state()'); assert.equal(state.nodes.find(n => n.id === 'materials').data.materialMoodboard.cards['slot-a'].rotation, 25);
    assert.deepEqual(state.nodes.find(n => n.id === 'materials').data.materialSetItems, items);
    phase = 'conflicting material changes'; await click('素材灵感板'); await wait('Boolean(document.querySelector("[data-material-moodboard]"))'); await selectCard('slot-a'); await input('input[aria-label="旋转"]', '70');
    await js(`fixture.patch('materials',{materialSetItems:fixture.state().nodes.find(n=>n.id==='materials').data.materialSetItems.map(i=>({...i,name:i.id==='slot-a'?'Concurrent rename':i.name}))})`); await frame();
    await click('保存布局'); await wait('Boolean(document.querySelector("[data-material-moodboard] [role=alert]"))');
    assert.equal((await js('fixture.state()')).nodes.find(n => n.id === 'materials').data.materialMoodboard.cards['slot-a'].rotation, 25); await click('取消');
    phase = 'local crop'; await click('编辑输出版本'); await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="应用裁剪"&&!b.disabled)'); await click('应用裁剪'); await wait('fixture.state().nodes.filter(n=>n.type==="output").length===1');
    phase = 'brush pixels'; await click('画板'); await wait('Boolean(document.querySelector(".img-edit-modal img")?.naturalWidth)');
    const paintedAt = await js(`(()=>{const image=document.querySelector('.img-edit-modal img'),r=image.getBoundingClientRect();const x=r.left+r.width*.25,y=r.top+r.height*.5;return{x,y,x2:x+r.width*.45}})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(paintedAt.x), y: Math.round(paintedAt.y), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(paintedAt.x2), y: Math.round(paintedAt.y), movementX: 50, movementY: 0 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(paintedAt.x2), y: Math.round(paintedAt.y), button: 'left', clickCount: 1 });
    await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="应用画板"&&!b.disabled)'); await click('应用画板'); await wait('fixture.state().nodes.filter(n=>n.type==="output").length===2');
    phase = 'composition'; await click('组合'); await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="应用组合"&&!b.disabled)'); await click('应用组合'); await wait('fixture.state().nodes.filter(n=>n.type==="output").length===3');
    state = await js('fixture.state()'); const outputs = state.nodes.filter(n => n.type === 'output');
    assert.deepEqual(outputs.map(n => n.data.imageEditLineage.operation), ['crop', 'brush', 'compose']);
    assert.ok(outputs.every(n => n.data.imageEditLineage.rootUrl === url));
    assert.equal(outputs[1].data.imageEditLineage.parentUrl, outputs[0].data.imageUrl); assert.equal(outputs[2].data.imageEditLineage.parentRevisionId, outputs[1].data.imageEditLineage.id);
    const pixels = await sharp(Buffer.from(await (await fetch(origin + outputs[1].data.imageUrl)).arrayBuffer())).ensureAlpha().raw().toBuffer(); let red = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 180 && pixels[i + 1] < 110 && pixels[i + 2] < 180) red++; assert.ok(red > 20, 'Actual brush output pixels must differ');
    const composed = await sharp(Buffer.from(await (await fetch(origin + outputs[2].data.imageUrl)).arrayBuffer())).metadata();
    const cropped = await sharp(Buffer.from(await (await fetch(origin + outputs[0].data.imageUrl)).arrayBuffer())).metadata(); assert.equal(composed.width, cropped.width); assert.equal(composed.height, cropped.height);
    phase = 'failure keeps versions'; await click('裁剪'); await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="应用裁剪"&&!b.disabled)'); cropMode = 'fail'; await click('应用裁剪');
    await wait('document.body.textContent.includes("Fixture local operation unavailable")'); assert.equal(await outputCount(), 3);
    phase = 'cancel in-flight crop'; cropMode = 'hold'; await click('应用裁剪'); assert.equal(held, 1); await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await wait('!document.querySelector(".img-edit-modal")'); releaseCrop(); releaseCrop = null;
    for (let n = 0; n < 100 && finishedCrops < crops; n++) await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(finishedCrops, crops); await frame(); assert.equal(await outputCount(), 3);
    phase = 'persistent reopen'; await js('fixture.save()'); await win.loadURL(origin + '/?reopen=1'); await wait('Boolean(window.fixture)');
    state = await js('fixture.state()'); assert.deepEqual(state.nodes.find(n => n.id === 'board').data.boardLayers, layers); assert.equal(state.nodes.find(n => n.id === 'board').data.outputImageUrl, url);
    assert.equal(state.nodes.find(n => n.id === 'materials').data.materialSetItems[0].name, 'Concurrent rename'); assert.deepEqual(state.nodes.filter(n => n.type === 'output').map(n => n.data), outputs.map(n => n.data));
    await click('素材灵感板'); await wait('document.querySelector("[data-moodboard-card=slot-a]")?.style.transform==="rotate(25deg)"'); await click('取消');
    await click('编辑输出版本'); await wait('document.querySelector("[data-image-edit-versions] select")?.options.length===4');
    await js('fixture.archive(true)'); await wait('!document.querySelector(".img-edit-modal")');
    const readback = new (require('better-sqlite3'))(config.PROJECT_DB_FILE, { readonly: true, fileMustExist: true });
    try { const snapshot = JSON.parse(readback.prepare('SELECT snapshot_json FROM canvas_documents WHERE canvas_id=?').get(canvasId).snapshot_json); assert.equal(snapshot.nodes.find(n => n.id === 'materials').data.materialMoodboard.cards['slot-a'].rotation, 25); assert.equal(snapshot.nodes.filter(n => n.type === 'output').length, 3); } finally { readback.close(); }
    assert.deepEqual(fs.readFileSync(path.join(config.INPUT_DIR, 'original.png')), original); assert.equal(providers, 0); assert.deepEqual(errors, []); assert.deepEqual(state.errors, []);
    fs.mkdirSync(evidence, { recursive: true }); const report = { passed: true, productionComponents: ['MaterialSetNode', 'DrawingBoardNode', 'ImageEditModal'], productionImageRoutes: true, actualCropsIncludingCancelled: crops, actualBase64Uploads: uploads, actualBrushRedPixels: red,
      duplicateSlotsPreserved: true, concurrentMaterialChangeRejected: true, operations: ['crop', 'brush', 'compose'], failedAndCancelledOperationAddsNoVersion: true, originalBytesAndLayersUnchanged: true, sqliteSaveReload: true, independentSqliteReadback: true, reopenedVersions: 4, providerRequests: providers,
      boundary: 'fresh isolated production routes/SQLite and real ReactFlow node handlers; full App autosave/preflight, live RH and installed-client acceptance not claimed' };
    fs.writeFileSync(path.join(evidence, 'creative-storage-ui.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(scratch, 'completed.json'), '{}'); process.stdout.write(JSON.stringify(report) + '\n');
  } catch (error) { error.message += ' at ' + phase; throw error; }
  finally { clearTimeout(deadline); releaseCrop?.(); win?.destroy(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
    const storage = require('../backend/src/services/projectRuntime'); storage.cancelProjectStorageDeferredWork(); await storage.waitForProjectStorageDeferredWork(); await database?.close(); }
  app.exit(0);
}
function launch() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creative-storage-')), env = { ...process.env, T8_CREATIVE_STORAGE_SCRATCH: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), ['--js-flags=--max-old-space-size=512', __filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.once('exit', code => { const completed = fs.existsSync(path.join(scratch, 'completed.json')); if (code === 0 && completed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-creative-storage-')) fs.rmSync(scratch, { recursive: true, force: true }); else process.stderr.write('Failed fixture retained at ' + scratch + '\n'); process.exitCode = code === 0 && completed ? 0 : 1; });
}
if (process.argv.some(value => path.resolve(value) === __filename)) (process.argv.includes('--launch') ? Promise.resolve(launch()) : main()).catch(error => { process.stderr.write(error.stack + '\n'); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
