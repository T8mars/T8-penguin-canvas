'use strict';
// Isolated strict programs keep the known large combined graph within512MiB.
// This is a scoped check, never a replacement claim for whole-project tsc.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '..'), directory = path.join(root, 'local-private/artcraft-ux-verification');
const groups = {
  core: ['src/components/nodes/MaterialSetNode.tsx', 'src/components/nodes/WorldSceneNode.tsx', 'src/components/nodes/DrawingBoardNode.tsx', 'src/components/nodes/StoryNode.tsx', 'tests/canvasDialogChanges.test.ts', 'tests/worldScenePreflight.test.ts'],
  sources: ['src/components/nodes/UploadNode.tsx', 'src/components/nodes/OutputNode.tsx'],
  timeline: ['src/components/nodes/VideoEditNode.tsx'],
};
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
if (process.argv[2]) {
  const name = process.argv[2]; if (!groups[name]) throw Error('Unknown typecheck group');
  const ts = require('typescript'), config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const roots = ['src/vite-env.d.ts', ...groups[name]].map(file => path.join(root, file));
  const program = ts.createProgram(roots, parsed.options), diagnostics = ts.getPreEmitDiagnostics(program);
  const details = ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: value => value, getNewLine: () => '\n' });
  const report = { group: name, roots: groups[name], diagnostics: diagnostics.length, details, limitMiB: 512, rssBytes: process.memoryUsage().rss };
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'types-' + name + '.json'), JSON.stringify(report, null, 2));
  process.stdout.write(details + JSON.stringify({ ...report, details: undefined }) + '\n'); process.exitCode = diagnostics.length ? 1 : 0;
} else {
  const outcomes = [];
  for (const name of Object.keys(groups)) {
    const result = require('node:child_process').spawnSync(process.execPath, ['--max-old-space-size=512', __filename, name], { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); outcomes.push({ group: name, exitCode: result.status, signal: result.signal, error: result.error?.message });
    if (result.status !== 0) break;
  }
  const passed = outcomes.length === Object.keys(groups).length && outcomes.every(item => item.exitCode === 0);
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'final-scoped-types.json'), JSON.stringify({ passed, groups: outcomes,
    boundary: 'three isolated strict project-options programs at512MiB; combined eight-node512MiB and historical whole-project768MiB OOM remain recorded, not passes' }, null, 2));
  process.exitCode = passed ? 0 : 1;
}
