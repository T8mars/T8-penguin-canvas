'use strict';
// Isolated software Chromium with production React components, registry, Tailwind and themes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'local-private/quick-add-agnes-20261024');
function themeCss(name) {
  return name === 'tech' ? '' : fs.readFileSync(path.join(root, `src/styles/theme-${name}.css`), 'utf8')
    .replace(/url\(["']\.\.\/assets\/([^"']+)["']\)/g, (_match, name) => {
      const file = path.resolve(root, 'src/assets', name);
      if (!file.startsWith(path.resolve(root, 'src/assets') + path.sep)) throw Error('Unexpected asset path');
      const mime = file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'image/webp';
      return `url("data:${mime};base64,${fs.readFileSync(file).toString('base64')}")`;
    });
}
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const { app, BrowserWindow } = require('electron');
  const scratch = process.env.T8_QUICK_ADD_UI_PROFILE;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-quick-add-ui-')) throw Error('Fresh isolated profile required');
  app.setPath('userData', scratch); app.setPath('sessionData', scratch); app.disableHardwareAcceleration();
  let win;
  try {
    process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '512MiB';
    await require('esbuild').build({ bundle: true, outfile: path.join(scratch, 'fixture.js'), platform: 'browser', format: 'esm', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, loader: 'tsx', contents: `
        import React,{useState,useRef} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import Menu from './src/components/CanvasQuickAddMenu';import Agnes from './src/components/nodes/AgnesVideoControls';
        import i18n from './src/i18n';import {applyThemeTemplate} from './src/theme/applyTheme';import {BUILT_IN_THEME_TEMPLATES} from './src/theme/defaultTemplates';
        let open:any,edits:any=[],added:any=[],closed=0,wheels=0;window.addEventListener('wheel',()=>wheels++);
        function Fixture(){const ref=useRef(null);const [point,setPoint]=useState<any>(null);const [params,setParams]=useState({mode:'auto'});open=setPoint;
          return <><div className="t8-canvas-shell" id="shell" ref={ref} style={{position:'absolute',left:16,top:52,right:16,bottom:34,overflow:'hidden'}}>
            {point&&<Menu point={point} containerRef={ref} onClose={()=>{closed++;setPoint(null)}} onAdd={(type,at)=>added.push({type,at})}/>}</div>
            <div id="agnes" style={{position:'absolute',top:0,left:0,width:220,display:point?'none':'block'}}><Agnes mode={params.mode} migrated update={patch=>{edits.push(patch);setParams(old=>({...old,...patch}))}}/></div></>;}
        flushSync(()=>createRoot(document.getElementById('root')!).render(<Fixture/>));
        (window as any).fixture={open:(point:any)=>flushSync(()=>open(point)),language:(lang:string)=>i18n.changeLanguage(lang),state:()=>({added,closed,wheels,edits}),
          theme:(name:string,mode:any)=>{const template=BUILT_IN_THEME_TEMPLATES.find(item=>item.visuals?.style===name);if(!template)throw Error('theme');applyThemeTemplate(template,mode);}};
      ` } });
    const raw = fs.readFileSync(path.join(root, 'src/styles/index.css'), 'utf8').replace(/^@import[^;]+;/m, '');
    const css = (await require('postcss')([require('tailwindcss')({ content: [path.join(root, 'src/components/CanvasQuickAddMenu.tsx'), path.join(root, 'src/components/nodes/AgnesVideoControls.tsx')] })]).process(raw, { from: path.join(root, 'src/styles/index.css') })).css;
    fs.writeFileSync(path.join(scratch, 'fixture.html'), `<!doctype html><html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'"><style>${fs.readFileSync(path.join(root, 'src/styles/theme-core.css'), 'utf8')}\n${css}</style><style id="theme"></style><div class="t8-app-shell"><div id="root"></div></div><script type="module" src="fixture.js"></script></html>`);
    await app.whenReady();
    win = new BrowserWindow({ show: false, width: 650, height: 600, webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const errors = []; win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) errors.push(message); });
    await win.loadFile(path.join(scratch, 'fixture.html'));
    const js = async source => {
      let timer;
      try { return await Promise.race([win.webContents.executeJavaScript(source, true), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('Isolated UI query timed out: ' + source.slice(0, 160))), 5000); })]); }
      finally { clearTimeout(timer); }
    };
    // Hidden windows need not receive animation frames. Layout reads below force layout.
    const frame = () => new Promise(resolve => setTimeout(resolve, 40));
    const resize = async (width, height) => {
      win.setContentSize(width, height);
      for (let attempt = 0; attempt < 25; attempt++) {
        if (await js(`innerWidth===${width}&&innerHeight===${height}`)) { await frame(); return; }
        await frame();
      }
      throw Error('Chromium resize did not settle');
    };
    let combinations = 0;
    for (const theme of ['tech', 'pixel', 'rh']) for (const mode of ['light', 'dark']) for (const lang of ['zh-CN', 'en-US']) {
      process.stdout.write(`[ui] ${theme}/${mode}/${lang}\n`);
      await js(`document.getElementById('theme').textContent=${JSON.stringify(themeCss(theme))};fixture.theme('${theme}','${mode}');fixture.language('${lang}').then(()=>true)`);
      for (const [width, height] of [[348, 541], [240, 300], [900, 700]]) for (const point of [{ x: 2, y: 2 }, { x: width - 2, y: height - 2 }]) {
        await resize(width, height); await js(`fixture.open(${JSON.stringify(point)})`); await frame();
        const bounds = await js(`(()=>{const menu=document.querySelector('[role=menu]'),list=document.querySelector('[data-quick-add-scroll]'),r=menu.getBoundingClientRect(),s=document.getElementById('shell').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,sl:s.left,st:s.top,sr:s.right,sb:s.bottom,scroll:list.scrollHeight>list.clientHeight,overflow:getComputedStyle(list).overflowY,count:list.children.length,title:menu.getAttribute('aria-label')}})()`);
        assert.ok(bounds.left >= bounds.sl + 7 && bounds.top >= bounds.st + 7, JSON.stringify(bounds));
        assert.ok(bounds.right <= bounds.sr - 7 && bounds.bottom <= bounds.sb - 7, JSON.stringify(bounds));
        assert.equal(bounds.overflow, 'auto'); assert.ok(bounds.count > 10); assert.equal(bounds.scroll, true);
        assert.equal(bounds.title, lang === 'zh-CN' ? '快速添加节点' : 'Quick add node');
        await js(`document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`); await frame();
        const last = await js(`(()=>{const list=document.querySelector('[data-quick-add-scroll]'),button=list.lastElementChild,r=button.getBoundingClientRect(),l=list.getBoundingClientRect();return {focused:document.activeElement===button,visible:r.bottom<=l.bottom+1&&r.top>=l.top-1,scrolled:list.scrollTop>0}})()`);
        assert.deepEqual(last, { focused: true, visible: true, scrolled: true });
        await js('document.activeElement.click()');
        const state = await js('fixture.state()'); assert.deepEqual(state.added.at(-1).at, point); combinations++;
      }
    }
    // Actual wheel input must scroll the catalog without reaching canvas zoom listeners.
    await resize(348, 541); await js("fixture.open({x:330,y:520})"); await frame();
    const target = await js("(()=>{const r=document.querySelector('[data-quick-add-scroll]').getBoundingClientRect();return {x:Math.round(r.left+30),y:Math.round(r.top+60)}})()");
    process.stdout.write('[wheel] ' + JSON.stringify(await js(`(()=>{const list=document.querySelector('[data-quick-add-scroll]'),hit=document.elementFromPoint(${target.x},${target.y});return {hit:hit?.outerHTML.slice(0,300),top:list.scrollTop,height:list.clientHeight,full:list.scrollHeight,rect:list.getBoundingClientRect().toJSON()}})()`)) + '\n');
    // Native input requires a focused window. CDP drives this hidden test renderer only.
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...target, deltaY: 260, deltaX: 0 });
    await js('new Promise(r=>setTimeout(()=>r(true),150))');
    assert.equal(await js("document.querySelector('[data-quick-add-scroll]').scrollTop>0"), true);
    assert.equal((await js('fixture.state()')).wheels, 0);
    // Resize an already-open menu, then Escape dismisses it.
    await resize(240, 300);
    assert.equal(await js("document.querySelector('[role=menu]').getBoundingClientRect().bottom<=document.getElementById('shell').getBoundingClientRect().bottom-7"), true);
    await js("document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await js("!!document.querySelector('[role=menu]')"), false);
    for (const value of ['reference', 'keyframe', 'text', 'auto']) {
      await js(`(()=>{const el=document.querySelector('[data-agnes-video-controls] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'${value}');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.equal((await js('fixture.state()')).edits.at(-1).mode, value);
    }
    fs.mkdirSync(evidence, { recursive: true });
    await resize(348, 541); await js("document.getElementById('theme').textContent=" + JSON.stringify(themeCss('pixel')) + ";fixture.theme('pixel','light');fixture.language('zh-CN').then(()=>true)");
    await js('fixture.open({x:320,y:500})'); await frame();
    fs.writeFileSync(path.join(evidence, 'menu-short-top.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))"); await frame();
    fs.writeFileSync(path.join(evidence, 'menu-short-bottom.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    const report = { passed: true, combinations, realWheel: true, keyboardLastItemClick: true, resizeWhileOpen: true, agnesActualModeChanges: 4,
      boundary: 'production components/styles in isolated Chromium, not a full installed canvas or live Agnes generation' };
    fs.writeFileSync(path.join(evidence, 'ui-report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n'); win.destroy(); app.exit(0);
  } catch (error) { process.stderr.write(error.stack + '\n'); if (win) win.destroy(); app.exit(1); }
}
function launch() {
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw Error('Development worktree required');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-quick-add-ui-'));
  const env = { ...process.env, T8_QUICK_ADD_UI_PROFILE: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), ['--js-flags=--max-old-space-size=768', __filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.once('exit', code => {
    if (path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-quick-add-ui-')) fs.rmSync(scratch, { recursive: true, force: true });
    process.exitCode = code ?? 1;
  });
}
(process.argv.includes('--launch') ? Promise.resolve(launch()) : main()).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
