'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { submitOnce } = require('./verify-seedream-flash-live.cjs');
const ROOT = path.resolve(__dirname, '..'), DIRECTORY = path.join(ROOT, 'local-private', 'tripo-20261111');
const CASES = ['generate', 'segment', 'complete'];
function save(name, value) { const file = path.join(DIRECTORY, name); fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); fs.renameSync(file + '.tmp', file); }
async function main() {
  let key = process.env.SEEDANCE_NZ_API_KEY || ''; delete process.env.SEEDANCE_NZ_API_KEY;
  if (!key || !process.argv.includes('--confirm-live')) throw Error('Requires explicit --confirm-live and process-only SEEDANCE_NZ_API_KEY');
  const scratch = process.env.T8_TRIPO_LIVE_PROFILE;
  if (!scratch || path.dirname(scratch) !== os.tmpdir() || !path.basename(scratch).startsWith('t8-tripo-live-')) throw Error('Fresh isolated profile required');
  const { app, session } = require('electron'); app.setPath('userData', scratch); app.setPath('sessionData', scratch); app.disableHardwareAcceleration();
  await app.whenReady();
  const network = session.fromPartition('t8-tripo-live'), bridge = require('../electron/systemFetchBridge.cjs');
  bridge.installChromiumResponseHeaderBridge(network);
  bridge.installGlobalSystemFetchBridge({ chromiumFetch: network.fetch.bind(network), resolveHost: network.resolveHost.bind(network), refreshNetwork: async () => { await network.forceReloadProxyConfig(); await network.clearHostResolverCache(); } });
  const config = require('../backend/src/config'); config.OUTPUT_DIR = path.join(DIRECTORY, 'outputs'); config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json'); fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const provider = require('../backend/src/providers/seedanceNz'), tripo = require('../backend/src/providers/tripo3d');
  const download = require('../backend/src/routes/proxy')._test.saveRemoteFalToolboxFile;
  const report = { schema: 't8-tripo-three-task-live-v1', results: [], maximumCreationPosts: 3 };
  let generated, segmented, previousSaved;
  try {
    for (const label of CASES) {
      let request;
      if (label === 'generate') request = { model: 'tripo-p-p1-text-to-3d', prompt: 'A simple low-poly toy robot, large square head, short torso, two separate arms and two legs, standing upright.', metadata: { face_limit: 1000, texture: false, pbr: false, model_seed: 0 } };
      else if (label === 'segment') request = { model: 'tripo-mesh-segment-v1', metadata: { model_url: generated.modelUrl } };
      else {
        const names = previousSaved.partNames.filter(name => name.startsWith('tripo_part_'));
        if (!segmented.tripoTaskId || !names.length) throw Error('Segmentation has no native ID or named parts; no completion POST');
        request = { model: 'tripo-mesh-complete', metadata: { tripo_segment_task_id: segmented.tripoTaskId, completion_mode: 'quick_cap', part_names: names.slice(0, 1) } };
      }
      const start = Date.now(), stateFile = path.join(DIRECTORY, `${label}-private-task.json`);
      console.log(JSON.stringify({ case: label, phase: 'start', model: request.model }));
      const taskId = await submitOnce(stateFile, request.model, request, input => provider.submitHunyuan3dTask(input, key));
      const finalFile = path.join(DIRECTORY, `${label}-private-final.json`);
      let result = fs.existsSync(finalFile) ? JSON.parse(fs.readFileSync(finalFile, 'utf8')) : null;
      for (let poll = 0; !result || !['succeeded', 'failed'].includes(result.status); poll++) {
        if (poll >= 540) throw Error('Original task polling timed out; GET-only resume required');
        result = await provider.queryHunyuan3dTask(taskId, key, { model: request.model });
        if (poll % 6 === 0) console.log(JSON.stringify({ case: label, phase: 'poll', status: result.status, progress: result.progress }));
        if (['succeeded', 'failed'].includes(result.status)) save(`${label}-private-final.json`, result);
        else await new Promise(resolve => setTimeout(resolve, 5000));
      }
      if (result.status !== 'succeeded') throw Error('Upstream task failed; no new submission');
      const saved = await tripo.materialize(result, download, taskId);
      if (!saved) throw Error('Result download incomplete; resume the same task');
      const file = path.join(config.OUTPUT_DIR, path.basename(saved.modelUrl));
      const buffer = fs.readFileSync(file), document = require('../backend/src/providers/providerOutputFormats').inspectGlb(buffer);
      if (!document.meshes?.length) throw Error('No mesh in verified GLB');
      const row = { case: label, model: request.model, passed: true, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), meshes: document.meshes.length, partNames: saved.partNames.length, files: saved.files.length, hasNativeId: Boolean(saved.tripoTaskId), elapsedSeconds: (Date.now() - start) / 1000, fullGlbValidation: true, upstreamHttpStatus: result.upstreamHttpStatus };
      report.results.push(row); save('live-report.json', report); console.log(JSON.stringify(row));
      save(`${label}-private-local.json`, saved);
      if (label === 'generate') generated = result;
      if (label === 'segment') segmented = result;
      previousSaved = saved;
    }
    report.passed = true; save('live-report.json', report); key = null; app.exit(0);
  } catch (error) {
    report.passed = false; report.error = { name: error.name, code: String(error.code || 'TRIPO_LIVE_FAILED') }; save('live-report.json', report);
    console.error(JSON.stringify({ phase: 'failed', ...report.error })); key = null; app.exit(1);
  }
}
async function launch() {
  execFileSync(process.execPath, ['scripts/worktree-role.cjs', 'development'], { cwd: ROOT, stdio: 'inherit' });
  if (!process.argv.includes('--confirm-live') || !process.env.SEEDANCE_NZ_API_KEY) throw Error('Explicit confirmation and process-only key required');
  fs.mkdirSync(DIRECTORY, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-tripo-live-'));
  const env = { ...process.env, T8_TRIPO_LIVE_PROFILE: scratch, T8PC_DEV_DATA_ROOT: scratch, NODE_OPTIONS: '--max-old-space-size=768' }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, '--confirm-live'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  delete env.SEEDANCE_NZ_API_KEY; delete process.env.SEEDANCE_NZ_API_KEY;
  const log = fs.createWriteStream(path.join(DIRECTORY, 'live.log'), { flags: 'a' });
  child.stdout.on('data', bytes => { log.write(bytes); process.stdout.write(bytes); }); child.stderr.on('data', bytes => log.write(bytes));
  child.once('exit', code => { log.end(); const target = path.resolve(scratch); if (path.dirname(target) === os.tmpdir() && path.basename(target).startsWith('t8-tripo-live-')) fs.rmSync(target, { recursive: true, force: true }); process.exitCode = code ?? 1; });
}
if (require.main === module || process.argv[1] && path.resolve(process.argv[1]) === __filename) (process.argv.includes('--launch') ? launch() : main()).catch(error => { console.error(JSON.stringify({ phase: 'launcher-failed', name: error.name })); process.exitCode = 1; });
module.exports = { CASES };
