'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/artcraft-ux-verification');
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const { app, BrowserWindow } = require('electron'), scratch = process.env.T8_EDITOR_LAZY_SCRATCH;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-editor-lazy-')) throw Error('Fresh temporary profile required');
  app.setPath('userData', scratch); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu');
  // The fixture deliberately replaces its only window between two cases.
  app.on('window-all-closed', () => {});
  process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '256MiB';
  let server, win, deadline;
  try {
    const outputDir = path.join(scratch, 'bundle');
    const build = await require('esbuild').build({ bundle: true, splitting: true, write: false, metafile: true, outdir: outputDir, entryNames: 'fixture',
      format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, stdin: { sourcefile: 'lazy-editor-fixture.tsx', loader: 'tsx', resolveDir: root, contents: `
        import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import {ReactFlowProvider} from '@xyflow/react';import i18next from 'i18next';import {initReactI18next} from 'react-i18next';
        import Editor from './src/components/nodes/LazyImageEditModal';import {creativeUxZh,creativeUxEn} from './src/i18n/creativeUxCatalog';
        i18next.use(initReactI18next).init({lng:'zh',resources:{zh:{creativeUx:creativeUxZh},en:{creativeUx:creativeUxEn}}});
        let visible=false,outputs=0,unhandled=[];window.addEventListener('unhandledrejection',e=>unhandled.push(String(e.reason)));
        function Fixture(){const [open,show]=useState(false);visible=open;return <><button onClick={()=>show(true)}>Open editor</button>{open&&<Editor localOnly srcUrl='/original.svg' onClose={()=>show(false)} onProduce={()=>{outputs++}}/>}</>}
        flushSync(()=>createRoot(document.getElementById('root')!).render(<ReactFlowProvider><Fixture/></ReactFlowProvider>));
        window.fixture={state:()=>({visible,outputs,unhandled})};
      ` } });
    const outputs = build.metafile.outputs;
    const entry = Object.keys(outputs).find(file => outputs[file].entryPoint === 'lazy-editor-fixture.tsx');
    const editor = Object.keys(outputs).find(file => /src\/components\/nodes\/ImageEditModal\.tsx$/.test(outputs[file].entryPoint || ''));
    assert.ok(entry && editor && entry !== editor, 'Production editor must be in a separate dynamic chunk');
    const reachable = new Set();
    const walk = file => { if (reachable.has(file)) return; reachable.add(file); for (const imported of outputs[file]?.imports || []) if (!imported.external && imported.kind !== 'dynamic-import') walk(imported.path); };
    walk(entry); assert.equal(reachable.has(editor), false);
    assert.equal([...reachable].some(file => Object.keys(outputs[file].inputs).some(input => /src\/components\/nodes\/ImageEditModal\.tsx$/.test(input))), false);
    const files = new Map(build.outputFiles.map(file => ['/' + path.relative(outputDir, file.path).replaceAll('\\', '/'), file.contents]));
    const entryPath = '/' + path.relative(outputDir, path.resolve(root, entry)).replaceAll('\\', '/');
    const editorPath = '/' + path.relative(outputDir, path.resolve(root, editor)).replaceAll('\\', '/');
    const config = (await import(require('node:url').pathToFileURL(path.join(root, 'tailwind.config.js')).href)).default;
    const styles = await require('postcss')([require('tailwindcss')({ ...config, content: ['src/components/nodes/ImageEditModal.tsx'] })])
      .process(fs.readFileSync(path.join(root, 'src/styles/index.css'), 'utf8').replace(/^@import[^;]+;/gm, ''), { from: path.join(root, 'src/styles/index.css') });
    const core = fs.readFileSync(path.join(root, 'src/styles/theme-core.css'), 'utf8');
    const pending = [], requested = []; let hold = true;
    const send = (res, data, type = 'text/javascript') => { res.writeHead(200, { 'Content-Type': type }); res.end(data); };
    server = http.createServer((req, res) => {
      const mode = req.url.startsWith('/failed/') ? 'failed' : 'ok', pathname = req.url.replace(/^\/(?:ok|failed)/, '');
      if (pathname === '/' || pathname === '/index.html') return send(res, `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'unsafe-inline';connect-src 'self';img-src 'self' data: blob:"><style>${core}\n${styles.css}</style><div id="root"></div><script type="module" src="/${mode}${entryPath}"></script>`, 'text/html');
      if (req.url === '/original.svg') return send(res, '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#37b8b0"/></svg>', 'image/svg+xml');
      const file = files.get(pathname); if (!file) { res.writeHead(404); res.end(); return; }
      requested.push({ mode, pathname });
      if (pathname === editorPath && mode === 'failed') { res.writeHead(503); res.end('Controlled unavailable editor chunk'); return; }
      if (pathname === editorPath && hold) { pending.push({ res, file }); return; }
      send(res, file);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); await app.whenReady();
    const origin = `http://127.0.0.1:${server.address().port}`;
    const createWindow = () => new BrowserWindow({ show: false, width: 1320, height: 960, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    win = createWindow();
    deadline = setTimeout(() => { process.stderr.write('Lazy editor verification exceeded45s\n'); win?.destroy(); server?.closeAllConnections(); server?.close(); app.exit(1); }, 45000);
    const js = code => win.webContents.executeJavaScript(code, true);
    const wait = async code => { for (let n = 0; n < 200; n++) { if (await js(code)) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('UI condition not met: ' + code); };
    const open = () => js('document.querySelector("#root button").click()');
    await win.loadURL(origin + '/ok/'); await wait('Boolean(window.fixture)');
    assert.equal(requested.some(req => req.pathname === editorPath), false);
    await open(); await wait('Boolean(document.querySelector("[data-editor-notice=loading]"))');
    assert.equal(await js('document.activeElement===document.querySelector("[data-editor-notice] button")'), true);
    assert.equal(await js('document.getElementById("root").inert'), true);
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await wait('!fixture.state().visible'); assert.equal(await js('document.getElementById("root").inert'), false);
    hold = false; pending.splice(0).forEach(({ res, file }) => send(res, file));
    await js(`import(${JSON.stringify('/ok' + editorPath)}).then(()=>true)`);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    assert.equal(await js('Boolean(document.querySelector(".img-edit-modal"))'), false);
    const firstOpen = Date.now(); await open();
    await wait('Boolean(document.querySelector(".img-edit-modal img")?.naturalWidth)');
    await wait('Number(getComputedStyle(document.querySelector(".img-edit-overlay")).opacity)>=0.99');
    const firstOpenMs = Date.now() - firstOpen;
    assert.equal(await js('document.getElementById("root").inert'), true);
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await wait('!fixture.state().visible');
    assert.deepEqual(await js('fixture.state().unhandled'), []); assert.equal(await js('fixture.state().outputs'), 0);
    const warmOpen = Date.now(); await open(); await wait('Boolean(document.querySelector(".img-edit-modal img")?.naturalWidth)');
    await wait('Number(getComputedStyle(document.querySelector(".img-edit-overlay")).opacity)>=0.99'); const warmOpenMs = Date.now() - warmOpen;
    win.destroy(); win = createWindow(); await win.loadURL(origin + '/failed/'); await wait('Boolean(window.fixture)');
    await open(); await wait('Boolean(document.querySelector("[data-editor-notice=error]"))');
    assert.ok((await js('document.querySelector("[role=alert]").textContent')).includes('原素材未更改'));
    await js('document.querySelector("[data-editor-notice] button").click()'); await wait('!fixture.state().visible');
    assert.equal(await js('document.getElementById("root").inert'), false); assert.deepEqual(await js('fixture.state().unhandled'), []);
    const report = { passed: true, editorExcludedFromInitialModules: true, initialRawJsBytes: [...reachable].reduce((sum, file) => sum + outputs[file].bytes, 0), editorChunkRawJsBytes: outputs[editor].bytes,
      firstSuccessfulOpenAfterCancelledLoadMs: firstOpenMs, subsequentOpenMs: warmOpenMs, cancelWhileLoading: true, lateChunkCannotReopen: true, failureDialogClosable: true, noOutputsOnCancel: true,
      boundary: 'single isolated esbuild split-module/software Chromium fixture, not application startup P50/P95, production bundle or installed client' };
    fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'editor-lazy-ui.json'), JSON.stringify(report, null, 2)); process.stdout.write(JSON.stringify(report) + '\n');
    fs.writeFileSync(path.join(scratch, 'completed.json'), JSON.stringify({ passed: true }));
    clearTimeout(deadline); win.destroy(); server.closeAllConnections(); server.close(); app.exit(0);
  } catch (error) { process.stderr.write(error.stack + '\n'); clearTimeout(deadline); win?.destroy(); server?.closeAllConnections(); server?.close(); app.exit(1); }
}
function launch() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-editor-lazy-')), env = { ...process.env, T8_EDITOR_LAZY_SCRATCH: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), ['--js-flags=--max-old-space-size=512', __filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.once('exit', code => { const completed = fs.existsSync(path.join(scratch, 'completed.json')); if (path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-editor-lazy-')) fs.rmSync(scratch, { recursive: true, force: true }); process.exitCode = code === 0 && completed ? 0 : 1; });
}
if (process.argv.some(value => path.resolve(value) === __filename)) (process.argv.includes('--launch') ? Promise.resolve(launch()) : main()).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
