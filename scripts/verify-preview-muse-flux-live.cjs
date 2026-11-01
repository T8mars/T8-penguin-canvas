'use strict';
// Isolated verifier only: never replay an accepted or ambiguous paid POST.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { submitOnce, safeError } = require('./verify-seedream-flash-live.cjs');
const { MIN_PROVIDER_MEDIA_TIMEOUT_MS } = require('../backend/src/providers/providerTimeoutPolicy');
const base='A friendly original blue toy robot next to a yellow ceramic cup on a cream table, studio illustration, no text.';
const CASES = [
 {id:'hy-text',model:'zhenzhen-image-hy-v3.5-preview'}, {id:'hy-custom-edit',model:'zhenzhen-image-hy-v3.5-preview',references:2},
 {id:'muse-image-text',model:'zhenzhen-image-muse'}, {id:'muse-image-edit',model:'zhenzhen-image-muse',references:2},
 ...['flux-3-image-t2i','flux-3-image-i2i','flux-3-image-klein-t2i','flux-3-image-klein-i2i'].map(model=>({id:model,model,references:model.endsWith('-i2i')?1:0})),
 {id:'muse-video-text',model:'zhenzhen-video-muse',video:true}, {id:'muse-video-reference',model:'zhenzhen-video-muse',video:true,references:2},
 {id:'motion-standard',model:'zhenzhen/motion-video',video:true,motion:true}
];
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'local-private/models-20261101');
function save(file, value) {
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
async function main() {
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw new Error('Authorized development worktree required');
  const key = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
  delete process.env.SEEDANCE_NZ_API_KEY;
  if (!key) throw new Error('API key required in process environment');
  const { app, session } = require('electron');
  if (!app) throw new Error('Use --launch');
  const scratch = process.env.T8_PMF_VERIFY_PROFILE;
  if (!scratch || path.dirname(scratch) !== os.tmpdir() || !path.basename(scratch).startsWith('t8-pmf-launch-')) throw new Error('Isolated launcher profile required');
  app.setPath('userData', scratch); app.setPath('sessionData', scratch);
  app.disableHardwareAcceleration();
  const outputDir = path.join(directory, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(directory, 'report.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : { schema: 't8-pmf-live-v1', channel: 'seedance-nz', startedAt: new Date().toISOString(), results: {} };
  const log = (id, phase, status) => process.stdout.write(`${JSON.stringify({ id, phase, ...(status ? { status } : {}) })}\n`);
  try {
    await app.whenReady();
    const network = session.fromPartition('t8-pmf-live');
    const bridge = require('../electron/systemFetchBridge.cjs');
    bridge.installChromiumResponseHeaderBridge(network);
    bridge.installGlobalSystemFetchBridge({ chromiumFetch: network.fetch.bind(network), resolveHost: network.resolveHost.bind(network),
      refreshNetwork: async () => { await network.forceReloadProxyConfig(); await network.clearHostResolverCache(); } });
    const config = require('../backend/src/config');
    config.OUTPUT_DIR = outputDir; config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json');
    const provider = require('../backend/src/providers/seedanceNz');
    const media = require('../backend/src/routes/proxy')._test;
    for (const item of CASES) {
      if (report.results[item.id]?.passed) { log(item.id, 'already-verified'); continue; }
      const reference=path.join(directory,'reference.png');
      if (!fs.existsSync(reference)) await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768"><rect width="768" height="768" fill="#eee4cc"/><rect x="120" y="190" width="280" height="340" rx="35" fill="#287bc1"/><circle cx="200" cy="300" r="25" fill="white"/><circle cx="320" cy="300" r="25" fill="white"/><rect x="480" y="380" width="130" height="140" rx="15" fill="#f5c829"/></svg>')).png().toFile(reference);
      const images=Array.from({length:item.references||0},()=>reference);
      const input={model:item.model,prompt:item.video?'Animate a blue toy robot waving gently beside a cup, a fixed camera and gentle natural sound.':base,...(images.length?{images}:{}),
       ...(item.model.includes('-hy-')? {resolution:'1K',seed:42,...(images.length?{width:1280,height:720}:{size:'1:1'})}:{}),
       ...(item.model.startsWith('flux-')?{resolution:'768sq',aspect_ratio:'1:1',safety_tolerance:2,...(item.model.includes('-klein-')?{seed:42,steps:4,output_format:'png'}:{grounding:false})}:{}),
       ...(item.model.includes('muse')?{size:item.video?'16:9':'3:2'}:{}),
       ...(item.motion?{prompt:'Create one clean minimal scene with a large blue circle gently moving across a plain cream background, with the short title HELLO centered and fully visible. Use flat Canvas 2D shapes and simple calm movement.',duration:15,ratio:'16:9',resolution:'720p',motion:{template_id:'swiss-minimal',title:'HELLO',music:'auto'}}:{})};
      let lastResult;
      try {
        log(item.id, 'submit-or-resume');
        const taskId = await submitOnce(path.join(directory, `${item.id}.state.private.json`), item.model, input,
          (body) => item.motion ? provider.submitMotionVideoTask(body,key) : item.video ? provider.submitMuseVideoTask(body,key) : provider.submitImageTask(body,key));
        const started = Date.now(); let result, previous = '', polls = 0;
        while (Date.now() - started < MIN_PROVIDER_MEDIA_TIMEOUT_MS) {
          result = item.motion ? await provider.queryMotionVideoTask(taskId,key) : item.video ? await provider.queryMuseVideoTask(taskId,key) : await provider.queryImageTask(taskId,key); polls++;
          lastResult = result;
          if (result.status !== previous) log(item.id, 'poll', result.status);
          previous = result.status;
          if (result.status === 'failed') throw new Error(result.failReason || 'Original task failed');
          if (result.status === 'succeeded') break;
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        if (result?.status !== 'succeeded') throw new Error('Original task nonterminal; resume GET only');
        const urls=item.video?[result.videoUrl || result.videoUrls?.[0]]:result.imageUrls;
        if(urls?.length!==1||!urls[0])throw Error('Expected exactly one completed output');
        const downloaded=await media.fetchProxyRemoteMedia(urls[0],{trustedProviderOutput:true,allowedKinds:[item.video?'video':'image'],maxBytes:512*1024*1024,deadlineMs:MIN_PROVIDER_MEDIA_TIMEOUT_MS,idleTimeoutMs:MIN_PROVIDER_MEDIA_TIMEOUT_MS});
        const file=path.join(outputDir,item.id+(item.video?'.mp4':'.'+media.verifiedProxyMediaExtension(downloaded)));
        fs.writeFileSync(file,downloaded.buffer);
        let details;
        if(item.video){
          const {spawnSync}=require('node:child_process');const {resolveBundledFfmpeg,resolveBundledFfprobe}=require('../backend/src/providers/llmMedia');
          const probe=spawnSync(resolveBundledFfprobe(),['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,encoding:'utf8',maxBuffer:2e6});if(probe.status!==0)throw Error('ffprobe failed');
          const decoded=spawnSync(resolveBundledFfmpeg(),['-v','error','-threads','1','-i',file,'-f','null','-'],{windowsHide:true,encoding:'utf8',timeout:180000});if(decoded.status!==0)throw Error('Full video decode failed');
          const info=JSON.parse(probe.stdout),v=info.streams.find(v=>v.codec_type==='video');if(!v)throw Error('No video stream');details={width:v.width,height:v.height,seconds:Number(info.format.duration),audio:info.streams.some(v=>v.codec_type==='audio'),fullDecode:true};
        }else{const metadata=await sharp(downloaded.buffer,{failOn:'error'}).metadata();const decoded=await sharp(downloaded.buffer,{failOn:'error'}).raw().toBuffer();if(!decoded.length)throw Error('Image decode failed');details={width:metadata.width,height:metadata.height,format:metadata.format,fullDecode:true};}
        report.results[item.id]={passed:true,model:item.model,references:images.length,upstreamHttpStatus:result.upstreamHttpStatus,status:result.status,polls,elapsedSeconds:(Date.now()-started)/1000,outputs:[{file:path.relative(root,file),bytes:downloaded.buffer.length,sha256:crypto.createHash('sha256').update(downloaded.buffer).digest('hex'),...details}]};
        log(item.id, 'verified', 'passed');
      } catch (error) {
        report.results[item.id] = { passed: false, model: item.model, referenceCount: images.length,
          ...(lastResult ? { providerTerminalStatus: lastResult.status, upstreamHttpStatus: lastResult.upstreamHttpStatus, usage: lastResult.usage } : {}),
          error: safeError(error, key) };
        log(item.id, 'failed', report.results[item.id].error);
      }
      save(reportPath, report);
    }
    report.passed = CASES.every((item) => report.results[item.id]?.passed);
    report.requiredModesPassed = [0, 1].every((count) => CASES.some((item) => (item.references || 0) === count && report.results[item.id]?.passed));
    report.completedAt = new Date().toISOString(); save(reportPath, report);
    app.exit(report.passed ? 0 : 1);
  } catch (error) { process.stderr.write(`${safeError(error, key)}\n`); app.exit(1); }
}
async function launch() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-pmf-launch-'));
  // Parent owns the exact temporary profile so cleanup happens after Electron releases it.
  let key = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
  if (!key) {
    process.stdout.write('Waiting for API key on hidden stdin (not saved).\n');
    const { Writable } = require('node:stream');
    const input = require('node:readline').createInterface({ input: process.stdin,
      output: new Writable({ write(_chunk, _encoding, done) { done(); } }), terminal: Boolean(process.stdin.isTTY) });
    key = await new Promise((resolve) => input.once('line', (line) => { input.close(); resolve(line.trim()); })); input.close();
  }
  if (!key) throw new Error('API key required');
  const env = { ...process.env, SEEDANCE_NZ_API_KEY: key, T8_PMF_VERIFY_PROFILE: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  delete env.SEEDANCE_NZ_API_KEY; key = null;
  const cleanup = () => fs.rmSync(scratch, { recursive: true, force: true });
  child.once('exit', (code) => { cleanup(); process.exitCode = code ?? 1; });
  child.once('error', () => { cleanup(); process.stderr.write('Cannot launch verifier\n'); process.exitCode = 1; });
}
if (require.main === module || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  (process.argv.includes('--launch') ? launch() : main()).catch((error) => { process.stderr.write(`${safeError(error)}\n`); process.exit(1); });
}
