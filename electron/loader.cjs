// ============================================================================
// T8-penguin-canvas Runtime Loader
//
// 职责:
//   1. 注册 .t8c 后缀的 require hook
//      → 读取磁盘加密文件 (T8ENC1\n + AES-256-CBC 密文)
//      → 内存解密为 V8 字节码 (.jsc 等价物)
//      → 通过 bytenode 加载 + Module._compile 把字节码包装为 CommonJS Module
//   2. 兼容相对路径 require('./xxx')(从 .t8c 入口 require 出去时,自动尝试同名 .t8c)
//
// 设计参考: gpt-image-2-web 的 ZZENC1 + py_compile,但改为 Node 体系
//   - Magic Header: T8ENC1\n
//   - Key 派生: SHA256("T8-penguin-canvas-T8star-2026")
//   - 算法: AES-256-CBC (16-byte 随机 IV 内嵌密文头)
//   - 字节码格式: bytenode 标准 .jsc (V8 cached data + 8-byte length header)
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const vm = require('vm');
const { brotliDecompressSync } = require('zlib');

const MAGIC = Buffer.from('T8ENC1\n', 'utf8'); // 7 bytes
const PASSPHRASE = 'T8-penguin-canvas-T8star-2026';
const KEY = crypto.createHash('sha256').update(PASSPHRASE, 'utf8').digest(); // 32 bytes
const IV_LEN = 16;

function isEncrypted(buf) {
  return Buffer.isBuffer(buf) && buf.length > MAGIC.length && buf.slice(0, MAGIC.length).equals(MAGIC);
}

function encryptBuffer(plain) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, ct]);
}

