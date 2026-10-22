'use strict';
// Actual Chromium DOM + production controls/styles; no user canvas or database.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'local-private/moss-live-20261023');
function themeCss(theme) {
  if (theme === 'tech') return '';
  return fs.readFileSync(path.join(root, `src/styles/theme-${theme}.css`), 'utf8')
    .replace(/url\(["']\.\.\/assets\/([^"']+)["']\)/g, (_match, name) => {
      const file = path.resolve(root, 'src/assets', name);
      if (!file.startsWith(path.resolve(root, 'src/assets') + path.sep)) throw new Error('Unexpected theme asset path');
      const mime = file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'image/webp';
      return `url("data:${mime};base64,${fs.readFileSync(file).toString('base64')}")`;
    });
}
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const { app, BrowserWindow } = require('electron');
  const scratch = process.env.T8_MOSS_UI_PROFILE;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-moss-ui-')) throw new Error('Isolated profile required');
  app.setPath('userData', scratch); app.setPath('sessionData', scratch); app.disableHardwareAcceleration();
  let win;
  try {
    process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '512MiB';
    await require('esbuild').build({ bundle: true, outfile: path.join(scratch, 'fixture.js'), platform: 'browser', format: 'esm', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, sourcefile: 'moss-controls-fixture.tsx', loader: 'tsx', contents: `
        import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import Controls from './src/components/nodes/MossImageControls';import i18n from './src/i18n';
        import {applyThemeTemplate} from './src/theme/applyTheme';import {BUILT_IN_THEME_TEMPLATES} from './src/theme/defaultTemplates';
        let state:any,setState:any;function Fixture(){const [data,edit]=useState({aspectRatio:'9:16'});state=data;setState=edit;
          return <Controls ratio={data.aspectRatio} update={patch=>edit(old=>({...old,...patch}))}/>;}
        flushSync(()=>createRoot(document.getElementById('controls')!).render(<Fixture/>));
        (window as any).fixture={state:()=>state,restore:(data:any)=>flushSync(()=>setState(data)),language:(value:string)=>i18n.changeLanguage(value),
          theme:(style:string,mode:any)=>{const aliases:any={dragonball:'dragon-ball',soccer:'soccer-hero',saintseiya:'saint-seiya'};
            const template=BUILT_IN_THEME_TEMPLATES.find(item=>item.visuals?.style===(aliases[style]||style));if(!template)throw Error('Missing theme');applyThemeTemplate(template,mode);}};
      ` } });
    const core = fs.readFileSync(path.join(root, 'src/styles/theme-core.css'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'src/styles/index.css'), 'utf8').replace(/^@import[^;]+;/m, '');
    fs.writeFileSync(path.join(scratch, 'fixture.html'), `<!doctype html><html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'"><style>${core}\n${css}</style><style>body{margin:24px;font-family:Arial;background:var(--t8-bg-app);color:var(--t8-text-main)}.node-card{width:420px;padding:12px;box-sizing:border-box;background:var(--t8-bg-node);border:1px solid var(--t8-border)}select{box-sizing:border-box;width:100%}header{margin-bottom:12px}</style><style id="theme"></style><div class="t8-app-shell"><div class="t8-canvas-shell"><div class="react-flow__node"><div class="node-card"><header>图像 / Image · Moss Image</header><div id="controls"></div></div></div></div></div><script type="module" src="fixture.js"></script></html>`);
    await app.whenReady();
    win = new BrowserWindow({ show: false, width: 650, height: 400, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const errors = []; win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) errors.push(message); });
    await win.loadFile(path.join(scratch, 'fixture.html'));
    const js = source => win.webContents.executeJavaScript(source, true);
    const themes = ['tech', ...fs.readdirSync(path.join(root, 'src/styles')).filter(name => /^theme-(?!core).*\.css$/.test(name)).map(name => name.slice(6, -4))];
    let combinations = 0;
    for (const theme of themes) {
      const css = themeCss(theme);
      await js(`document.getElementById('theme').textContent=${JSON.stringify(css)}`);
      for (const mode of ['light', 'dark']) for (const locale of ['zh-CN', 'en-US']) for (const width of [220, 420]) {
        await js(`fixture.theme(${JSON.stringify(theme)},${JSON.stringify(mode)});fixture.language(${JSON.stringify(locale)}).then(()=>true)`);
        const result = await js(`(()=>{document.querySelector('.node-card').style.width='${width}px';const el=document.querySelector('select');return {count:el.options.length,ratio:el.value,overflow:el.scrollWidth>el.clientWidth+1,text:document.getElementById('controls').textContent,filter:getComputedStyle(el).filter}})()`);
        assert.equal(result.count, 8); assert.equal(result.ratio, '9:16'); assert.equal(result.overflow, false);
        assert.doesNotMatch(result.text, /nodes:generation/); assert.equal(result.filter, 'none'); combinations++;
      }
    }
    for (const ratio of require('../backend/src/shared/mossImageContract.json').ratios) {
      await js(`(()=>{const el=document.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(ratio)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.equal((await js('fixture.state()')).aspectRatio, ratio);
    }
    await js('fixture.restore(JSON.parse(JSON.stringify(fixture.state())))');
    assert.equal((await js('fixture.state()')).aspectRatio, '21:9');
    fs.mkdirSync(evidence, { recursive: true });
    await js(`document.getElementById('theme').textContent=${JSON.stringify(themeCss('rh'))};fixture.theme('rh','dark');fixture.restore({aspectRatio:'9:16'});document.querySelector('.node-card').style.width='420px';fixture.language('zh-CN').then(()=>true)`);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    fs.writeFileSync(path.join(evidence, 'controls-dark.png'), (await win.webContents.capturePage()).toPNG());
    await js(`document.getElementById('theme').textContent=${JSON.stringify(themeCss('pixel'))};fixture.theme('pixel','light')`);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    fs.writeFileSync(path.join(evidence, 'controls-pixel-light.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    const report = { passed: true, themes, combinations, eightActualDomEdits: true, stateRoundtrip: true,
      productionControlAndStyles: true, boundary: 'isolated software Chromium fixture, not full canvas or installed-client acceptance' };
    fs.writeFileSync(path.join(evidence, 'ui-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`); win.destroy(); app.exit(0);
  } catch (error) { process.stderr.write(`${error.stack}\n`); if (win) win.destroy(); app.exit(1); }
}
function launch() {
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw new Error('Authorized development worktree required');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-moss-ui-'));
  const env = { ...process.env, T8_MOSS_UI_PROFILE: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), ['--js-flags=--max-old-space-size=768', __filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.once('exit', code => {
    if (path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-moss-ui-')) fs.rmSync(scratch, { recursive: true, force: true });
    process.exitCode = code ?? 1;
  });
}
if (process.argv.some(value => path.resolve(value) === __filename)) (process.argv.includes('--launch') ? Promise.resolve(launch()) : main()).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
