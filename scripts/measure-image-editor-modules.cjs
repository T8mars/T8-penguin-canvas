'use strict';
// Diagnostic only: in-memory module graphs, not a production application build.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), { execFileSync } = require('node:child_process'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const entries = ['src/components/nodes/UploadNode.tsx', 'src/components/nodes/OutputNode.tsx'];
const baselineFiles = [...entries, 'src/components/nodes/ImageEditModal.tsx', 'src/components/nodes/VideoEditNode.tsx'];
const slash = value => value.replaceAll('\\', '/');
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  process.env.GOMAXPROCS = '1'; process.env.GOMEMLIMIT = '256MiB';
  const esbuild = require('esbuild');
  try {
    const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    const original = new Map(baselineFiles.map(file => [path.resolve(root, file).toLowerCase(), execFileSync('git', ['show', `${baselineCommit}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true })]));
    const options = { absWorkingDir: root, entryPoints: entries, bundle: true, splitting: true, format: 'esm', platform: 'browser', jsx: 'automatic', write: false, metafile: true,
      outdir: path.join(os.tmpdir(), 't8-module-diagnostic-in-memory'), define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' } };
    const baseline = await esbuild.build({ ...options, plugins: [{ name: 'read-only-head-baseline', setup(build) { build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, args => {
      const contents = original.get(path.resolve(args.path).toLowerCase()); return contents === undefined ? undefined : { contents, loader: args.path.endsWith('tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) };
    }); } }] });
    const current = await esbuild.build(options);
    const describe = (result, entry) => {
      const outputs = result.metafile.outputs;
      const start = Object.keys(outputs).find(file => slash(outputs[file].entryPoint || '') === entry); assert.ok(start);
      const seen = new Set(), inputs = new Set();
      const visit = file => { if (seen.has(file)) return; seen.add(file); for (const input of Object.keys(outputs[file]?.inputs || {})) inputs.add(slash(input));
        for (const imported of outputs[file]?.imports || []) if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path); };
      visit(start);
      return { initialRawJsBytes: [...seen].reduce((sum, file) => sum + (file.endsWith('.js') ? outputs[file].bytes : 0), 0), initialOutputModules: seen.size,
        editorInInitialGraph: inputs.has('src/components/nodes/ImageEditModal.tsx') };
    };
    const comparisons = entries.map(entry => ({ entry, baseline: describe(baseline, entry), current: describe(current, entry) }));
    for (const item of comparisons) { assert.equal(item.baseline.editorInInitialGraph, true); assert.equal(item.current.editorInInitialGraph, false); assert.ok(item.current.initialRawJsBytes < item.baseline.initialRawJsBytes); }
    const report = { passed: true, baselineCommit, comparisons,
      boundary: 'raw UTF-8 esbuild static-reachable diagnostic bytes, same dependency installation and options; not compressed production sizes, full application startup, runtime P50/P95 or installed-client performance' };
    const target = path.join(root, 'local-private/artcraft-ux-verification'); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'image-editor-modules.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally { await esbuild.stop(); }
}
if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
