'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/artcraft-ux-verification');
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const { app, BrowserWindow } = require('electron'), scratch = process.env.T8_STORY_BRIDGE_SCRATCH;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-story-bridge-')) throw Error('Fresh temporary profile required');
  app.setPath('userData', scratch); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu');
  let win, server, deadline;
  try {
    process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '256MiB';
    const build = await require('esbuild').build({ bundle: true, write: false, outdir: path.join(scratch, 'bundle'), format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
      stdin: { sourcefile: 'story-bridge-fixture.tsx', resolveDir: root, loader: 'tsx', contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import {ReactFlow,ReactFlowProvider,useReactFlow} from '@xyflow/react';import '@xyflow/react/dist/style.css';
        import i18next from 'i18next';import {initReactI18next} from 'react-i18next';import {zhCN,enUS} from './src/i18n/resources';
        import Story from './src/components/nodes/StoryNode';import {useCanvasStore} from './src/stores/canvas';
        import {createEmptyStoryProject,applyStoryAnalysis,buildLocalStoryAnalysis,storyToVideoEditClips} from './src/utils/storyProduction';
        i18next.use(initReactI18next).init({lng:'zh',fallbackLng:'zh',resources:{zh:zhCN,en:enUS}});
        useCanvasStore.setState({activeId:'story-fixture',canvases:[{id:'story-fixture',name:'Isolated fixture',status:'active'}] as any});
        const empty=createEmptyStoryProject({storyId:'source-story',script:'【镜头一】小屋前的猫向前走。'}),analysis=buildLocalStoryAnalysis(empty.script,empty.settings);
        const project={...applyStoryAnalysis(empty,analysis,'local-fallback'),stage:'compose',linkedDirectorNodeId:'manual-director',linkedVideoEditNodeId:'manual-editor'};
        project.shots=project.shots.map(shot=>({...shot,videoUrl:'/fixture-shot.mp4',status:'succeeded'}));
        const manualDirector={shots:[{id:'manual-shot',prompt:'Keep this shot'}],custom:'manual-director-work'};
        const manualEditor={clips:[{id:'manual-clip',trimStart:3,trimEnd:4}],settings:{volume:0.25},timelineV2:{clips:[{id:'manual-timeline'}]},custom:'manual-edit-work'};
        let rf:any;function Probe(){rf=useReactFlow();return null}const types={story:Story,'director-storyboard':()=>null,'video-edit':()=>null};
        const nodes=[{id:'story',type:'story',position:{x:0,y:0},data:{storyProject:project}},{id:'manual-director',type:'director-storyboard',position:{x:500,y:0},data:manualDirector},{id:'manual-editor',type:'video-edit',position:{x:1000,y:0},data:manualEditor}];
        flushSync(()=>createRoot(document.getElementById('root')!).render(<ReactFlowProvider><ReactFlow defaultNodes={nodes as any} nodeTypes={types}/><Probe/></ReactFlowProvider>));
        window.fixture={nodes:()=>rf.getNodes(),manual:()=>({manualDirector,manualEditor}),expectedClips:()=>storyToVideoEditClips(project as any,{sourceNodeId:'story'}),language:()=>i18next.changeLanguage('en').then(()=>true)};
      ` } });
    const config = (await import(require('node:url').pathToFileURL(path.join(root, 'tailwind.config.js')).href)).default;
    const styles = await require('postcss')([require('tailwindcss')({ ...config, content: ['src/components/nodes/StoryNode.tsx'] })])
      .process(fs.readFileSync(path.join(root, 'src/styles/index.css'), 'utf8').replace(/^@import[^;]+;/gm, ''), { from: path.join(root, 'src/styles/index.css') });
    const css = build.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n'), script = build.outputFiles.find(file => file.path.endsWith('.js')).contents;
    const html = Buffer.from(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'unsafe-inline';connect-src 'self';img-src 'self' data: blob:"><style>${css}\n${styles.css}\nbody{margin:0;background:#142033}#root{width:1280px;height:900px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`);
    const posts = [];
    server = http.createServer((req, res) => { if (req.method === 'POST') posts.push(req.url); const data = req.url === '/' ? html : req.url === '/fixture.js' ? script : null; if (!data) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html' : 'text/javascript' }); res.end(data); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); await app.whenReady();
    win = new BrowserWindow({ show: false, width: 1320, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    deadline = setTimeout(() => { process.stderr.write('Story bridge UI exceeded45s\n'); app.exit(1); }, 45000);
    const errors = []; win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`); const js = code => win.webContents.executeJavaScript(code, true);
    const wait = async code => { for (let n = 0; n < 200; n++) { if (await js(code)) return; if (errors.length) throw Error(errors.join('\n')); await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('Condition not met: ' + code); };
    const click = text => js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Button unavailable: '+${JSON.stringify(text)});b.click()})()`);
    await wait('Boolean(window.fixture)'); const manual = await js('fixture.manual()');
    await click('打开 Story 工作台'); await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="打开剪辑草稿")'); await click('打开剪辑草稿');
    await wait('fixture.nodes().find(n=>n.id==="manual-editor").selected');
    let nodes = await js('fixture.nodes()'); assert.equal(nodes.length, 3); assert.deepEqual(nodes.find(node => node.id === 'manual-editor').data, manual.manualEditor); assert.deepEqual(nodes.find(node => node.id === 'manual-director').data, manual.manualDirector);
    await click('打开 Story 工作台'); await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="从当前结果新建草稿")'); await click('从当前结果新建草稿');
    await wait('fixture.nodes().length===5'); nodes = await js('fixture.nodes()');
    assert.deepEqual(nodes.find(node => node.id === 'manual-editor').data, manual.manualEditor); assert.deepEqual(nodes.find(node => node.id === 'manual-director').data, manual.manualDirector);
    const linked = nodes.find(node => node.id === 'story').data.storyProject, newEdit = nodes.find(node => node.id === linked.linkedVideoEditNodeId);
    assert.notEqual(newEdit.id, 'manual-editor'); assert.deepEqual(newEdit.data.clips, await js('fixture.expectedClips()'));
    assert.ok(newEdit.data.clips.every(clip => clip.sourceNodeId === 'story'));
    assert.equal(newEdit.data.storySourceNodeId, 'story'); assert.deepEqual(posts, []);
    await js('fixture.language()'); await click('Open Story workbench'); await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Open Director draft")');
    const report = { passed: true, productionStoryButtons: true, opensExistingWithoutRewriting: true, independentNewDrafts: true, stableShotClips: true, originalTrimsAndSettingsPreserved: true, providerRequests: posts.length, bilingual: true,
      boundary: 'production Story node in fresh ReactFlow/software Chromium fixture; linked editor bodies are stubs, no full editor playback, persistent database or live Provider acceptance' };
    fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'story-linked-editors-ui.json'), JSON.stringify(report, null, 2)); process.stdout.write(JSON.stringify(report) + '\n');
    fs.writeFileSync(path.join(scratch, 'completed.json'), '{}'); clearTimeout(deadline); win.destroy(); server.closeAllConnections(); server.close(); app.exit(0);
  } catch (error) { process.stderr.write(error.stack + '\n'); clearTimeout(deadline); win?.destroy(); server?.closeAllConnections(); server?.close(); app.exit(1); }
}
function launch() { const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-story-bridge-')), env = { ...process.env, T8_STORY_BRIDGE_SCRATCH: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), ['--js-flags=--max-old-space-size=512', __filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.once('exit', code => { const passed = fs.existsSync(path.join(scratch, 'completed.json')); if (path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-story-bridge-')) fs.rmSync(scratch, { recursive: true, force: true }); process.exitCode = code === 0 && passed ? 0 : 1; }); }
if (process.argv.some(value => path.resolve(value) === __filename)) (process.argv.includes('--launch') ? Promise.resolve(launch()) : main()).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
