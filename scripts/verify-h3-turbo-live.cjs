'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawn, execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util'), execute = promisify(execFile);
const { submitOnce } = require('./verify-seedream-flash-live.cjs');
const ROOT = path.resolve(__dirname, '..'), DIRECTORY = path.join(ROOT, 'local-private/h3-turbo-20261111');
function save(name, value) { const file = path.join(DIRECTORY, name); fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); fs.renameSync(file + '.tmp', file); }
async function main() {
  let key = process.env.SEEDANCE_NZ_API_KEY; delete process.env.SEEDANCE_NZ_API_KEY;
  if (!key || !process.argv.includes('--confirm-live')) throw Error('Explicit confirmation and process-only key required');
  const scratch = process.env.T8_H3_LIVE_PROFILE;
  if (!scratch || path.dirname(scratch) !== os.tmpdir() || !path.basename(scratch).startsWith('t8-h3-live-')) throw Error('Fresh isolated profile required');
  const { app, session } = require('electron'); app.setPath('userData', scratch); app.setPath('sessionData', scratch); app.disableHardwareAcceleration(); await app.whenReady();
  const network = session.fromPartition('t8-h3-live'), bridge = require('../electron/systemFetchBridge.cjs');
  bridge.installChromiumResponseHeaderBridge(network); bridge.installGlobalSystemFetchBridge({ chromiumFetch: network.fetch.bind(network), resolveHost: network.resolveHost.bind(network), refreshNetwork: async () => { await network.forceReloadProxyConfig(); await network.clearHostResolverCache(); } });
  const config = require('../backend/src/config'); config.OUTPUT_DIR = path.join(DIRECTORY, 'outputs'); config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json'); fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const provider = require('../backend/src/providers/seedanceNz'), download = require('../backend/src/routes/proxy')._test.saveRemoteFalToolboxFile, sharp = require('sharp');
  const reportFile = path.join(DIRECTORY, 'live-report.json');
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { schema: 't8-h3-turbo-live-v1', maximumCreationPosts: 6, results: [] };
  async function run(label, request, video = false) {
    console.log(JSON.stringify({ label, model: request.model, phase: 'start' })); const start = Date.now();
    const journal = path.join(DIRECTORY, label + '-private-task.json');
    if (!fs.existsSync(journal) && fs.readdirSync(DIRECTORY).filter(name => name.endsWith('-private-task.json')).length >= report.maximumCreationPosts) throw Error('Creation cap reached');
    const id = await submitOnce(journal, request.model, request, value => video ? provider.submitH3TurboVideoTask(value, key) : provider.submitImageTask(value, key));
    const finalFile = path.join(DIRECTORY, label + '-private-final.json'); let result = fs.existsSync(finalFile) ? JSON.parse(fs.readFileSync(finalFile, 'utf8')) : null;
    for (let poll = 0; !result || !['succeeded', 'failed'].includes(result.status); poll++) {
      if (poll >= 540) throw Error('Original task polling timed out; no paid replay');
      result = await (video ? provider.queryH3TurboVideoTask(id, key) : provider.queryImageTask(id, key));
      console.log(JSON.stringify({ label, phase: 'poll', status: result.status, progress: result.progress }));
      if (['succeeded', 'failed'].includes(result.status)) save(label + '-private-final.json', result); else await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (result.status !== 'succeeded') throw Object.assign(Error('Upstream task failed; no repeat'), { code: 'UPSTREAM_TASK_FAILED' });
    const urls = video ? [result.videoUrl] : result.imageUrls, outputs = [];
    if (!urls?.length) throw Error('Missing outputs');
    for (const [index, url] of urls.entries()) {
      const saved = await download(url, video ? 'video' : 'image', 'sd55-live:' + id + ':' + index); if (!saved.url) throw Error('Download incomplete; GET-only resume');
      const file = path.join(config.OUTPUT_DIR, path.basename(saved.url)), bytes = fs.readFileSync(file), output = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), localFile: path.basename(saved.url) };
      if (video) {
        const media = require('../backend/src/providers/llmMedia');
        const { stdout } = await execute(media.resolveBundledFfprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
        const probe = JSON.parse(stdout), stream = probe.streams.find(s => s.codec_type === 'video'); if (!stream) throw Error('No video stream');
        await execute(media.resolveBundledFfmpeg(), ['-v', 'error', '-threads', '1', '-i', file, '-map', '0:v:0', '-f', 'null', '-'], { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
        Object.assign(output, { width: stream.width, height: stream.height, frames: Number(stream.nb_frames), duration: Number(probe.format.duration), fullDecode: true });
      } else {
        const metadata = await sharp(bytes, { failOn: 'error' }).metadata(); await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
        Object.assign(output, { width: metadata.width, height: metadata.height, format: metadata.format, hasAlpha: metadata.hasAlpha, fullDecode: true });
      }
      outputs.push(output);
    }
    const row = { label, model: request.model, passed: true, outputs, elapsedSeconds: (Date.now() - start) / 1000, upstreamHttpStatus: result.upstreamHttpStatus };
    report.results = report.results.filter(item => item.label !== label); report.results.push(row); save('live-report.json', report); save(label + '-private-local.json', { id, files: outputs.map(o => path.join(config.OUTPUT_DIR, o.localFile)) }); console.log(JSON.stringify({ label, phase: 'passed', outputs: outputs.length }));
    return { id, outputs };
  }
  try {
    const c=provider.H3_TURBO_CONTRACT;
    const first=await run('minimax-text',{model:c.minimax.model,prompt:'A green ceramic teapot on a cream table, simple studio photography, no text.',resolution:'1k',ratio:'1:1',seed:0,output_format:'png'});
    const ref='data:image/png;base64,'+fs.readFileSync(path.join(config.OUTPUT_DIR,first.outputs[0].localFile)).toString('base64');
    const second='data:image/png;base64,'+(await sharp({create:{width:256,height:256,channels:3,background:'#205ab0'}}).png().toBuffer()).toString('base64');
    await run('minimax-edit',{model:c.minimax.model,prompt:'Keep the teapot shape from image one. Use the blue color from image two for its glaze.',images:[ref,second],resolution:'1k',ratio:'1:1',seed:0,output_format:'webp'});
    await run('qwen-text',{model:c.qwen.model,prompt:'A red toy robot on a cream table, simple studio photography, no text.',resolution:'1k',ratio:'1:1',seed:0});
    await run('qwen-edit',{model:c.qwen.model,prompt:'Keep the teapot shape from image one. Use the blue color from image two for its glaze.',images:[ref,second],resolution:'720p',ratio:'1:1',seed:0});
    await run('h3-text',{model:c.video.model,prompt:'A green teapot slowly rotates on a cream table, static camera.',seconds:'3',resolution:'480p',ratio:'16:9'},true);
    const samples=24000*3,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(4000*Math.sin(i*2*Math.PI*440/24000)),44+i*2);
    await run('h3-image-audio',{model:c.video.model,prompt:'The green teapot from image one gently rocks in time with the sound, static camera.',images:[ref],audios:['data:audio/wav;base64,'+wav.toString('base64')],seconds:'3',resolution:'480p',ratio:'16:9'},true);
    report.passed = true; save('live-report.json', report); key = null; app.exit(0);
  } catch (error) { report.passed = false; report.error = { name: error.name, code: error.code || 'LIVE_FAILED', status: error.status, upstreamHttpStatus: error.upstreamHttpStatus, message: String(error.message || '').split(key).join('[redacted]').replace(/https?:\/\/[^\s"']+|task_[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500) }; save('live-report.json', report); console.error(JSON.stringify({ phase: 'failed', ...report.error })); key = null; app.exit(1); }
}
async function launch() {
  execFileSync(process.execPath, ['scripts/worktree-role.cjs', 'development'], { cwd: ROOT, stdio: 'inherit' });
  if (!process.argv.includes('--confirm-live') || !process.env.SEEDANCE_NZ_API_KEY) throw Error('Explicit confirmation and process-only key required');
  fs.mkdirSync(DIRECTORY, { recursive: true }); const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-h3-live-'));
  const env = { ...process.env, T8_H3_LIVE_PROFILE: scratch, T8PC_DEV_DATA_ROOT: scratch, NODE_OPTIONS: '--max-old-space-size=768' }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, '--confirm-live'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); delete process.env.SEEDANCE_NZ_API_KEY; delete env.SEEDANCE_NZ_API_KEY;
  const log = fs.createWriteStream(path.join(DIRECTORY, 'live.log'), { flags: 'a' }); child.stdout.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); }); child.stderr.on('data', chunk => log.write(chunk));
  child.once('exit', code => { log.end(); const target = path.resolve(scratch); if (path.dirname(target) === os.tmpdir() && path.basename(target).startsWith('t8-h3-live-')) fs.rmSync(target, { recursive: true, force: true }); let passed = false; try { passed = JSON.parse(fs.readFileSync(path.join(DIRECTORY,'live-report.json'),'utf8')).passed === true; } catch {} process.exitCode = passed ? code ?? 1 : 1; });
}
if (require.main === module || process.argv[1] && path.resolve(process.argv[1]) === __filename) (process.argv.includes('--launch') ? launch() : main()).catch(error => { console.error(JSON.stringify({ phase: 'launcher-failed', name: error.name })); if (process.type === 'browser') require('electron').app.exit(1); else process.exitCode = 1; });
