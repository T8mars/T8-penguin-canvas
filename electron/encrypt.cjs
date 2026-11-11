// ============================================================================
// T8-penguin-canvas 打包前加密脚本 (encrypt.js)
//
// 流程:
//   1. 读取 backend/src/**/*.js (排除 node_modules)
//   2. 用 bytenode.compileCode(src) 生成 V8 字节码 (.jsc 缓冲)
//   3. 调用 loader.encryptBuffer 加 T8ENC1 magic + AES-256-CBC
//   4. 写入 build/backend-enc/<rel>.t8c
//   5. 重写所有相对路径 require:
//        ./config / ./routes/canvas 等 → 仍然是相对路径,运行时由 .t8c 后缀 hook 解析
//
// 使用方式:
//   node electron/encrypt.js
// 输出:
//   build/backend-enc/server.t8c
//   build/backend-enc/config.t8c
//   build/backend-enc/routes/canvas.t8c ...
//   build/backend-enc/utils/*.t8c
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bytenode = require('bytenode');
const { encryptBuffer } = require('./loader.cjs');

const BACKEND_SRC = path.resolve(__dirname, '..', 'backend', 'src');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_LOCK = path.join(PROJECT_ROOT, 'package-lock.json');
const LOCAL_ELECTRON_PACKAGE = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'package.json');
const LOCAL_ELECTRON_PATH = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'path.txt');
const LOCAL_PRIVATE_SRC = path.resolve(__dirname, '..', 'local-private');
const OUT_DIR = path.resolve(__dirname, '..', 'build', 'backend-enc');
const LOCAL_PRIVATE_BACKEND_DIRS = [
  path.join(LOCAL_PRIVATE_SRC, 'extensions', 'backend'),
  path.join(LOCAL_PRIVATE_SRC, 'recharge', 'backend'),
];
const REQUIRED_LOCAL_PRIVATE_BACKEND = [
  path.join(LOCAL_PRIVATE_SRC, 'extensions', 'backend', 'index.cjs'),
  path.join(LOCAL_PRIVATE_SRC, 'recharge', 'backend', 'routes.cjs'),
];
const REQUIRED_LOCAL_PRIVATE_OUTPUT = [
  path.join(OUT_DIR, 'local-private', 'extensions', 'backend', 'index.t8c'),
  path.join(OUT_DIR, 'local-private', 'recharge', 'backend', 'routes.t8c'),
];
const EXCLUDED_BACKEND_FILES = new Set([
  // Local VibeX static adapter is intentionally not part of public/Electron
  // releases. The node uses the online VibeX page plus vibexBridge instead.
  'routes/vibex.js',
]);
const CANVAS_AGENT_INTEGRITY_MANIFEST = 'canvas-agent-source-integrity.json';
const CANVAS_AGENT_INTEGRITY_FILES = Object.freeze([
  { source: 'routes/canvasAgentTools.js', output: 'routes/canvasAgentTools.t8c', format: 't8c' },
  { source: 'services/canvasAgentTools.js', output: 'services/canvasAgentTools.t8c', format: 't8c' },
  { source: 'services/canvasAgentPublicView.js', output: 'services/canvasAgentPublicView.t8c', format: 't8c' },
  { source: 'services/runEvidenceDiagnosis.js', output: 'services/runEvidenceDiagnosis.t8c', format: 't8c' },
  { source: 'shared/canvasNodeSchema.json', output: 'shared/canvasNodeSchema.json', format: 'json' },
]);

function walk(dir, results = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walk(full, results);
    } else if (/\.(?:js|cjs|mjs)$/.test(full)) {
      results.push(full);
    } else if (full.endsWith('.json')) {
      results.push(full); // settings/canvas 模板等
    }
  }
  return results;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readExpectedElectronVersion() {
  const lock = JSON.parse(fs.readFileSync(PACKAGE_LOCK, 'utf8'));
  const version = lock?.packages?.['node_modules/electron']?.version;
  if (!version) {
    throw new Error('[encrypt] package-lock.json is missing the pinned Electron version');
  }
  return String(version);
}

function assertElectronCompilerRuntime() {
  const expected = readExpectedElectronVersion();
  const actual = process.versions.electron;
  if (!actual) {
    throw new Error(
      `[encrypt] bytecode compiler must run with project Electron ${expected}; run npm ci, then npm run encrypt`,
    );
  }
  if (actual !== expected) {
    throw new Error(
      `[encrypt] Electron runtime mismatch: package-lock=${expected}, compiler=${actual}; run npm ci and use the project-local Electron CLI`,
    );
  }
  if (!fs.existsSync(LOCAL_ELECTRON_PACKAGE) || !fs.existsSync(LOCAL_ELECTRON_PATH)) {
    throw new Error(
      `[encrypt] project-local Electron ${expected} is incomplete; run npm ci before packaging`,
    );
  }
  const localVersion = JSON.parse(fs.readFileSync(LOCAL_ELECTRON_PACKAGE, 'utf8')).version;
  if (String(localVersion) !== expected) {
    throw new Error(
      `[encrypt] local Electron package mismatch: package-lock=${expected}, node_modules=${localVersion || 'missing'}`,
    );
  }
  console.log(`[encrypt] compiler Electron ${actual}, Node ${process.versions.node}, V8 ${process.versions.v8}`);
}

