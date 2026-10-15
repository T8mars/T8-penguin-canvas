'use strict';
// Isolated Chromium tests of production React handlers. Never opens a user DB.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'local-private/artcraft-ux-verification');
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const { app, BrowserWindow } = require('electron');
  const scratch = process.env.T8_CREATIVE_UI_SCRATCH;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-creative-ui-')) throw Error('Fresh temporary profile required');
  app.setPath('userData', scratch); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu');
  let win, deadline;
  try {
    process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '256MiB';
    await require('esbuild').build({ bundle: true, outfile: path.join(scratch, 'fixture.js'), format: 'esm', platform: 'browser', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' }, stdin: { sourcefile: 'creative-ux-fixture.tsx', resolveDir: root, loader: 'tsx', contents: `
        import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import i18next from 'i18next';import {initReactI18next} from 'react-i18next';
        import Moodboard from './src/components/MaterialMoodboard';
        import {creativeUxZh,creativeUxEn} from './src/i18n/creativeUxCatalog';
        i18next.use(initReactI18next).init({lng:'zh',fallbackLng:'zh',resources:{zh:{creativeUx:creativeUxZh},en:{creativeUx:creativeUxEn}}});
        const original=[{id:'a',kind:'image',name:'A',url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="coral"/></svg>')},{id:'b',kind:'image',name:'B',url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><circle cx="40" cy="60" r="35" fill="turquoise"/></svg>')}];
        let saved:any=null,inserted:any=[],closed=0,open:any,readonly:any,many:any;
        function Fixture(){const [show,setShow]=useState(true),[ro,setRo]=useState(false),[large,setLarge]=useState(false);open=setShow;readonly=setRo;many=setLarge;
          const items=large?Array.from({length:1000},(_,i)=>({...original[i%2],id:'item-'+i})):original;
          return show?<Moodboard items={items} value={saved} readOnly={ro} onClose={()=>{closed++;setShow(false)}}
            onSave={(next)=>{saved=next;return true}} onInsert={ids=>{inserted=ids}}/>:<button id="reopen" onClick={()=>setShow(true)}>reopen</button>;}
        flushSync(()=>createRoot(document.getElementById('root')!).render(<Fixture/>));
        window.fixture={state:()=>({saved,inserted,closed,original}),open:()=>flushSync(()=>open(true)),readOnly:v=>flushSync(()=>readonly(v)),many:v=>flushSync(()=>many(v)),language:l=>i18next.changeLanguage(l)};
      ` } });
    fs.writeFileSync(path.join(scratch, 'fixture.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'unsafe-inline';img-src 'self' data:;connect-src 'none';media-src 'none'"><style>body{margin:0;font:14px Arial;--bg-primary:#101827;--bg-secondary:#1d293b;--text-primary:#e2e8f0;--t8-border:#526279;--accent:#2dd4bf}button:disabled{opacity:.4;cursor:default}button{display:inline-flex;align-items:center;gap:4px}*{box-sizing:border-box}</style><div id="root"></div><script type="module" src="fixture.js"></script>`);
    await app.whenReady();
    win = new BrowserWindow({ show: false, width: 1280, height: 850, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    deadline = setTimeout(() => { process.stderr.write('Creative UI exceeded 45s deadline\n'); win?.destroy(); app.exit(1); }, 45000);
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadFile(path.join(scratch, 'fixture.html'));
    const js = (code) => win.webContents.executeJavaScript(code);
    const frame = () => js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    await frame();
    const click = async (text) => { await js(`(()=>{const el=[...document.querySelectorAll('button')].filter(b=>!b.closest('[inert]')).find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.title===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)});if(!el)throw Error('Missing button '+${JSON.stringify(text)});if(el.disabled)throw Error('Disabled button '+${JSON.stringify(text)});el.click()})()`); await frame(); };
    const select = async (id, shift = false) => { await js(`document.querySelector('[data-moodboard-card="${id}"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,button:0,shiftKey:${shift}}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,button:0}))`); await frame(); };
    const edit = async (label, value) => { await js(`(()=>{const el=document.querySelector('input[aria-label='+JSON.stringify(${JSON.stringify(label)})+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await frame(); };
    const cardStyle = () => js(`Object.fromEntries([...document.querySelectorAll('[data-moodboard-card]')].map(el=>[el.dataset.moodboardCard,{left:el.style.left,top:el.style.top,transform:el.style.transform,width:el.style.width,height:el.style.height}]))`);
    const initial = await cardStyle();
    assert.equal(await js('document.getElementById("root").inert'), true);
    await select('a');
    await edit('旋转', '30');
    assert.equal((await cardStyle()).a.transform, 'rotate(30deg)');
    await click('撤销'); assert.deepEqual(await cardStyle(), initial);
    await click('重做'); assert.equal((await cardStyle()).a.transform, 'rotate(30deg)');
    await select('b', true); await edit('分组名称', 'Look'); await click('分组');
    await click('排版预览'); assert.match(await js('document.body.textContent'), /正在预览排版/);
    await click('取消排版'); assert.equal((await cardStyle()).a.left, initial.a.left);
    await click('排版预览'); await click('确认排版');
    assert.equal((await cardStyle()).a.transform, 'rotate(30deg)');
    await click('预览 / 对比'); assert.equal(await js('document.querySelectorAll("[data-moodboard-comparison] img").length'), 2);
    await click('关闭'); // Comparison close, selected explicitly below if header is inert.
    await frame();
    if (!await js('Boolean(document.querySelector("[data-material-moodboard]"))')) throw Error('Comparison close must not close the board');
    await click('所选添加到画布'); assert.deepEqual((await js('fixture.state()')).inserted, ['a', 'b']);
    await click('保存布局'); assert.equal(await js('Boolean(document.querySelector("[data-material-moodboard]"))'), false);
    const saved = (await js('fixture.state()')).saved;
    assert.equal(saved.cards.a.rotation, 30); assert.equal(saved.cards.a.group, 'Look');
    await js('fixture.open()'); await frame();
    assert.equal((await cardStyle()).a.transform, 'rotate(30deg)');
    await js('fixture.readOnly(true)'); await frame();
    assert.equal(await js('[...document.querySelectorAll("button")].find(b=>b.textContent==="保存布局").disabled'), true);
    await js('fixture.readOnly(false);fixture.language("en").then(()=>true)'); await frame();
    assert.match(await js('document.body.textContent'), /Material moodboard/);
    await js('fixture.language("zh");document.body.style.setProperty("--bg-primary","#fffdf5");document.body.style.setProperty("--bg-secondary","#f0ede2");document.body.style.setProperty("--text-primary","#17202e")'); await frame();
    assert.equal(await js('getComputedStyle(document.querySelector("[data-material-moodboard]")).backgroundColor'), 'rgb(255, 253, 245)');
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, 'moodboard-light.png'), (await win.webContents.capturePage()).toPNG());
    await click('取消'); assert.equal(await js('document.getElementById("root").inert'), false);
    await js('fixture.many(true);fixture.open()'); await frame();
    const mounted = await js('document.querySelectorAll("[data-moodboard-card]").length');
    assert.ok(mounted < 40, `1000-card viewport mounted ${mounted}`);
    assert.deepEqual((await js('fixture.state()')).original.map(i => i.id), ['a', 'b']);
    assert.deepEqual(errors, []);
    const report = { passed: true, handlers: 'production MaterialMoodboard', rotationUndoRedo: true, group: true, layoutPreviewCancelConfirm: true,
      compare: true, addSelection: true, saveReopen: true, readOnly: true, languages: ['zh', 'en'], largeCardCount: 1000, mountedCards: mounted,
      boundary: 'isolated software Chromium fixture, not full canvas persistence/installed client; no GPU/live generation tested' };
    fs.writeFileSync(path.join(evidence, 'moodboard-ui.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n'); clearTimeout(deadline); win.destroy(); app.exit(0);
  } catch (error) { process.stderr.write(error.stack + '\n'); clearTimeout(deadline); win?.destroy(); app.exit(1); }
}
function launch() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creative-ui-'));
  const env = { ...process.env, T8_CREATIVE_UI_SCRATCH: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), ['--js-flags=--max-old-space-size=512', __filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.once('exit', code => {
    if (path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-creative-ui-')) fs.rmSync(scratch, { recursive: true, force: true });
    process.exitCode = code == null ? 1 : code;
  });
}
if (process.argv.some(value => path.resolve(value) === __filename)) (process.argv.includes('--launch') ? Promise.resolve(launch()) : main()).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
