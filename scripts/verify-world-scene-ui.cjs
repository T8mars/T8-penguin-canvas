'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/artcraft-ux-verification');
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const { app, BrowserWindow, nativeImage } = require('electron');
  const scratch = process.env.T8_WORLD_UI_SCRATCH;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-world-ui-')) throw Error('Fresh temporary profile required');
  app.setPath('userData', scratch);
  app.commandLine.appendSwitch('use-gl', 'angle'); app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  let win, server, deadline;
  try {
    process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '256MiB';
    const build = await require('esbuild').build({ bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, sourcefile: 'world-scene-fixture.tsx', loader: 'tsx', contents: `
        import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import i18next from 'i18next';import {initReactI18next} from 'react-i18next';
        import Viewer from './src/features/world-scene/WorldSceneViewer';
        import {SplatMesh,writeSpz} from '@sparkjsdev/spark';
        import {creativeUxZh} from './src/i18n/creativeUxCatalog';
        import {prepareGaussianSceneBytes} from './src/utils/gaussianSceneBytes';
        i18next.use(initReactI18next).init({lng:'zh',resources:{zh:{creativeUx:creativeUxZh}}});
        let handle:any,show:any,setSource:any,ready=false,changes:any[]=[],unhandled:string[]=[];
        window.addEventListener('unhandledrejection',event=>unhandled.push(String(event.reason)));
        function Fixture(){const ref=useRef(null),[visible,display]=useState(true),[source,choose]=useState({id:'own-ply',url:'/scene.ply',format:'ply',name:'own.ply'});handle=ref;show=display;setSource=choose;
          return visible?<Viewer ref={ref} source={source as any} camera={{position:[0,0,4],target:[0,0,0],fov:55}} onReady={v=>{ready=v}} onCameraChange={c=>changes.push(c)}/>:<p>closed</p>;}
        flushSync(()=>createRoot(document.getElementById('root')!).render(<Fixture/>));
        window.fixture={ready:()=>ready,camera:()=>handle.current?.getCamera(),setCamera:c=>handle.current?.setCamera(c),
          source:(format,large=false)=>flushSync(()=>setSource({id:'own-'+format+(large?'-large':''),url:large?'/large.splat':'/scene.'+format,format,name:'own.'+format})),
          show:v=>flushSync(()=>show(v)),changes:()=>changes,
          unhandled:()=>unhandled,
          captureAndMove:async()=>{const pending=handle.current.captureFrame();handle.current.setCamera({position:[8,2,4],target:[0,0,0],fov:70});const frame=await pending;return {camera:frame.camera,bytes:frame.blob.size}},
          concurrent:async()=>{const frames=await Promise.all([handle.current.captureFrame(),handle.current.captureFrame()]);return frames.map(f=>f.blob.size)},
          abortCapture:async()=>{const controller=new AbortController();const pending=handle.current.capture(controller.signal);controller.abort();try{await pending;return false}catch(e){return e.name==='AbortError'}},
          captureAndClose:async()=>{const pending=handle.current.capture();flushSync(()=>show(false));try{await pending;return 'resolved'}catch(e){return 'rejected'}},
          capture:async()=>{const b=await handle.current.capture();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(b)})},
          encode:async()=>{const bytes=await prepareGaussianSceneBytes(await fetch('/scene.ply').then(r=>r.arrayBuffer()));const m=new SplatMesh({fileBytes:bytes});await m.initialized;
            try{const {fileBytes}=await writeSpz(m.packedSplats,{version:2});return Array.from(fileBytes)}finally{m.dispose()}}};
      ` } });
    const props = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
    const ply = Buffer.from(['ply','format ascii 1.0','element vertex 3',...props.map(p=>'property float '+p),'end_header',
      '-0.5 0 0 1.7 -1 -1 7 -1.5 -1.5 -1.5 1 0 0 0', '0.5 0 0 -1 1.7 -1 7 -1.5 -1.5 -1.5 1 0 0 0', '0 0.65 0 -1 -1 1.7 7 -1.5 -1.5 -1.5 1 0 0 0',''].join('\n'));
    let spz = null;
    const {gaussianFixture}=require('./lib/gaussian-fixtures.cjs');
    const splat=gaussianFixture('splat'),ksplat=gaussianFixture('ksplat'),large=gaussianFixture('splat',100000);
    const script = build.outputFiles[0].contents;
    const html = Buffer.from(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self' 'wasm-unsafe-eval';style-src 'unsafe-inline';connect-src 'self' data: blob:;worker-src blob:;img-src 'self' data: blob:"><style>body{margin:0}#root{width:800px;height:600px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`);
    server = http.createServer((req,res) => {
      const data = req.url === '/fixture.js' ? script : req.url === '/scene.ply' ? ply : req.url === '/scene.spz' ? spz : req.url === '/scene.splat' ? splat : req.url === '/scene.ksplat' ? ksplat : req.url === '/large.splat' ? large : req.url === '/' ? html : null;
      if (!data) { res.writeHead(404); res.end(); return; }
      res.writeHead(200,{ 'Content-Type': req.url === '/fixture.js' ? 'text/javascript' : req.url === '/' ? 'text/html' : 'application/octet-stream', 'Content-Length':data.length }); res.end(data);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    await app.whenReady();
    win = new BrowserWindow({ show:false,width:800,height:640,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
    deadline = setTimeout(()=>{process.stderr.write('World scene UI exceeded60s deadline\n');win?.destroy();server?.closeAllConnections();server?.close();app.exit(1)},60000);
    const errors=[]; win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    const js=code=>win.webContents.executeJavaScript(code,true);
    const ready=async()=>{for(let n=0;n<100;n++){if(await js('Boolean(window.fixture?.ready())'))return;const error=await js('document.querySelector("[role=alert]")?.textContent');if(error)throw Error(error);await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Viewer did not become ready')};
    await ready();
    const initial=await js('fixture.camera()');assert.ok(initial.position.every((value,index)=>Math.abs(value-[0,0,4][index])<1e-8));
    await js('fixture.setCamera({position:[1,0,4],target:[0,0,0],fov:40})');
    assert.equal((await js('fixture.camera()')).fov,40);
    const encode=await js('fixture.encode()'); spz=Buffer.from(encode);assert.ok(spz.length>20);
    const png=Buffer.from(await js('fixture.capture()'),'base64');const rendered=nativeImage.createFromBuffer(png);assert.equal(rendered.isEmpty(),false);
    const bitmap=rendered.toBitmap();let colored=0;for(let i=0;i<bitmap.length;i+=4){if(Math.max(bitmap[i],bitmap[i+1],bitmap[i+2])-Math.min(bitmap[i],bitmap[i+1],bitmap[i+2])>80)colored++;}
    assert.ok(colored>500,`Actual splat render lacked colored pixels: ${colored}`);
    const frozen=await js('fixture.captureAndMove()');assert.equal(frozen.camera.fov,40);assert.ok(frozen.bytes>500);
    assert.equal((await js('fixture.camera()')).fov,70);
    const concurrent=await js('fixture.concurrent()');assert.ok(concurrent.every(bytes=>bytes>500));
    assert.equal(await js('fixture.abortCapture()'),true);
    await js('fixture.source("spz")');await ready();
    const spzPng=Buffer.from(await js('fixture.capture()'),'base64');assert.equal(nativeImage.createFromBuffer(spzPng).isEmpty(),false);
    const formatPixels={ply:colored};
    for(const format of ['splat','ksplat']){
      await js(`fixture.source(${JSON.stringify(format)})`);await ready();
      const image=nativeImage.createFromBuffer(Buffer.from(await js('fixture.capture()'),'base64')),pixels=image.toBitmap();let count=0;
      for(let i=0;i<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>80)count++;
      assert.ok(count>500,`${format} decoded no real colored Gaussians (${count})`);formatPixels[format]=count;
    }
    const loadStart=Date.now();await js('fixture.source("splat",true)');await ready();const largeLoadMs=Date.now()-loadStart;
    const largePng=Buffer.from(await js('fixture.capture()'),'base64');assert.ok(largePng.length>1000);
    const rendererMetrics=app.getAppMetrics().filter(metric=>metric.type==='Tab').map(metric=>({workingSetKiB:metric.memory.workingSetSize,peakWorkingSetKiB:metric.memory.peakWorkingSetSize}));
    assert.equal(await js('fixture.captureAndClose()'),'rejected');
    assert.equal(await js('document.querySelectorAll("canvas").length'),0);assert.equal(await js('fixture.ready()'),false);
    await js('fixture.show(true)');await ready();
    assert.deepEqual(await js('fixture.unhandled()'),[]);
    const acceptable=errors.filter(message=>!/favicon|WebGL: CONTEXT_LOST_WEBGL|GL Driver Message|GPU stall due to ReadPixels/i.test(message));
    assert.deepEqual(acceptable,[]);
    fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'world-ply.png'),png);fs.writeFileSync(path.join(evidence,'world-spz.png'),spzPng);
    const report={passed:true,renderer:'Spark 2.3.1 + Three (production WorldSceneViewer)',source:'self-authored Gaussians; ASCII PLY, encoded SPZ v2, SPLAT and uncompressed KSPLAT v0.1',
      actualColoredPixels:colored,spzBytes:spz.length,cameraRestore:true,frozenSnapshotCamera:true,serializedConcurrentCaptures:true,abortCapture:true,captureDuringClose:true,unhandledRejections:0,unmountRelease:true,reopen:true,
      formatPixels,syntheticLoad:{points:100000,bytes:large.length,loadMs:largeLoadMs,captureBytes:largePng.length,rendererMetrics},
      boundary:'isolated SwiftShader renderer with bounded100k synthetic load; not installed client, physical GPU, large real-user scene, full node/Run persistence or world-generation provider'};
    fs.writeFileSync(path.join(evidence,'world-viewer-ui.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+'\n');
    fs.writeFileSync(path.join(scratch,'completed.json'),'{}');clearTimeout(deadline);win.destroy();server.closeAllConnections();server.close();app.exit(0);
  }catch(e){process.stderr.write(e.stack+'\n');clearTimeout(deadline);win?.destroy();server?.closeAllConnections();server?.close();app.exit(1)}
}
function launch(){const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'t8-world-ui-'));const env={...process.env,T8_WORLD_UI_SCRATCH:scratch};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require('electron'),['--js-flags=--max-old-space-size=512',__filename],{cwd:root,env,windowsHide:true,stdio:'inherit'});
  child.once('exit',code=>{const complete=fs.existsSync(path.join(scratch,'completed.json'));if(code===0&&complete&&path.dirname(path.resolve(scratch))===path.resolve(os.tmpdir())&&path.basename(scratch).startsWith('t8-world-ui-'))fs.rmSync(scratch,{recursive:true,force:true});else process.stderr.write('Failed fixture retained at '+scratch+'\n');process.exitCode=code===0&&complete?0:1})}
if(process.argv.some(value=>path.resolve(value)===__filename))(process.argv.includes('--launch')?Promise.resolve(launch()):main()).catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1});
