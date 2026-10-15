'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'local-private/artcraft-ux-verification');
async function main(){
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const {app,BrowserWindow}=require('electron'),scratch=process.env.T8_EDIT_UI_SCRATCH;
  if(!scratch||path.dirname(path.resolve(scratch))!==path.resolve(os.tmpdir())||!path.basename(scratch).startsWith('t8-edit-ui-'))throw Error('Fresh temporary profile required');
  app.setPath('userData',scratch);app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-gpu');
  let win,server,deadline;
  try{
    process.env.GOMAXPROCS='1';process.env.GOMEMLIMIT='256MiB';
    const boardMode=process.argv.includes('--board');
    const bundle=await require('esbuild').build({bundle:true,write:false,outdir:path.join(scratch,'bundle'),format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
      stdin:{sourcefile:'image-edit-revisions-fixture.tsx',resolveDir:root,loader:'tsx',contents:boardMode?`
        import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import {ReactFlow,ReactFlowProvider,useReactFlow} from '@xyflow/react';import '@xyflow/react/dist/style.css';
        import i18next from 'i18next';import {initReactI18next} from 'react-i18next';
        import Board from './src/components/nodes/DrawingBoardNode';import {useCanvasStore} from './src/stores/canvas';
        import {creativeUxZh,creativeUxEn} from './src/i18n/creativeUxCatalog';
        i18next.use(initReactI18next).init({lng:'zh',fallbackLng:'zh',resources:{zh:{creativeUx:creativeUxZh},en:{creativeUx:creativeUxEn}}});
        useCanvasStore.setState({activeId:'board-fixture',canvases:[{id:'board-fixture',name:'Isolated fixture',status:'active'}] as any});
        const layers=[{id:'layer-1',kind:'layer',name:'Keep editable',elements:[{id:'shape-1',kind:'rect',x:10,y:10,w:30,h:20,color:'#37b8b0',size:2,fillMode:'fill'}]}];
        let rf:any;function Probe(){rf=useReactFlow();return null}
        const nodes=[{id:'board-1',type:'drawing-board',position:{x:0,y:0},selected:true,data:{boardWidth:160,boardHeight:120,boardLayers:layers,outputImageUrl:'/original.png',status:'success'}}];
        const nodeTypes={'drawing-board':Board,output:()=>null};
        flushSync(()=>createRoot(document.getElementById('root')!).render(<ReactFlowProvider><ReactFlow defaultNodes={nodes} nodeTypes={nodeTypes}/><Probe/></ReactFlowProvider>));
        window.fixture={state:()=>({records:rf.getNodes().filter(n=>n.type==='output'),board:rf.getNode('board-1').data}),layers:()=>layers,
          archive:()=>useCanvasStore.setState({canvases:[{id:'board-fixture',name:'Isolated fixture',status:'archived'}] as any})};
      `:`
        import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import i18next from 'i18next';import {initReactI18next} from 'react-i18next';
        import Editor from './src/components/nodes/ImageEditModal';import {creativeUxZh,creativeUxEn} from './src/i18n/creativeUxCatalog';
        import {collectImageEditRevisions} from './src/utils/imageEditRevisions';
        i18next.use(initReactI18next).init({lng:'zh',fallbackLng:'zh',resources:{zh:{creativeUx:creativeUxZh},en:{creativeUx:creativeUxEn}}});
        const records:any[]=[];let closed=0,reopen:any;
        function Fixture(){const [visible,show]=useState(true);reopen=show;const src=records.at(-1)?.data.imageUrl||'/original.png';
          return visible?<Editor srcUrl={src} revisionCandidates={collectImageEditRevisions(records,src)} onClose={()=>{closed++;show(false)}}
            onProduce={async(urls,meta)=>{for(const url of urls)records.push({data:{imageUrl:url,imageEditLineage:meta.imageEditLineage}})}}/>:<p>closed</p>;}
        flushSync(()=>createRoot(document.getElementById('root')!).render(<Fixture/>));
        window.fixture={state:()=>({closed,records}),reopen:()=>flushSync(()=>reopen(true))};
      `}});
    const config=(await import(require('node:url').pathToFileURL(path.join(root,'tailwind.config.js')).href)).default;
    const styles=await require('postcss')([require('tailwindcss')({...config,content:['src/components/nodes/DrawingBoardNode.tsx','src/components/nodes/ImageEditModal.tsx','src/components/ImageCompareModal.tsx','src/components/ImageCompareStage.tsx']})])
      .process(fs.readFileSync(path.join(root,'src/styles/index.css'),'utf8').replace(/^@import[^;]+;/gm,''),{from:path.join(root,'src/styles/index.css')});
    const core=fs.readFileSync(path.join(root,'src/styles/theme-core.css'),'utf8');
    const extraCss=bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
    const html=Buffer.from(`<!doctype html><html data-theme-mode="dark"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'unsafe-inline';connect-src 'self';img-src 'self' data: blob:"><style>${core}\n${styles.css}\n${extraCss}\n#root{width:100vw;height:100vh}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`);
    const sharp=require('sharp'),original=await sharp({create:{width:160,height:120,channels:3,background:'#37b8b0'}}).png().toBuffer();
    const images=new Map([['/original.png',original]]);let cropCount=0;
    server=http.createServer(async(req,res)=>{
      try{
        if(req.method==='POST'&&req.url==='/api/image/crop'){
          let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw Error('Unexpected large fixture request')}
          const body=JSON.parse(text),input=images.get(body.imageUrl);if(!input)throw Error('Unknown fixture input');
          const imageUrl='/crop-'+(++cropCount)+'.png';const png=await sharp(input).extract({left:body.x,top:body.y,width:body.w,height:body.h}).png().toBuffer();images.set(imageUrl,png);
          res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true,data:{imageUrl}}));return;
        }
        const bytes=req.url==='/fixture.js'?bundle.outputFiles[0].contents:req.url==='/'?html:images.get(req.url);
        if(!bytes){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':req.url==='/fixture.js'?'text/javascript':req.url==='/'?'text/html':'image/png'});res.end(bytes);
      }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:e.message}))}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await app.whenReady();
    win=new BrowserWindow({show:false,width:1320,height:960,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
    deadline=setTimeout(()=>{process.stderr.write('Image editor UI exceeded45s\n');win?.destroy();server?.closeAllConnections();server?.close();app.exit(1)},45000);
    const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3&&!/favicon/i.test(message))errors.push(message)});
    await win.loadURL('http://127.0.0.1:'+server.address().port+'/');const js=code=>win.webContents.executeJavaScript(code,true);
    const wait=async(code)=>{for(let n=0;n<100;n++){if(await js(code))return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error('UI condition not met: '+code)};
    const click=async(text)=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Button unavailable: '+${JSON.stringify(text)});b.click()})()`)};
    if(boardMode){
      await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="编辑输出版本"&&!b.disabled)');await click('编辑输出版本');
      await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="应用裁剪"&&!b.disabled)');
      assert.equal(await js('[...document.querySelectorAll(".img-edit-modal button")].some(b=>/RH抠图|标注改图/.test(b.textContent))'),false);
      await click('应用裁剪');await wait('fixture.state().records.length===1');
      await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="应用裁剪"&&!b.disabled)');
      await click('应用裁剪');await wait('fixture.state().records.length===2');
      const boardState=await js('fixture.state()');assert.deepEqual(boardState.board.boardLayers,await js('fixture.layers()'));
      assert.equal(boardState.board.outputImageUrl,'/original.png');assert.equal(boardState.records[1].data.imageEditLineage.parentUrl,'/crop-1.png');
      await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await wait('!document.querySelector(".img-edit-modal")');
      await click('编辑输出版本');await wait('document.querySelector("[data-image-edit-versions] select")?.options.length===3');
      await js('fixture.archive()');await wait('!document.querySelector(".img-edit-modal")');
      assert.equal(await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="编辑输出版本").disabled'),true);
      assert.deepEqual(errors,[]);
      const report={passed:true,productionComponents:['DrawingBoardNode','LazyImageEditModal','ImageEditModal'],actualCrops:cropCount,originalLayersUnchanged:true,originalExportUnchanged:true,separateOutputVersions:2,reopen:true,archiveClosesEditor:true,
        boundary:'fresh ReactFlow fixture; local Sharp crop transport, no full database/installation/paid Provider acceptance'};
      fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'drawing-board-edit-ui.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+'\n');
      clearTimeout(deadline);win.destroy();server.closeAllConnections();server.close();app.exit(0);return;
    }
    await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="应用裁剪"&&!b.disabled)');
    await click('应用裁剪');await wait('fixture.state().records.length===1');
    assert.equal(await js('document.querySelectorAll(".img-edit-modal").length'),1);assert.equal(await js('fixture.state().closed'),0);
    assert.equal(await js('document.querySelector("[data-image-edit-versions] select").options.length'),2);
    await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="应用裁剪"&&!b.disabled)');
    await click('应用裁剪');await wait('fixture.state().records.length===2');
    const state=await js('fixture.state()');assert.equal(state.records[1].data.imageEditLineage.parentUrl,'/crop-1.png');assert.equal(state.records[1].data.imageEditLineage.rootUrl,'/original.png');
    await click('与其他版本对比');await wait('Boolean(document.querySelector("[data-canvas-floating-ui=image-compare-modal]"))');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await wait('!document.querySelector("[data-canvas-floating-ui=image-compare-modal]")');assert.equal(await js('fixture.state().closed'),0);
    await js('(()=>{const s=document.querySelector("[data-image-edit-versions] select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,"original");s.dispatchEvent(new Event("change",{bubbles:true}))})()');
    await wait('document.querySelector(".img-edit-modal img")?.getAttribute("src")==="/original.png"');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await wait('fixture.state().closed===1');
    await js('fixture.reopen()');await wait('Boolean(document.querySelector("[data-image-edit-versions] select"))');
    assert.equal(await js('document.querySelector("[data-image-edit-versions] select").options.length'),3);
    await wait('Boolean(document.querySelector(".img-edit-modal img")?.complete&&document.querySelector(".img-edit-modal img")?.naturalWidth)');
    await wait('Number(getComputedStyle(document.querySelector(".img-edit-overlay")).opacity)>=0.99');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    assert.equal(images.get('/original.png'),original);assert.deepEqual(errors,[]);
    const screenshot=await win.webContents.capturePage();const bitmap=screenshot.toBitmap();let nonWhite=0;
    for(let i=0;i<bitmap.length;i+=4)if(Math.min(bitmap[i],bitmap[i+1],bitmap[i+2])<220)nonWhite++;
    if(nonWhite<=2000){const diagnostic=await js(`(()=>{const el=document.querySelector('.img-edit-overlay'),m=document.querySelector('.img-edit-modal'),s=getComputedStyle(el);return{overlay:el.getBoundingClientRect().toJSON(),modal:m.getBoundingClientRect().toJSON(),display:s.display,position:s.position,opacity:s.opacity,visibility:s.visibility,background:s.backgroundColor,body:getComputedStyle(document.body).cssText,text:document.body.textContent.slice(0,500),sheets:document.styleSheets.length}})()`);fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'image-edit-render-failure.json'),JSON.stringify({nonWhite,diagnostic},null,2));process.stderr.write(JSON.stringify(diagnostic)+'\n')}
    assert.ok(nonWhite>2000,'Editor must be painted, not just present in the DOM');
    fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'image-edit-versions.png'),screenshot.toPNG());
    const report={passed:true,productionComponent:'ImageEditModal',actualCrops:cropCount,continueWithoutReopen:true,compareEscapeKeepsEditor:true,originalUnchanged:true,
      lineageSurvivesReopen:true,boundary:'isolated software Chromium with deterministic local Sharp crop transport, no paid Provider/full canvas database/installation acceptance'};
    fs.writeFileSync(path.join(evidence,'image-edit-versions-ui.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+'\n');clearTimeout(deadline);win.destroy();server.closeAllConnections();server.close();app.exit(0);
  }catch(e){process.stderr.write(e.stack+'\n');clearTimeout(deadline);win?.destroy();server?.closeAllConnections();server?.close();app.exit(1)}
}
function launch(){const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'t8-edit-ui-')),env={...process.env,T8_EDIT_UI_SCRATCH:scratch};delete env.ELECTRON_RUN_AS_NODE;
 const child=require('node:child_process').spawn(require('electron'),['--js-flags=--max-old-space-size=512',__filename,...(process.argv.includes('--board')?['--board']:[])],{cwd:root,env,windowsHide:true,stdio:'inherit'});
 child.once('exit',code=>{if(path.dirname(path.resolve(scratch))===path.resolve(os.tmpdir())&&path.basename(scratch).startsWith('t8-edit-ui-'))fs.rmSync(scratch,{recursive:true,force:true});process.exitCode=code==null?1:code})}
if(process.argv.some(value=>path.resolve(value)===__filename))(process.argv.includes('--launch')?Promise.resolve(launch()):main()).catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1});