// 把 require('./foo') / require('./foo.js') 重写为 require('./foo.t8c')
// 使内部模块在加密产物里仍能正确 resolve(.t8c hook 已注册到 require.extensions)
function rewriteRequires(src) {
  // Bytecode executes in a CommonJS vm.Script without an ESM loader callback.
  // Keep lazy Promise/error semantics, but resolve audited relative ESM through
  // the same encrypted module loader instead of shipping plaintext factories.
  src = src.replace(/\bimport\((['"])(\.\.?\/[^'"]+\.mjs)\1\)/g,
    (_match, quote, request) => `Promise.resolve().then(() => require(${quote}${request.replace(/\.mjs$/, '.t8c')}${quote}))`);
  // 匹配 require('./xxx') 或 require("../xxx")  形式
  return src.replace(
    /require\((['"])(\.\.?\/[^'"]+)\1\)/g,
    (m, q, p) => {
      // 已有 .t8c / .json 后缀:不动
      if (/\.(t8c|json)$/.test(p)) return m;
      // 去掉 .js 后缀(若有)
      const stripped = p.replace(/\.(?:js|cjs|mjs)$/, '');
      return `require(${q}${stripped}.t8c${q})`;
    },
  );
}

function encryptFile(srcAbs, sourceRoot = BACKEND_SRC, outRoot = OUT_DIR) {
  const rel = path.relative(sourceRoot, srcAbs).replace(/\\/g, '/');
  const dst = path.join(outRoot, rel.replace(/\.(?:js|cjs|mjs)$/, '.t8c'));
  ensureDir(path.dirname(dst));
  const sourceBytes = fs.readFileSync(srcAbs);
  const sourceSha256 = sha256Buffer(sourceBytes);

  if (srcAbs.endsWith('.json')) {
    // JSON 保持原始字节复制，供加密后端的相对 require 直接读取。
    fs.writeFileSync(dst, sourceBytes);
    console.log('[copy ]', rel);
    return { sourceSha256, outputSha256: sha256File(dst) };
  }

  let src = sourceBytes.toString('utf8');
  if (srcAbs.endsWith('.mjs')) {
    src = require('esbuild').transformSync(src, { format: 'cjs', platform: 'node', target: 'node20' }).code;
  }
  src = rewriteRequires(src);

  // bytenode.compileCode 返回 V8 字节码 Buffer (同步,无需临时文件)
  // compileAsModule 通过包装代码实现:外部传入 source 已经是 CommonJS 模块体,
  // 直接 wrap 成 Module 包装函数体后再编译,运行时 require() 才能正确 resolve
  // 注意: bytenode 内部 compileCode 不接受 compileAsModule 参数,
  //       但当 src 已经是 CommonJS 模块顶层代码时, V8 会以脚本模式编译,
  //       而 require/module/exports/__filename/__dirname 是 Node 在 require() 时
  //       动态注入的形参,因此字节码运行起来时这些标识会作为闭包参数自然可用。
  //       为保证与原 backend/src 行为一致,我们用 Module.wrap() 包裹后再编译。
  const Module = require('module');
  const wrapped = Module.wrap(src);
  const jsc = bytenode.compileCode(wrapped);

  const enc = encryptBuffer(jsc);
  fs.writeFileSync(dst, enc);
  console.log('[T8ENC]', rel, '→', path.relative(path.resolve(__dirname, '..'), dst));
  return { sourceSha256, outputSha256: sha256File(dst) };
}

function isExcludedBackendFile(srcAbs) {
  const rel = path.relative(BACKEND_SRC, srcAbs).replace(/\\/g, '/');
  return EXCLUDED_BACKEND_FILES.has(rel);
}

function sha256File(filename) {
  return sha256Buffer(fs.readFileSync(filename));
}

function sha256Buffer(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeCanvasAgentIntegrityManifest(buildHashes) {
  const entries = CANVAS_AGENT_INTEGRITY_FILES.map((item) => {
    const sourcePath = path.join(BACKEND_SRC, ...item.source.split('/'));
    const outputPath = path.join(OUT_DIR, ...item.output.split('/'));
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`[encrypt] canvas Agent source missing: ${item.source}`);
    }
    if (!fs.existsSync(outputPath)) {
      throw new Error(`[encrypt] canvas Agent output missing: ${item.output}`);
    }
    const captured = buildHashes && buildHashes.get(item.source);
    if (!captured) {
      throw new Error(`[encrypt] canvas Agent build hash missing: ${item.source}`);
    }
    const sourceSha256 = sha256File(sourcePath);
    const outputSha256 = sha256File(outputPath);
    if (captured.sourceSha256 !== sourceSha256 || captured.outputSha256 !== outputSha256) {
      throw new Error(`[encrypt] canvas Agent source/output changed during encryption: ${item.source}`);
    }
    if (item.format === 'json' && sourceSha256 !== outputSha256) {
      throw new Error(`[encrypt] canvas Agent JSON copy differs from source: ${item.source}`);
    }
    return { ...item, sourceSha256, outputSha256 };
  });
  const manifest = {
    schema: 't8-canvas-agent-electron-integrity-v1',
    hashAlgorithm: 'sha256',
    entries,
  };
  const target = path.join(OUT_DIR, CANVAS_AGENT_INTEGRITY_MANIFEST);
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('[hash ]', CANVAS_AGENT_INTEGRITY_MANIFEST);
}

function main() {
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  ensureDir(OUT_DIR);

  const backendFiles = walk(BACKEND_SRC);
  const files = backendFiles.filter((file) => !isExcludedBackendFile(file));
  const canvasAgentBuildHashes = new Map();
  const skipped = backendFiles.length - files.length;
  console.log(`[encrypt] backend src files: ${files.length}${skipped ? ` (${skipped} release-excluded)` : ''}`);
  for (const f of backendFiles.filter(isExcludedBackendFile)) {
    console.log('[skip ]', path.relative(BACKEND_SRC, f).replace(/\\/g, '/'));
  }
  for (const f of files) {
    const hashes = encryptFile(f);
    const rel = path.relative(BACKEND_SRC, f).replace(/\\/g, '/');
    if (CANVAS_AGENT_INTEGRITY_FILES.some((item) => item.source === rel)) {
      canvasAgentBuildHashes.set(rel, hashes);
    }
  }
  writeCanvasAgentIntegrityManifest(canvasAgentBuildHashes);

  const localPrivateDisabled = process.env.T8_ENABLE_LOCAL_PRIVATE === '0'
    || process.env.T8_DISABLE_LOCAL_EXTENSIONS === '1';
  const localPrivateRequired = process.env.T8_REQUIRE_LOCAL_PRIVATE === '1';
  if (localPrivateRequired && localPrivateDisabled) {
    throw new Error('[encrypt] formal release cannot disable local private extensions');
  }
  if (localPrivateRequired) {
    const missing = REQUIRED_LOCAL_PRIVATE_BACKEND.filter((file) => !fs.existsSync(file));
    if (missing.length > 0) {
      throw new Error(`[encrypt] formal release requires local private backend: ${missing.join(', ')}`);
    }
  }
  const localPrivateEntry = path.join(LOCAL_PRIVATE_SRC, 'extensions', 'backend', 'index.cjs');
  if (!localPrivateDisabled && fs.existsSync(localPrivateEntry)) {
    const localOut = path.join(OUT_DIR, 'local-private');
    const localFiles = LOCAL_PRIVATE_BACKEND_DIRS
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) => walk(dir));
    console.log(`[encrypt] local private files: ${localFiles.length}`);
    for (const f of localFiles) {
      encryptFile(f, LOCAL_PRIVATE_SRC, localOut);
    }
  } else {
    if (localPrivateRequired) {
      throw new Error('[encrypt] formal release skipped required local private backend');
    }
    console.log('[encrypt] local private extensions: skipped');
  }
  if (localPrivateRequired) {
    const missing = REQUIRED_LOCAL_PRIVATE_OUTPUT.filter((file) => !fs.existsSync(file));
    if (missing.length > 0) {
      throw new Error(`[encrypt] local private bytecode missing after encryption: ${missing.join(', ')}`);
    }
  }
  console.log(`[encrypt] DONE → ${OUT_DIR}`);
}

if (require.main === module) {
  // 必须用项目锁定的 Electron 运行本脚本,避免 npm 向父目录解析到其他 Electron。
  // 使 bytenode 编译出的字节码与运行时 Electron V8 版本一致
  try {
    assertElectronCompilerRuntime();
    main();
    // Electron 环境下需主动退出,否则事件循环不退
    if (process.versions.electron) {
      try { require('electron').app.exit(0); } catch (_) { process.exit(0); }
    } else {
      process.exit(0);
    }
  } catch (e) {
    console.error('[encrypt] FAILED:', e && e.stack ? e.stack : e);
    if (process.versions.electron) {
      try { require('electron').app.exit(1); } catch (_) { process.exit(1); }
    } else {
      process.exit(1);
    }
  }
}

module.exports = {
  CANVAS_AGENT_INTEGRITY_FILES,
  CANVAS_AGENT_INTEGRITY_MANIFEST,
  main,
  encryptFile,
  rewriteRequires,
  writeCanvasAgentIntegrityManifest,
  readExpectedElectronVersion,
  assertElectronCompilerRuntime,
};