function decryptBuffer(enc) {
  if (!isEncrypted(enc)) {
    throw new Error('[T8ENC1] missing magic header');
  }
  const iv = enc.slice(MAGIC.length, MAGIC.length + IV_LEN);
  const ct = enc.slice(MAGIC.length + IV_LEN);
  const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// ---------- bytenode 内部逻辑复刻 ----------
// 原原本实现是写 tmp .jsc 后 require(tmpFile),导致 fileModule.require
// 从 tmp 路径解析 node_modules,找不到 asar 内的 express 等依赖。
// 现在改为直接在当前 .t8c 模块上下文中运行字节码,
// 使 require/__filename/__dirname 都走 .t8c 在 asar 内的原始位置。
let _bytenodeMod = null;
function loadBytenode() {
  if (!_bytenodeMod) _bytenodeMod = require('bytenode');
  return _bytenodeMod;
}

const ZERO_LENGTH_EXTERNAL_REFERENCE_TABLE = Buffer.from([0x00, 0x00]);
function isBufferV8Bytecode(buf) {
  return Buffer.isBuffer(buf)
    && !buf.subarray(0, 2).equals(ZERO_LENGTH_EXTERNAL_REFERENCE_TABLE)
    && buf.length >= 16;
}

// 从 bytenode 复制: 根据当前 Node 版本读取字节码中的 “源码长度” 以生成同长度 dummyCode
function readSourceHash(bytecodeBuffer) {
  if (process.version.startsWith('v8.8') || process.version.startsWith('v8.9')) {
    return bytecodeBuffer.subarray(12, 16).reduce((s, n, p) => s + n * Math.pow(256, p), 0);
  }
  return bytecodeBuffer.subarray(8, 12).reduce((s, n, p) => s + n * Math.pow(256, p), 0);
}

// 从 bytenode 复制: 修复字节码 flag/version 区间(调用一次 compileCode 拿当前运行时的 dummy 字节码,动态拷贝到超本的头部)
function fixBytecode(bytecodeBuffer) {
  loadBytenode();
  const dummyBytecode = _bytenodeMod.compileCode('"\u0caa_\u0caa"'); // arbitrary tiny
  const version = parseFloat(process.version.slice(1, 5));
  if (process.version.startsWith('v8.8') || process.version.startsWith('v8.9')) {
    dummyBytecode.subarray(16, 20).copy(bytecodeBuffer, 16);
    dummyBytecode.subarray(20, 24).copy(bytecodeBuffer, 20);
  } else if (version >= 12 && version <= 23) {
    dummyBytecode.subarray(12, 16).copy(bytecodeBuffer, 12);
  } else {
    dummyBytecode.subarray(12, 16).copy(bytecodeBuffer, 12);
    dummyBytecode.subarray(16, 20).copy(bytecodeBuffer, 16);
  }
}

function generateScript(cachedData, filename) {
  let buf = cachedData;
  if (!isBufferV8Bytecode(buf)) {
    buf = brotliDecompressSync(buf); // bytenode 可选 brotli 压缩
  }
  fixBytecode(buf);
  const length = readSourceHash(buf);
  let dummyCode = '';
  if (length > 1) dummyCode = '"' + '\u200b'.repeat(length - 2) + '"';
  const script = new vm.Script(dummyCode, { cachedData: buf, filename });
  if (script.cachedDataRejected) {
    throw new Error('[T8ENC1] cachedDataRejected (V8 版本不匹配?请重新 npm run encrypt)');
  }
  return script;
}

// ---------- 注册 .t8c require hook ----------
function registerLoader() {
  if (require.extensions['.t8c']) return; // 防重复注册
  // 需要 bytenode 在运行时被加载(为了 fixBytecode 中的 compileCode)
  loadBytenode();

  require.extensions['.t8c'] = function (fileModule, filename) {
    const enc = fs.readFileSync(filename);
    const jsc = decryptBuffer(enc); // 解密成 V8 字节码缓冲

    // 完全复刻 bytenode 的 .jsc loader 逻辑,但关键:
    //   - fileModule 是 .t8c 模块本身(asar 内),其 require/paths 能到到 app.asar/node_modules
    //   - filename / __dirname 也是 .t8c 原始路径,保证原代码的相对 require/路径推导正确
    const script = generateScript(jsc, filename);

    function req(id) {
      try {
        return fileModule.require(id);
      } catch (e) {
        // .t8c 文件在 resources/backend-enc/ 下(asar 外),
        // 其 module.paths 无法到达 app.asar/node_modules,
        // 因此需要在获不到外部依赖时回退到 loader.cjs(在 asar 内)的 require。
        // 这使得加密后端能访问主包 node_modules 里的 express/cors/multer/sharp 等。
        if (e && e.code === 'MODULE_NOT_FOUND') {
          const text = String(id || '');
          if (text.startsWith('.') || path.isAbsolute(text)) throw e;
          return require(id);
        }
        throw e;
      }
    }
    req.resolve = function (request, options) {
      try {
        return Module._resolveFilename(request, fileModule, false, options);
      } catch (e) {
        if (e && e.code === 'MODULE_NOT_FOUND') {
          return require.resolve(request, options);
        }
        throw e;
      }
    };
    if (process.main) req.main = process.main;
    req.extensions = Module._extensions;
    req.cache = Module._cache;

    const compiledWrapper = script.runInThisContext({
      filename,
      lineOffset: 0,
      columnOffset: 0,
      displayErrors: true,
    });

    const dirname = path.dirname(filename);
    const args = [fileModule.exports, req, fileModule, filename, dirname, process, global];
    return compiledWrapper.apply(fileModule.exports, args);
  };

  // 让 require('./foo') 在缺少 .js/.json 时自动尝试 .t8c
  const _origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    try {
      return _origResolve.call(this, request, parent, ...rest);
    } catch (e) {
      try {
        return _origResolve.call(this, request + '.t8c', parent, ...rest);
      } catch (_) {
        throw e;
      }
    }
  };
}

registerLoader();

module.exports = {
  registerLoader,
  encryptBuffer,
  decryptBuffer,
  isEncrypted,
  MAGIC,
};
