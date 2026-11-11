const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { encryptFile, rewriteRequires } = require('../electron/encrypt.cjs');
test('encrypted shared ESM factories load through relative lazy imports without plaintext modules', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-encrypted-contracts-'));
  const source = path.join(scratch, 'source'), output = path.join(scratch, 'encrypted');
  try {
    for (const dir of ['shared', 'providers']) fs.mkdirSync(path.join(source, dir), { recursive: true });
    const factories = [['h3TurboContract','createH3TurboContract'], ['seedream55DraftContract','createSeedream55DraftContract'], ['tripo3dContract','createTripoContract']];
    for (const [name] of factories) for (const extension of ['.mjs','.json']) {
      const input = path.join(source,'shared',name+extension);
      fs.copyFileSync(path.join(__dirname,'../backend/src/shared',name+extension),input);
      encryptFile(input,source,output);
    }
    const shim = path.join(source,'providers/probe.js');
    fs.writeFileSync(shim, `module.exports = async () => Promise.all([${factories.map(([name,factory]) => `import('../shared/${name}.mjs').then(m => m.${factory}(require('../shared/${name}.json')))`)}]);`);
    encryptFile(shim,source,output);
    require('../electron/loader.cjs');
    const [h3,seedream,tripo] = await require(path.join(output,'providers/probe.t8c'))();
    assert.equal(h3.build({model:'minimax-h3-image',prompt:'probe',seed:0}).metadata.seed,0);
    assert.equal(seedream.buildDraft({model:'seedance-2.5-standard-draft-to-video',draft_task_id:'fixture'}).metadata.draft_task_id,'fixture');
    assert.ok(tripo);
    for (const [name] of factories) { assert.ok(fs.existsSync(path.join(output,'shared',name+'.t8c'))); assert.ok(!fs.existsSync(path.join(output,'shared',name+'.mjs'))); }
  } finally {
    assert.equal(path.dirname(path.resolve(scratch)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(scratch).startsWith('t8-encrypted-contracts-'));
    fs.rmSync(scratch,{recursive:true,force:true});
  }
});
test('only literal relative ESM imports are rewritten; remote and computed imports stay untouched', () => {
  const source = `import('../shared/example.mjs'); import('https://example.com/x.mjs'); import(variable); require('../shared/example.mjs');`;
  const result = rewriteRequires(source);
  assert.match(result,/Promise\.resolve\(\)\.then/);
  assert.match(result,/require\('\.\.\/shared\/example\.t8c'\)/);
  assert.ok(result.includes("import('https://example.com/x.mjs')"));
  assert.ok(result.includes('import(variable)'));
});
