'use strict';
// Real Chromium + production controls/CSS, isolated from user canvases/databases.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'local-private/nb-lowprice-doubao-live-20261013');
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const { app, BrowserWindow } = require('electron');
  const scratch = process.env.T8_CRISP_UI_SCRATCH;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-crisp-ui-')) throw new Error('Fresh isolated profile required');
  app.setPath('userData', scratch); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu');
  let win;
  try {
    process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '512MiB';
    const bundle = path.join(scratch, 'fixture.js');
    await require('esbuild').build({ bundle: true, outfile: bundle, platform: 'browser', format: 'esm', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, sourcefile: 'crisp-controls-fixture.tsx', loader: 'tsx', contents: `
        import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
        import i18next from 'i18next'; import {initReactI18next} from 'react-i18next';
        import Controls from './src/components/nodes/DoubaoVoiceControls';
        import {doubaoVoiceZh, doubaoVoiceEn} from './src/i18n/doubaoVoiceCatalog';
        import {applyThemeTemplate} from './src/theme/applyTheme';
        import {BUILT_IN_THEME_TEMPLATES} from './src/theme/defaultTemplates';
        i18next.use(initReactI18next).init({lng:'zh', fallbackLng:'zh', resources:{zh:{nodes:{audio:{doubaoVoice:doubaoVoiceZh}}},en:{nodes:{audio:{doubaoVoice:doubaoVoiceEn}}}}});
        let state:any, setMode:any, setParams:any;
        function Fixture(){const [clone,mode]=useState(false),[params,edit]=useState({}),[speaker,speak]=useState('');state={clone,params,speaker};setMode=mode;setParams=edit;
          return <Controls clone={clone} params={params} onChange={edit} speaker={speaker} onSpeakerChange={speak}/>;}
        const reactRoot=createRoot(document.getElementById('controls')!); flushSync(()=>reactRoot.render(<Fixture/>));
        (window as any).fixture={state:()=>JSON.parse(JSON.stringify(state)), mode:(value:boolean)=>flushSync(()=>setMode(value)),
          restore:(value:any)=>flushSync(()=>setParams(value)), language:(value:string)=>i18next.changeLanguage(value),
          theme:(style:string,mode:any)=>{const aliases:any={dragonball:'dragon-ball',soccer:'soccer-hero',saintseiya:'saint-seiya'};const template=BUILT_IN_THEME_TEMPLATES.find(item=>item.visuals?.style===(aliases[style]||style));if(!template)throw Error('Missing production theme '+style);applyThemeTemplate(template,mode);}};
      ` } });
    const core = fs.readFileSync(path.join(root, 'src/styles/theme-core.css'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'src/styles/index.css'), 'utf8').replace(/^@import[^;]+;/m, '');
    const html = `<!doctype html><html data-theme-visual="rh" data-theme-mode="dark"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'"><style>${core}\n${css}</style><style>
      body{margin:0;font-family:Arial,'Microsoft YaHei',sans-serif} .t8-canvas-shell{min-height:900px;padding:24px}
      .react-flow__node{width:420px;transform-origin:0 0;position:relative;filter:blur(1px);backdrop-filter:blur(12px)}
      .node-card{padding:14px;background:#172410;border:1px solid #73a830;border-radius:12px;color:#dce9d3}
      header{font-size:18px;font-weight:bold}label{display:block;font-size:12px;margin:8px 0}select,input,textarea{display:block;width:95%;padding:6px;color:inherit;background:#111b0b;border:1px solid #556837}
      p{font-size:12px}summary{font-size:12px} .media-proof{filter:brightness(.75);width:12px;height:12px}
    </style><style id="theme"></style><div id="root"><div class="t8-app-shell"><div class="t8-canvas-shell" data-canvas-surface-load="heavy" data-canvas-zoom-readability="detail"><div class="react-flow"><div class="react-flow__viewport"><div class="react-flow__node"><div class="node-card"><header>音频 · Seed Audio</header><p>松开画布后保持文字清晰 / crisp text after release</p><div id="controls"></div><img class="media-proof" alt="media filter remains" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></div></div></div></div></div></div></div><script type="module" src="fixture.js"></script></html>`;
    fs.writeFileSync(path.join(scratch, 'fixture.html'), html);
    await app.whenReady();
    win = new BrowserWindow({ show: false, width: 1000, height: 1000, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    await win.loadFile(path.join(scratch, 'fixture.html'));
    const js = source => win.webContents.executeJavaScript(source, true);
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) errors.push(message); });
    const themes = ['tech', ...fs.readdirSync(path.join(root, 'src/styles')).filter(name => /^theme-(?!core).*\.css$/.test(name)).map(name => name.slice(6, -4))];
    let combinations = 0;
    for (const theme of themes) {
      const themeCss = theme === 'tech' ? '' : fs.readFileSync(path.join(root, `src/styles/theme-${theme}.css`), 'utf8');
      const result = await js(`(()=>{document.getElementById('theme').textContent=${JSON.stringify(themeCss)}; const html=document.documentElement,shell=document.querySelector('.t8-canvas-shell'),node=document.querySelector('.react-flow__node');
        html.dataset.themeVisual=${JSON.stringify(theme)};const failed=[];let count=0;
        for(const mode of ['light','dark']) for(const zoom of [.45,.7,.89,1,1.1,1.4]) for(const status of ['idle','pan','drag','released-selected']){
          fixture.theme(${JSON.stringify(theme)},mode);shell.className='t8-canvas-shell'+(status==='pan'?' t8-viewport-moving':status==='drag'?' t8-node-dragging':'');node.classList.toggle('selected',status==='released-selected');
          shell.dataset.canvasZoomReadability=zoom<.55?'overview':zoom<.9?'compact':'detail';document.querySelector('.react-flow__viewport').style.transform='translate(0.25px,0.5px) scale('+zoom+')';
          for(const el of document.querySelectorAll('.react-flow__node, .node-card, header, p, #controls, #controls div, label, input, select, textarea, span, details, summary')){const s=getComputedStyle(el);if(s.filter!=='none'||s.backdropFilter!=='none')failed.push({mode,zoom,status,tag:el.tagName,filter:s.filter,backdrop:s.backdropFilter});}
          count++;}
        return {failed,count,mediaFilter:getComputedStyle(document.querySelector('.media-proof')).filter};})()`);
      assert.deepEqual(result.failed, [], `Node text filters: ${theme}`);
      // Some existing themes intentionally override image filters themselves.
      // The un-themed fixture proves this new crisp rule doesn't remove them.
      if (theme === 'tech') assert.notEqual(result.mediaFilter, 'none');
      combinations += result.count;
    }
    const edit = (name, value) => js(`(()=>{const el=document.querySelector('[name="'+${JSON.stringify(name)}+'"]');if(!el)throw Error('missing field');const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
    await edit('speech_rate', '0.5'); await edit('pitch', '-3'); await edit('format', 'wav');
    const continuous = await js('fixture.state()');
    assert.deepEqual(continuous.params, { speech_rate: .5, pitch: -3, format: 'wav' });
    assert.equal(await js('Boolean(document.querySelector("[name=context_texts]"))'), false);
    await edit('voice_model', 'api_default');
    assert.equal(await js('Boolean(document.querySelector("[name=context_texts]"))'), true);
    await edit('context_texts', '温柔、清晰地朗读'); await edit('enable_subtitle', 'disabled');
    const saved = await js('fixture.state().params'); await js('fixture.restore({format:"mp3"})'); await js(`fixture.restore(${JSON.stringify(saved)})`);
    assert.deepEqual(await js('fixture.state().params'), saved);
    await js('fixture.mode(true)');
    assert.equal(await js('Boolean(document.querySelector("[name=custom_speaker_id]"))'), true);
    assert.equal(await js('Boolean(document.querySelector("[name=voice_model]"))'), false);
    await edit('custom_speaker_id', 'LocalFixtureVoice'); await edit('language', '1'); await edit('speaker_id', 'DifferentProviderId');
    const clone = await js('fixture.state().params'); assert.equal(clone.custom_speaker_id, 'LocalFixtureVoice'); assert.equal(clone.speaker_id, 'DifferentProviderId');
    await js('fixture.language("en").then(()=>true)'); assert.match(await js('document.getElementById("controls").textContent'), /Custom speaker ID/);
    await js('fixture.language("zh").then(()=>true)'); await js('fixture.mode(false)');
    await js(`document.getElementById('theme').textContent=${JSON.stringify(fs.readFileSync(path.join(root, 'src/styles/theme-rh.css'), 'utf8'))};fixture.theme('rh','dark');document.querySelector('.t8-canvas-shell').className='t8-canvas-shell';document.querySelector('.react-flow__viewport').style.transform='scale(1)';document.querySelector('.react-flow__node').classList.remove('selected');`);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, 'crisp-controls-dark.png'), (await win.webContents.capturePage()).toPNG());
    await js("fixture.theme('rh','light')");
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    fs.writeFileSync(path.join(evidence, 'crisp-controls-light.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    const report = { passed: true, electron: process.versions.electron, themes, combinations, productionStylesAndControls: true,
      continuousEdits: true, canonicalReload: true, modelConditionalFields: true, languages: ['zh','en'], mediaFilterRetained: true,
      boundary: 'isolated software-rendered fixture; not full application/installed client or affected user GPU acceptance' };
    fs.writeFileSync(path.join(evidence, 'ui-report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report)}\n`); win.destroy(); app.exit(0);
  } catch (error) { process.stderr.write(`${error.stack}\n`); if (win) win.destroy(); app.exit(1); }
}
function launch() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-crisp-ui-'));
  const env = { ...process.env, T8_CRISP_UI_SCRATCH: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), ['--js-flags=--max-old-space-size=768', __filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.once('exit', code => {
    if (path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-crisp-ui-')) fs.rmSync(scratch, { recursive: true, force: true });
    process.exitCode = code || 0;
  });
}
if (process.argv.some(value => path.resolve(value) === __filename)) (process.argv.includes('--launch') ? Promise.resolve(launch()) : main()).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
