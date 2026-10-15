'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/artcraft-ux-verification');
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const { app, BrowserWindow, nativeImage } = require('electron'), scratch = process.env.T8_WORLD_NODE_SCRATCH;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-world-node-')) throw Error('Fresh temporary profile required');
  app.setPath('userData', scratch); app.on('window-all-closed', () => {});
  app.commandLine.appendSwitch('use-gl', 'angle'); app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '256MiB';
  process.env.T8PC_PACKAGED = '0'; process.env.T8PC_DEV_DATA_ROOT = path.join(scratch, 'isolated-backend');
  process.env.T8PC_DEV_PROJECT_DB_STORAGE_PROFILE = 'acceptance-small-v1'; process.env.T8_COLLAB_MANAGEMENT_TOKEN = crypto.randomBytes(32).toString('base64url');
  let win, server, database, runtime, deadline, phase = 'initialize';
  try {
    const config = require('../backend/src/config');
    assert.equal(path.dirname(path.dirname(config.PROJECT_DB_FILE)), path.join(scratch, 'isolated-backend'));
    for (const directory of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR]) {
      assert.ok(path.resolve(directory).startsWith(path.resolve(scratch) + path.sep)); fs.mkdirSync(directory, { recursive: true });
    }
    const express = require('express'), httpApp = express(); httpApp.use(express.json({ limit: '4mb' }));
    const storage = require('../backend/src/services/projectRuntime');
    database = storage.getProjectStorageRuntime(config).database;
    const { DEFAULT_PROJECT_ID } = require('../backend/src/collaboration/protocol');
    const canvasId = 'world-node-' + crypto.randomUUID();
    const initialNodes = [{ id: 'world', entityUid: crypto.randomUUID(), type: 'world-scene', position: { x: 5, y: 5 }, data: { worldSceneProject: { schema: 't8-world-scene-v1', sources: [], activeSourceId: '', camera: null, views: [] }, status: 'idle' } }];
    database.ensureCanvas(canvasId, { nodes: initialNodes, edges: [] }, DEFAULT_PROJECT_ID);
    const filesRoute = require('../backend/src/routes/files'), runsRoute = require('../backend/src/routes/projectRuns');
    runtime = runsRoute.getRuntime();
    const commit = runtime.assetIndexer.commitHostRunOutputAssets.bind(runtime.assetIndexer);
    runtime.assetIndexer.commitHostRunOutputAssets = async (...args) => {
      try { return await commit(...args); } catch (error) { process.stderr.write(`Observed host commit: ${error.code || 'unknown'} ${error.message}\n${error.stack}\n`); throw error; }
    };
    httpApp.use('/api/files', filesRoute); httpApp.use('/api/project-runs', runsRoute); httpApp.use('/api/project-assets', require('../backend/src/routes/projectAssets'));
    httpApp.use('/files/input', express.static(config.INPUT_DIR)); httpApp.use('/files/output', express.static(config.OUTPUT_DIR));
    httpApp.get('/fixture/graph', (_req, res) => res.json(database.getCanvas(canvasId)));
    httpApp.post('/fixture/save', (req, res) => {
      const current = database.getCanvas(canvasId); const saved = database.saveCanvasSnapshot(canvasId, req.body, { expectedRevision: current.revision }); res.json({ success: true, revision: saved.revision });
    });
    const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    const ply = ['ply', 'format ascii 1.0', 'element vertex 3', ...props.map(p => 'property float ' + p), 'end_header',
      '-0.5 0 0 1.7 -1 -1 7 -1.5 -1.5 -1.5 1 0 0 0', '0.5 0 0 -1 1.7 -1 7 -1.5 -1.5 -1.5 1 0 0 0', '0 0.65 0 -1 -1 1.7 7 -1.5 -1.5 -1.5 1 0 0 0', ''].join('\n');
    const build = await require('esbuild').build({ bundle: true, write: false, outdir: path.join(scratch, 'bundle'), format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
      stdin: { sourcefile: 'world-node-fixture.tsx', resolveDir: root, loader: 'tsx', contents: `
        import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import {ReactFlow,ReactFlowProvider,useReactFlow} from '@xyflow/react';import '@xyflow/react/dist/style.css';
        import i18next from 'i18next';import {initReactI18next} from 'react-i18next';
        import World from './src/components/nodes/WorldSceneNode';import {useCanvasStore} from './src/stores/canvas';
        import {CanvasNodeRenderModeProvider} from './src/components/CanvasNodeRenderMode';
        import {useRunBusStore} from './src/stores/runBus';import {createProjectRun,updateProjectRun} from './src/services/api';
        import {requestCanvasNodeRun} from './src/utils/canvasRunRequest';
        import {creativeUxZh,creativeUxEn} from './src/i18n/creativeUxCatalog';
        i18next.use(initReactI18next).init({lng:'zh',resources:{zh:{creativeUx:creativeUxZh},en:{creativeUx:creativeUxEn}}});
        const canvasId=${JSON.stringify(canvasId)},projectId=${JSON.stringify(DEFAULT_PROJECT_ID)},ply=${JSON.stringify(ply)};
        useCanvasStore.setState({activeId:canvasId,canvases:[{id:canvasId,name:'Fresh world fixture',status:'active'}] as any});
        let rf:any,allow=false,requests=0,error='',unhandled:any[]=[];window.addEventListener('unhandledrejection',e=>unhandled.push(String(e.reason)));
        const renderModes:any={};function WrappedWorld(props){const [mode,setMode]=useState('hot');renderModes[props.id]=setMode;return <CanvasNodeRenderModeProvider mode={mode as any}><World {...props}/></CanvasNodeRenderModeProvider>}
        function Probe(){rf=useReactFlow();return null}const types={'world-scene':WrappedWorld};
        const graph=await fetch('/fixture/graph').then(r=>r.json());
        flushSync(()=>createRoot(document.getElementById('root')!).render(<ReactFlowProvider><ReactFlow defaultNodes={graph.nodes} defaultEdges={graph.edges} nodeTypes={types}/><Probe/></ReactFlowProvider>));
        // Controlled owner approval exercises the production node request and
        // durable useRunTrigger. This is not the full Canvas preflight UI.
        window.addEventListener('t8:canvas-node-run-request',async(event:any)=>{requests++;if(!allow){event.detail.onSettled?.({accepted:false,error:'Fixture owner denied'});return}
          try{const saved=await fetch('/fixture/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodes:rf.getNodes(),edges:rf.getEdges()})}).then(r=>r.json());
            if(!saved.success)throw Error('Pre-run save failed');
            const run=await createProjectRun({projectId,canvasId,canvasRevision:saved.revision,summary:{plannedNodeIds:['world']}});
            await updateProjectRun(run.id,{status:'running',startedAt:Date.now()});
            const context={contextId:crypto.randomUUID(),runId:run.id,projectId,canvasId,canvasRevision:saved.revision,mode:'single',plannedNodeIds:['world'],authorizedNodeIds:['world'],createdAt:Date.now()};
            useRunBusStore.getState().triggerRun('world','single',context as any);event.detail.onSettled?.({accepted:true});
          }catch(e){error=String(e);event.detail.onSettled?.({accepted:false,error})}});
        window.fixture={state:()=>({data:rf.getNode('world').data,requests,error,unhandled,lastDone:useRunBusStore.getState().lastDone}),allow:()=>{allow=true},
          request:()=>requestCanvasNodeRun('world'),
          cold:value=>renderModes.world(value?'cold':'hot'),
          import:()=>{const transfer=new DataTransfer();transfer.items.add(new File([ply],'one.ply',{type:'application/octet-stream'}));transfer.items.add(new File([ply],'two.ply',{type:'application/octet-stream'}));const input=document.querySelector('[data-world-scene-node] input[type=file]') as HTMLInputElement;input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))},
          save:async()=>{const r=await fetch('/fixture/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodes:rf.getNodes(),edges:rf.getEdges()})});if(!r.ok)throw Error('Save failed');return true},
          reconnect:connected=>{const source=rf.getNode('world').data.worldSceneProject.sources[0];rf.setNodes(nodes=>[...nodes.filter(n=>n.id!=='upstream'),{id:'upstream',type:'world-scene',position:{x:600,y:0},data:{worldSceneSource:source,worldSceneUrl:source.url,worldSceneFormat:source.format,worldSceneProject:{schema:'t8-world-scene-v1',sources:[source],activeSourceId:source.id,camera:null,views:[]}}}]);rf.setEdges(connected?[{id:'world-edge',source:'upstream',sourceHandle:'scene',target:'world',targetHandle:'input'}]:[])},
          archive:()=>useCanvasStore.setState({canvases:[{id:canvasId,name:'Fresh world fixture',status:'archived'}] as any})};
      ` } });
    const script = Buffer.from(build.outputFiles.find(file => file.path.endsWith('.js')).contents);
    const css = build.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
    httpApp.get('/fixture.js', (_req, res) => res.type('text/javascript').send(script));
    httpApp.get('/', (_req, res) => res.type('html').send(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self' 'wasm-unsafe-eval';style-src 'unsafe-inline';connect-src 'self' data: blob:;worker-src blob:;img-src 'self' data: blob:"><style>${css}\nbody{margin:0;--bg-primary:#142033;--bg-secondary:#223044;--text-primary:#e7edf7;--t8-border:#536272}#root{width:1280px;height:900px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`));
    server = httpApp.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const initialGraphResponse = await fetch(origin + '/fixture/graph').then(response => response.json()); assert.equal(initialGraphResponse.nodes.length, 1);
    await app.whenReady(); win = new BrowserWindow({ show: false, width: 1280, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    deadline = setTimeout(() => { process.stderr.write(`World node exceeded60s at ${phase}\n`); app.exit(1); }, 60000);
    const rendererErrors = []; win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) { rendererErrors.push(message); process.stderr.write('Renderer: ' + message + '\n'); } });
    const js = code => win.webContents.executeJavaScript(code, true);
    const wait = async code => { for (let n = 0; n < 200; n++) { if (await js(code)) return; if (rendererErrors.length) throw Error(rendererErrors.join('\n'));
      const alert = await js('document.querySelector("[role=alert]")?.textContent'); if (alert && ['imports','capture Run'].includes(phase)) throw Error(alert);
      await new Promise(resolve => setTimeout(resolve, 50)); } throw Error('UI condition not met: ' + code + ' at ' + phase); };
    const click = async text => js(`(()=>{const b=[...document.querySelectorAll('[data-world-scene-node] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Button unavailable: '+${JSON.stringify(text)});b.click()})()`);
    phase = 'imports'; await win.loadURL(origin); await wait('Boolean(window.fixture)'); await js('fixture.import()');
    await wait('fixture.state().data.worldSceneProject.sources.length===2');
    await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="输出当前构图"&&!b.disabled)');
    let state = await js('fixture.state()'); assert.ok(state.data.worldSceneProject.sources.every(source => source.assetId && source.assetEntityUid && /^[a-f0-9]{64}$/.test(source.contentHash)));
    assert.equal(state.data.sourceAssetId, state.data.worldSceneSource.assetId, 'Real active AssetRef must enter ordinary Canvas preflight');
    phase = 'named view';
    await js(`(()=>{const input=document.querySelector('[aria-label="景位名称（可选）"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Hero');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await click('保存景位'); await wait('fixture.state().data.worldSceneProject.views.length===1');
    phase = 'camera navigation'; const savedCamera = (await js('fixture.state()')).data.worldSceneProject.views[0].camera;
    const hiddenBeforeFocusEmulation = await js('document.hidden');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    assert.equal(await js('document.hidden'), false, 'Keyboard case requires a foreground page, while the native test window remains hidden');
    await js(`(async()=>{const canvas=document.querySelector('[data-world-scene-viewer] canvas');canvas.focus();canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true}));
      for(let i=0;i<3;i++)await new Promise(resolve=>requestAnimationFrame(resolve));
      window.dispatchEvent(new KeyboardEvent('keyup',{key:'w',bubbles:true}));return true})()`);
    await wait('JSON.stringify(fixture.state().data.worldSceneProject.camera)!==JSON.stringify(fixture.state().data.worldSceneProject.views[0].camera)');
    await click('Hero'); await wait('JSON.stringify(fixture.state().data.worldSceneProject.camera)===JSON.stringify(fixture.state().data.worldSceneProject.views[0].camera)');
    assert.deepEqual((await js('fixture.state()')).data.worldSceneProject.camera, savedCamera);
    phase = 'request approval'; await click('输出当前构图'); await wait('fixture.state().requests===1'); assert.equal(database.listRuns({ canvasId }).length, 0);
    await js('fixture.allow()'); phase = 'capture Run';
    const closedCapture = process.argv.includes('--closed');
    if (closedCapture) {
      phase = 'closed view setup'; await click('关闭场景，释放显存'); await wait('document.querySelectorAll("canvas").length===0'); await js('fixture.request()');
      await wait('fixture.state().data.status==="running" || Boolean(fixture.state().lastDone)'); phase = 'capture Run';
    }
    else await click('输出当前构图');
    await wait('Boolean(fixture.state().lastDone)'); state = await js('fixture.state()'); assert.equal(state.lastDone.ok, true, JSON.stringify(state));
    assert.equal(state.data.status, 'success');
    const imageResponse = await fetch(origin + state.data.imageUrl); assert.equal(imageResponse.status, 200); const image = nativeImage.createFromBuffer(Buffer.from(await imageResponse.arrayBuffer())); assert.equal(image.isEmpty(), false);
    const bitmap = image.toBitmap(); let colored = 0; for (let i = 0; i < bitmap.length; i += 4) if (Math.max(bitmap[i], bitmap[i + 1], bitmap[i + 2]) - Math.min(bitmap[i], bitmap[i + 1], bitmap[i + 2]) > 80) colored++;
    assert.ok(colored > 500, `Snapshot lacked actual Gaussian pixels: ${colored}`);
    const run = database.listRuns({ canvasId })[0], detailResponse = await fetch(origin + '/api/project-runs/' + encodeURIComponent(run.id)).then(response => response.json()), detail = detailResponse.data;
    assert.equal(detail.nodeRuns[0].status, 'succeeded'); assert.equal(detail.nodeRuns[0].attempts.length, 1); assert.equal(detail.nodeRuns[0].outputRefs.length, 1);
    const finished = await fetch(origin + '/api/project-runs/' + encodeURIComponent(run.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'succeeded', finishedAt: Date.now() }) });
    assert.equal(finished.ok, true); assert.equal(database.getRun(run.id).status, 'succeeded');
    if (closedCapture) { await wait('document.querySelectorAll("canvas").length===0'); await click('打开场景浏览'); }
    await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="输出当前构图"&&!b.disabled)');
    fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'world-node.png'), (await win.webContents.capturePage()).toPNG());
    phase = 'offscreen release'; await js('fixture.cold(true)'); await wait('document.querySelectorAll("canvas").length===0');
    await js('fixture.cold(false)'); await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="输出当前构图"&&!b.disabled)');
    phase = 'save/reload'; await js('fixture.save()'); const savedProject = (await js('fixture.state()')).data.worldSceneProject;
    await win.loadURL(origin + '/?reopen=1'); await wait('Boolean(window.fixture)'); assert.deepEqual((await js('fixture.state()')).data.worldSceneProject, savedProject);
    const readback = new (require('better-sqlite3'))(config.PROJECT_DB_FILE, { readonly: true, fileMustExist: true });
    try { const row = readback.prepare('SELECT snapshot_json FROM canvas_documents WHERE canvas_id=?').get(canvasId); assert.deepEqual(JSON.parse(row.snapshot_json).nodes.find(node => node.id === 'world').data.worldSceneProject, savedProject); }
    finally { readback.close(); }
    phase = 'connection identity'; await js('fixture.reconnect(true)');
    await wait('document.querySelector("[aria-label=选择场景]")?.options.length===3');
    await js(`(()=>{const select=document.querySelector('[aria-label="选择场景"]'),item=[...select.options].find(o=>o.value.startsWith('upstream:'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,item.value);select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await wait('fixture.state().data.worldSceneProject.activeSourceId.startsWith("upstream:")'); const connected = (await js('fixture.state()')).data;
    await js('fixture.reconnect(false)'); await wait('fixture.state().data.worldSceneUrl===""');
    assert.equal((await js('fixture.state()')).data.sourceAssetId, '', 'Disconnected scene must not retain an active preflight AssetRef');
    assert.equal((await js('fixture.state()')).data.worldSceneProject.activeSourceId, connected.worldSceneProject.activeSourceId);
    await js('fixture.reconnect(true)'); await wait('fixture.state().data.worldSceneUrl!==""');
    const restored = (await js('fixture.state()')).data; assert.equal(restored.worldSceneSource.assetId, connected.worldSceneSource.assetId); assert.equal(restored.worldSceneProject.views.length, 1);
    phase = 'archive'; await js('fixture.archive()'); await wait('[...document.querySelectorAll("[data-world-scene-node] button")].filter(b=>b.textContent.includes("导入场景")).every(b=>b.disabled)');
    assert.deepEqual(await js('fixture.state().unhandled'), []);
    fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, closedCapture ? 'world-node-closed-ui.json' : 'world-node-ui.json'), JSON.stringify({ passed: true, productionNode: true, closedCaptureAndRelease: closedCapture, actualUploads: 2, stableAssetPins: true, namedViewPersisted: true, rejectedRequestCreatedRuns: 0,
      durableNodeRuns: 1, durableAttempts: 1, committedOutputAssets: 1, runTerminalStatus: 'succeeded', actualColoredPixels: colored, hiddenBeforeFocusEmulation, cdpForegroundEmulation: true, actualWasdNavigation: true, namedViewRestoresCamera: true, serializedCanvasReload: true, independentSqliteReadback: true, offscreenUnmountAndReopen: true, disconnectedOutputCleared: true, reconnectKeepsIdentityAndViews: true, archiveWriteControlsDisabled: true,
      boundary: 'fresh isolated backend/SQLite and production ReactFlow node + useRunTrigger; controlled owner approval, not full Canvas preflight, installed client, physical GPU or large-scene acceptance' }, null, 2));
    fs.writeFileSync(path.join(scratch, 'completed.json'), '{}'); process.stdout.write('World node UI + fresh backend persistence: passed\n');
  } finally {
    clearTimeout(deadline); win?.destroy(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
    const storage = require('../backend/src/services/projectRuntime'); storage.cancelProjectStorageDeferredWork(); await storage.waitForProjectStorageDeferredWork();
    if (database) { const runs = require('../backend/src/routes/projectRuns').peekRuntime(); await runs?.recoveryManager?.shutdown?.(); await runs?.previewPipeline?.shutdown?.(); await database.close(); }
  }
  app.exit(0);
}
function launch() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-world-node-')), env = { ...process.env, T8_WORLD_NODE_SCRATCH: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), ['--js-flags=--max-old-space-size=512', __filename, ...(process.argv.includes('--closed') ? ['--closed'] : [])], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.once('exit', code => { const complete = fs.existsSync(path.join(scratch, 'completed.json')); if (code === 0 && complete && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-world-node-')) fs.rmSync(scratch, { recursive: true, force: true }); else process.stderr.write('Failed fixture retained at ' + scratch + '\n'); process.exitCode = code === 0 && complete ? 0 : 1; });
}
if (process.argv.some(value => path.resolve(value) === __filename)) (process.argv.includes('--launch') ? Promise.resolve(launch()) : main()).catch(error => { process.stderr.write(error.stack + '\n'); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
