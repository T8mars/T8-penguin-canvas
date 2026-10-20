'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const INSTALL_SCHEMA = 't8-zcanvas-install-v1';
const SOURCE_MANIFEST_SCHEMA = 't8-zcanvas-manifest-v1';
const INSTALL_MANIFEST = '.zcanvas-install.json';
const DISCOVERY_SCHEMA = 't8-zcanvas-discovery-copy-v1';
const DISCOVERY_MARKER = '.zcanvas-managed.json';
const BUNDLE_SIGNATURE_SCHEMA = 't8-zcanvas-bundle-signature-v1';
const BUNDLE_TRUST_POLICY_SCHEMA = 't8-zcanvas-bundle-trust-policy-v1';
const BUNDLE_SIGNATURE_FILE = 'bundle-signature.json';
const INSTALL_FILE_LIMIT = 256;
const INSTALL_BYTES_LIMIT = 8 * 1024 * 1024;
const SAFE_VERSION_LABEL = /^[0-9A-Za-z](?:[0-9A-Za-z._+-]{0,62}[0-9A-Za-z])?$/;
const REQUIRED_PROTOCOLS = Object.freeze({
  controlProtocol: 't8-agent-control-v1',
  responseSchema: 't8-agent-control-response-v1',
  canvasPatchProtocol: 't8-canvas-patch-v1',
});

class InstallerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstallerError';
    this.code = code;
  }
}

function readRegularJson(filename, options = {}) {
  const code = String(options.code || 'INSTALL_MANIFEST_INVALID');
  const label = String(options.label || 'JSON 文件');
  const maxBytes = Number(options.maxBytes || 512 * 1024);
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (_) {
    throw new InstallerError(code, `找不到${label}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new InstallerError(code, `${label}必须是普通的小型 JSON 文件`);
  }
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (_) {
    throw new InstallerError(code, `${label}无法解析`);
  }
}

function safeVersionLabel(value, field, code = 'INSTALL_SOURCE_MANIFEST_INVALID') {
  const normalized = String(value || '').trim();
  if (!SAFE_VERSION_LABEL.test(normalized) || normalized.includes('..')) {
    throw new InstallerError(
      code,
      `${field} 不是安全的不可变版本号；版本号不能包含路径或连续句点`,
    );
  }
  return normalized;
}

function normalizeTrustedBundleSigners(value, errorCode = 'INSTALL_TRUST_POLICY_INVALID') {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new InstallerError(errorCode, '受信任签名密钥清单必须是数组');
  }
  const seen = new Set();
  return value.map((entry) => {
    const keyId = String(entry?.keyId || '').trim();
    const publicKey = String(entry?.publicKey || '').trim();
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(keyId) || seen.has(keyId) || !publicKey) {
      throw new InstallerError(errorCode, '受信任签名密钥的 keyId 或公钥无效/重复');
    }
    let keyObject;
    try {
      keyObject = crypto.createPublicKey(publicKey);
    } catch (_) {
      throw new InstallerError(errorCode, `签名密钥 ${keyId} 不是有效公钥`);
    }
    if (keyObject.asymmetricKeyType !== 'ed25519') {
      throw new InstallerError(errorCode, `签名密钥 ${keyId} 必须使用 Ed25519`);
    }
    seen.add(keyId);
    return {
      keyId,
      algorithm: 'Ed25519',
      publicKey: keyObject.export({ type: 'spki', format: 'pem' }).toString().trim(),
    };
  });
}

function normalizeSourceManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schema !== SOURCE_MANIFEST_SCHEMA
    || manifest.skillName !== 'zhenzhen-canvas') {
    throw new InstallerError(
      'INSTALL_SOURCE_MANIFEST_INVALID',
      '版本包 manifest.json 不是受支持的 zhenzhen-canvas 清单',
    );
  }
  const normalized = {
    ...manifest,
    skillVersion: safeVersionLabel(manifest.skillVersion, 'skillVersion'),
    cliVersion: safeVersionLabel(manifest.cliVersion, 'cliVersion'),
  };
  for (const [field, expected] of Object.entries(REQUIRED_PROTOCOLS)) {
    if (normalized[field] !== expected) {
      throw new InstallerError(
        'INSTALL_SOURCE_INCOMPATIBLE',
        `版本包 ${field}=${String(normalized[field] || '未声明')} 与当前安装器不兼容`,
      );
    }
  }
  normalized.trustedBundleSigners = normalizeTrustedBundleSigners(
    manifest.trustedBundleSigners,
    'INSTALL_SOURCE_MANIFEST_INVALID',
  );
  return normalized;
}

function readSourceManifest(source) {
  const manifest = readRegularJson(path.join(source.cli, 'manifest.json'), {
    code: 'INSTALL_SOURCE_MANIFEST_INVALID',
    label: '版本包 manifest.json',
    maxBytes: 128 * 1024,
  });
  return normalizeSourceManifest(manifest);
}

function readTrustedBundleSignerPolicy(filename) {
  const policyPath = String(filename || '').trim();
  if (!policyPath || !path.isAbsolute(policyPath)) {
    throw new InstallerError('INSTALL_TRUST_POLICY_INVALID', '可信签名策略必须使用绝对路径');
  }
  const document = readRegularJson(path.resolve(policyPath), {
    code: 'INSTALL_TRUST_POLICY_INVALID',
    label: '可信签名策略',
    maxBytes: 128 * 1024,
  });
  if (document?.schema !== BUNDLE_TRUST_POLICY_SCHEMA) {
    throw new InstallerError('INSTALL_TRUST_POLICY_INVALID', '可信签名策略 schema 不兼容');
  }
  return normalizeTrustedBundleSigners(document.signers);
}

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function defaultInstallRoot(options = {}) {
  const explicit = String(options.installRoot || options.env?.ZCANVAS_INSTALL_ROOT || process.env.ZCANVAS_INSTALL_ROOT || '').trim();
  if (explicit) return path.resolve(explicit);
  const localAppData = String(options.env?.LOCALAPPDATA || process.env.LOCALAPPDATA || '').trim();
  return path.resolve(localAppData || path.join(options.homeDir || os.homedir(), 'AppData', 'Local'), 'ZhenzhenCanvas', 'Agent');
}

function defaultDiscoveryRoots(options = {}) {
  if (Array.isArray(options.discoveryRoots)) {
    return [...new Set(options.discoveryRoots.map((item) => path.resolve(String(item))))];
  }
  // An explicit test/custom root must never write into the real user's Agent
  // directories unless the caller opts in with discoveryRoots.
  if (options.installRoot || options.env?.ZCANVAS_INSTALL_ROOT || process.env.ZCANVAS_INSTALL_ROOT) return [];
  const env = options.env || process.env;
  const home = path.resolve(options.homeDir || os.homedir());
  const codexHome = path.resolve(String(env.CODEX_HOME || path.join(home, '.codex')));
  return [
    path.join(home, '.agents', 'skills', 'zhenzhen-canvas'),
    path.join(codexHome, 'skills', 'zhenzhen-canvas'),
  ];
}

function sourceLayout(options = {}) {
  const bundlePath = String(options.bundlePath || '').trim();
  if (bundlePath && !path.isAbsolute(bundlePath)) {
    throw new InstallerError('INSTALL_BUNDLE_PATH_INVALID', '版本包目录必须使用绝对路径');
  }
  const root = path.resolve(bundlePath || options.projectRoot || path.join(__dirname, '..', '..', '..'));
  if (bundlePath) {
    let stat;
    try {
      stat = fs.lstatSync(root);
    } catch (_) {
      throw new InstallerError('INSTALL_BUNDLE_PATH_INVALID', '找不到版本包目录');
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new InstallerError('INSTALL_BUNDLE_PATH_INVALID', '版本包必须是普通目录，不能是文件或符号链接');
    }
  }
  const candidates = [
    {
      projectRoot: root,
      cli: path.join(root, 'tools', 'zcanvas-cli'),
      skill: path.join(root, '.agents', 'skills', 'zhenzhen-canvas'),
      distribution: 'project-source',
    },
    {
      projectRoot: root,
      cli: path.join(root, 'tools', 'zcanvas-cli'),
      skill: path.join(root, 'agent', 'skills', 'zhenzhen-canvas'),
      distribution: 'electron-resources',
    },
    {
      projectRoot: root,
      cli: path.resolve(__dirname, '..'),
      skill: path.join(root, 'skills', 'zhenzhen-canvas'),
      distribution: 'current-user-install',
    },
    {
      projectRoot: root,
      cli: path.join(root, 'cli'),
      skill: path.join(root, 'skill'),
      distribution: 'versioned-local-bundle',
    },
  ];
  const selected = candidates.find((item) =>
    fs.existsSync(path.join(item.cli, 'manifest.json'))
    && fs.existsSync(path.join(item.skill, 'SKILL.md')));
  if (!selected) {
    throw new InstallerError(
      'INSTALL_SOURCE_INVALID',
      '找不到完整的 zcanvas CLI 与 zhenzhen-canvas Skill 源；请从项目目录、Electron resources 或已校验用户安装运行',
    );
  }
  return selected;
}

function sourceDigest(source) {
  const records = [];
  for (const [prefix, directory] of [['cli', source.cli], ['skill', source.skill]]) {
    for (const file of listSourceFiles(directory)) {
      records.push([
        path.posix.join(prefix, file.relative.split(path.sep).join('/')),
        file.size,
        sha256File(file.absolute),
      ].join('\u0000'));
    }
  }
  return crypto.createHash('sha256').update(records.sort().join('\n')).digest('hex');
}

function bundleSignaturePayload(sourceManifest, digest) {
  return Buffer.from(`${JSON.stringify({
    schema: BUNDLE_SIGNATURE_SCHEMA,
    skillName: sourceManifest.skillName,
    skillVersion: sourceManifest.skillVersion,
    cliVersion: sourceManifest.cliVersion,
    sourceDigest: digest,
  })}\n`, 'utf8');
}

function verifyBundleSignature(source, sourceManifest, digest, options = {}) {
  if (source.distribution !== 'versioned-local-bundle') {
    return { required: false, verified: false, keyId: '' };
  }
  const trustedSigners = normalizeTrustedBundleSigners(options.trustedBundleSigners);
  if (!trustedSigners.length) {
    throw new InstallerError(
      'INSTALL_BUNDLE_TRUST_NOT_CONFIGURED',
      '这是外部版本包，但当前安装没有可信签名公钥；请先从项目或官方桌面包建立信任，再更新',
    );
  }
  const signaturePath = path.resolve(
    String(options.bundleSignaturePath || path.join(source.projectRoot, BUNDLE_SIGNATURE_FILE)),
  );
  if (!signaturePath.startsWith(`${path.resolve(source.projectRoot)}${path.sep}`)) {
    throw new InstallerError('INSTALL_BUNDLE_SIGNATURE_INVALID', '签名文件必须位于版本包目录内');
  }
  const document = readRegularJson(signaturePath, {
    code: 'INSTALL_BUNDLE_SIGNATURE_REQUIRED',
    label: BUNDLE_SIGNATURE_FILE,
    maxBytes: 64 * 1024,
  });
  const keyId = String(document?.keyId || '').trim();
  const signatureBase64 = String(document?.signature || '').trim();
  if (document?.schema !== BUNDLE_SIGNATURE_SCHEMA
    || document?.algorithm !== 'Ed25519'
    || document?.sourceDigest !== digest
    || !/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(keyId)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64)) {
    throw new InstallerError(
      'INSTALL_BUNDLE_SIGNATURE_INVALID',
      '版本包签名清单与当前版本、digest 或 Ed25519 格式不一致',
    );
  }
  const signer = trustedSigners.find((entry) => entry.keyId === keyId);
  if (!signer) {
    throw new InstallerError(
      'INSTALL_BUNDLE_SIGNER_UNTRUSTED',
      `版本包由未受信任的签名者 ${keyId || 'unknown'} 签名；未替换当前安装`,
    );
  }
  let verified = false;
  try {
    verified = crypto.verify(
      null,
      bundleSignaturePayload(sourceManifest, digest),
      signer.publicKey,
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch (_) {}
  if (!verified) {
    throw new InstallerError(
      'INSTALL_BUNDLE_SIGNATURE_MISMATCH',
      '版本包签名校验失败；文件可能损坏或被替换，当前安装保持不变',
    );
  }
  return { required: true, verified: true, keyId, algorithm: 'Ed25519' };
}

function verifyBundleSource(source, expectedDigest = '') {
  const actual = sourceDigest(source);
  const expected = String(expectedDigest || '').trim().toLowerCase();
  if (source.distribution === 'versioned-local-bundle' && !expected) {
    throw new InstallerError(
      'INSTALL_BUNDLE_DIGEST_REQUIRED',
      '安装外部版本包必须同时提供 --sha256；未替换当前安装',
    );
  }
  if (expected && !/^[a-f0-9]{64}$/.test(expected)) {
    throw new InstallerError('INSTALL_BUNDLE_DIGEST_INVALID', '--sha256 必须是 64 位十六进制 SHA-256');
  }
  if (expected && actual !== expected) {
    throw new InstallerError('INSTALL_BUNDLE_DIGEST_MISMATCH', '版本包 SHA-256 不匹配；未替换当前安装');
  }
  return actual;
}

function assertInstallRoot(root) {
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || path.dirname(resolved) === resolved) {
    throw new InstallerError('INSTALL_TARGET_UNSAFE', '不能把磁盘根目录作为 zcanvas 安装目录');
  }
  return resolved;
}

function listSourceFiles(source) {
  const files = [];
  let totalBytes = 0;
  const stack = [{ absolute: source, relative: '' }];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current.absolute, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current.absolute, entry.name);
      const relative = path.join(current.relative, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new InstallerError('INSTALL_SOURCE_SYMLINK', '安装源包含符号链接，已停止');
      if (stat.isDirectory()) {
        stack.push({ absolute, relative });
        continue;
      }
      if (!stat.isFile()) throw new InstallerError('INSTALL_SOURCE_INVALID', '安装源包含非常规文件，已停止');
      totalBytes += stat.size;
      files.push({ absolute, relative, size: stat.size });
      if (files.length > INSTALL_FILE_LIMIT || totalBytes > INSTALL_BYTES_LIMIT) {
        throw new InstallerError('INSTALL_SOURCE_TOO_LARGE', '安装源超过安全大小限制');
      }
    }
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function copyTree(source, target, prefix, manifestFiles) {
  for (const file of listSourceFiles(source)) {
    const destination = path.resolve(target, file.relative);
    const expectedRoot = `${path.resolve(target)}${path.sep}`;
    if (!destination.startsWith(expectedRoot)) throw new InstallerError('INSTALL_PATH_INVALID', '安装文件路径越界');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file.absolute, destination, fs.constants.COPYFILE_EXCL);
    const relative = path.posix.join(prefix, file.relative.split(path.sep).join('/'));
    manifestFiles.push({ path: relative, size: file.size, sha256: sha256File(destination) });
  }
}

function normalizedPath(filename) {
  const resolved = path.resolve(filename);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function skillTreeDigest(directory) {
  const records = listSourceFiles(directory)
    .filter((file) => file.relative !== DISCOVERY_MARKER)
    .map((file) => [
      file.relative.split(path.sep).join('/'),
      file.size,
      sha256File(file.absolute),
    ].join('\u0000'));
  return crypto.createHash('sha256').update(records.sort().join('\n')).digest('hex');
}

function readDiscoveryMarker(directory) {
  const filename = path.join(directory, DISCOVERY_MARKER);
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (_) {
    throw new InstallerError(
      'DISCOVERY_TARGET_UNOWNED',
      `Skill 发现目录已存在但不属于 zcanvas：${directory}`,
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    throw new InstallerError('DISCOVERY_MARKER_INVALID', `Skill 发现目录标记无效：${directory}`);
  }
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (_) {
    throw new InstallerError('DISCOVERY_MARKER_INVALID', `Skill 发现目录标记无法解析：${directory}`);
  }
  if (marker?.schema !== DISCOVERY_SCHEMA || !marker.installRoot || !marker.skillDigest) {
    throw new InstallerError('DISCOVERY_MARKER_INVALID', `Skill 发现目录标记不兼容：${directory}`);
  }
  return marker;
}

function assertManagedDiscoveryTarget(directory, installRoot) {
  if (!fs.existsSync(directory)) return null;
  const marker = readDiscoveryMarker(directory);
  if (normalizedPath(marker.installRoot) !== normalizedPath(installRoot)) {
    throw new InstallerError(
      'DISCOVERY_TARGET_UNOWNED',
      `Skill 发现目录由另一份安装管理，未覆盖：${directory}`,
    );
  }
  return marker;
}

function syncDiscoveryCopies(root, manifest) {
  const source = path.join(root, 'skills', 'zhenzhen-canvas');
  const sourceDigestValue = skillTreeDigest(source);
  const destinations = Array.isArray(manifest.discoveryRoots) ? manifest.discoveryRoots : [];
  const transactions = [];
  try {
    for (const destinationValue of destinations) {
      const destination = assertInstallRoot(destinationValue);
      if (normalizedPath(destination) === normalizedPath(source)) continue;
      assertManagedDiscoveryTarget(destination, root);
      const parent = path.dirname(destination);
      const stage = path.join(parent, `.${path.basename(destination)}.stage-${process.pid}-${crypto.randomUUID()}`);
      const backup = path.join(parent, `.${path.basename(destination)}.backup-${process.pid}-${crypto.randomUUID()}`);
      fs.mkdirSync(parent, { recursive: true });
      fs.mkdirSync(stage, { recursive: false, mode: 0o700 });
      copyTree(source, stage, 'skill', []);
      fs.writeFileSync(
        path.join(stage, DISCOVERY_MARKER),
        `${JSON.stringify({
          schema: DISCOVERY_SCHEMA,
          installRoot: root,
          skillName: manifest.skillName,
          skillVersion: manifest.skillVersion,
          skillDigest: sourceDigestValue,
          installedAt: manifest.installedAt,
        }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' },
      );
      const existed = fs.existsSync(destination);
      const transaction = { destination, backup, existed, stage };
      transactions.push(transaction);
      if (existed) fs.renameSync(destination, backup);
      fs.renameSync(stage, destination);
    }
    for (const transaction of transactions) {
      if (transaction.existed) fs.rmSync(transaction.backup, { recursive: true, force: true });
    }
  } catch (error) {
    for (const transaction of transactions.reverse()) {
      try { fs.rmSync(transaction.destination, { recursive: true, force: true }); } catch (_) {}
      if (transaction.existed && fs.existsSync(transaction.backup)) {
        try { fs.renameSync(transaction.backup, transaction.destination); } catch (_) {}
      }
    }
    throw error;
  } finally {
    for (const transaction of transactions) {
      try { fs.rmSync(transaction.stage, { recursive: true, force: true }); } catch (_) {}
      try { fs.rmSync(transaction.backup, { recursive: true, force: true }); } catch (_) {}
    }
  }
  return { roots: destinations, skillDigest: sourceDigestValue };
}

function verifyDiscoveryCopies(root, manifest) {
  const expected = skillTreeDigest(path.join(root, 'skills', 'zhenzhen-canvas'));
  const roots = Array.isArray(manifest.discoveryRoots) ? manifest.discoveryRoots : [];
  for (const directory of roots) {
    const marker = readDiscoveryMarker(directory);
    if (normalizedPath(marker.installRoot) !== normalizedPath(root)
      || marker.skillDigest !== expected
      || skillTreeDigest(directory) !== expected) {
      throw new InstallerError(
        'DISCOVERY_VERIFY_FAILED',
        `Skill 发现副本与当前安装版本不一致：${directory}`,
      );
    }
  }
  return roots;
}

function removeDiscoveryCopies(root, manifest) {
  const roots = Array.isArray(manifest.discoveryRoots) ? manifest.discoveryRoots : [];
  for (const directory of roots) {
    if (!fs.existsSync(directory)) continue;
    assertManagedDiscoveryTarget(directory, root);
    fs.rmSync(directory, { recursive: true, force: false });
  }
  return roots;
}

function writeLauncher(stage, cliVersion) {
  const binDir = path.join(stage, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const launcher = [
    '#!/usr/bin/env node',
    "'use strict';",
    "const path = require('node:path');",
    `const { runCli } = require(path.join(__dirname, '..', 'runtime', ${JSON.stringify(cliVersion)}, 'src', 'cli.cjs'));`,
    'runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {',
    "  process.stderr.write(`zcanvas fatal: ${error?.message || String(error)}\\n`);",
    '  process.exitCode = 9;',
    '});',
    '',
  ].join('\n');
  const filename = path.join(binDir, 'zcanvas.cjs');
  fs.writeFileSync(filename, launcher, { encoding: 'utf8', mode: 0o755, flag: 'wx' });
  return {
    path: 'bin/zcanvas.cjs',
    size: Buffer.byteLength(launcher),
    sha256: sha256File(filename),
  };
}

function validManifestRelativePath(value) {
  const relative = String(value || '');
  if (!relative || relative.includes('\\') || relative.includes('\0') || relative.includes(':')) return false;
  if (path.posix.isAbsolute(relative) || path.posix.normalize(relative) !== relative) return false;
  return relative.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function normalizeInstallManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schema !== INSTALL_SCHEMA
    || manifest.skillName !== 'zhenzhen-canvas'
    || !Array.isArray(manifest.files)
    || !manifest.files.length
    || manifest.files.length > (INSTALL_FILE_LIMIT * 2) + 1
    || !/^[a-f0-9]{64}$/.test(String(manifest.sourceDigest || ''))) {
    throw new InstallerError('INSTALL_MANIFEST_INVALID', 'zcanvas 安装清单不兼容或缺少完整性信息');
  }
  const normalized = {
    ...manifest,
    skillVersion: safeVersionLabel(manifest.skillVersion, 'skillVersion', 'INSTALL_MANIFEST_INVALID'),
    cliVersion: safeVersionLabel(manifest.cliVersion, 'cliVersion', 'INSTALL_MANIFEST_INVALID'),
  };
  for (const [field, expected] of Object.entries(REQUIRED_PROTOCOLS)) {
    if (normalized[field] !== expected) {
      throw new InstallerError('INSTALL_MANIFEST_INVALID', `zcanvas 安装清单 ${field} 不兼容`);
    }
  }
  const seenFiles = new Set();
  normalized.files = manifest.files.map((record) => {
    const relative = String(record?.path || '');
    const size = Number(record?.size);
    const sha256 = String(record?.sha256 || '');
    if (!validManifestRelativePath(relative)
      || seenFiles.has(relative)
      || !Number.isSafeInteger(size)
      || size < 0
      || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new InstallerError('INSTALL_MANIFEST_INVALID', 'zcanvas 安装清单包含越界、重复或无效文件记录');
    }
    seenFiles.add(relative);
    return { path: relative, size, sha256 };
  });
  if (manifest.discoveryRoots != null && !Array.isArray(manifest.discoveryRoots)) {
    throw new InstallerError('INSTALL_MANIFEST_INVALID', 'zcanvas Skill 发现目录清单无效');
  }
  normalized.discoveryRoots = [...new Set((manifest.discoveryRoots || []).map((entry) => {
    const value = String(entry || '').trim();
    if (!value || !path.isAbsolute(value)) {
      throw new InstallerError('INSTALL_MANIFEST_INVALID', 'zcanvas Skill 发现目录必须是绝对路径');
    }
    return path.resolve(value);
  }))];
  normalized.trustedBundleSigners = normalizeTrustedBundleSigners(
    manifest.trustedBundleSigners,
    'INSTALL_MANIFEST_INVALID',
  );
  if (manifest.bundleSignature != null) {
    const evidence = manifest.bundleSignature;
    if (evidence?.schema !== BUNDLE_SIGNATURE_SCHEMA
      || evidence?.verified !== true
      || evidence?.algorithm !== 'Ed25519'
      || !/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(String(evidence?.keyId || ''))) {
      throw new InstallerError('INSTALL_MANIFEST_INVALID', 'zcanvas 安装清单中的签名证据无效');
    }
    normalized.bundleSignature = { ...evidence };
  }
  return normalized;
}

function readInstallManifest(root) {
  const filename = path.join(root, INSTALL_MANIFEST);
  try {
    return normalizeInstallManifest(readRegularJson(filename, {
      code: 'INSTALL_MANIFEST_INVALID',
      label: 'zcanvas 安装清单',
      maxBytes: 512 * 1024,
    }));
  } catch (error) {
    if (error instanceof InstallerError
      && error.code === 'INSTALL_MANIFEST_INVALID'
      && !fs.existsSync(filename)) {
      throw new InstallerError('INSTALL_NOT_FOUND', '没有找到 zcanvas 用户安装');
    }
    throw error;
  }
}

function verifyInstallation(options = {}) {
  const root = assertInstallRoot(defaultInstallRoot(options));
  const manifest = readInstallManifest(root);
  const errors = [];
  for (const record of manifest.files) {
    const relative = String(record?.path || '').replace(/\//g, path.sep);
    const filename = path.resolve(root, relative);
    if (!relative
      || filename === root
      || !filename.startsWith(`${root}${path.sep}`)
      || !/^[a-f0-9]{64}$/.test(String(record?.sha256 || ''))) {
      errors.push({ path: String(record?.path || ''), reason: 'manifest-entry-invalid' });
      continue;
    }
    try {
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        errors.push({ path: record.path, reason: 'not-regular-file' });
      } else if (stat.size !== Number(record.size)) {
        errors.push({ path: record.path, reason: 'size-mismatch' });
      } else if (sha256File(filename) !== record.sha256) {
        errors.push({ path: record.path, reason: 'hash-mismatch' });
      }
    } catch (_) {
      errors.push({ path: record.path, reason: 'missing' });
    }
  }
  const expectedFiles = new Set(manifest.files.map((record) => record.path));
  for (const file of listSourceFiles(root)) {
    const relative = file.relative.split(path.sep).join('/');
    if (relative === INSTALL_MANIFEST) continue;
    if (!expectedFiles.has(relative)) {
      errors.push({ path: relative, reason: 'untracked-file' });
    }
  }
  if (errors.length) {
    throw new InstallerError('INSTALL_VERIFY_FAILED', `zcanvas 安装校验失败（${errors.length} 个文件不一致）`);
  }
  const discoveryRoots = options.verifyDiscovery === false
    ? (Array.isArray(manifest.discoveryRoots) ? manifest.discoveryRoots : [])
    : verifyDiscoveryCopies(root, manifest);
  return {
    root,
    skillVersion: manifest.skillVersion,
    cliVersion: manifest.cliVersion,
    files: manifest.files.length,
    verified: true,
    installedAt: manifest.installedAt,
    discoveryRoots,
  };
}

function install(options = {}) {
  const root = assertInstallRoot(defaultInstallRoot(options));
  const source = sourceLayout(options);
  const sourceManifest = readSourceManifest(source);
  const existingManifest = fs.existsSync(root) ? readInstallManifest(root) : null;
  if (source.distribution === 'versioned-local-bundle' && options.trustedBundlePolicyPath) {
    const policyPath = path.resolve(String(options.trustedBundlePolicyPath));
    const bundleRoot = path.resolve(source.projectRoot);
    if (policyPath === bundleRoot || policyPath.startsWith(`${bundleRoot}${path.sep}`)) {
      throw new InstallerError(
        'INSTALL_TRUST_POLICY_INVALID',
        '可信签名策略必须独立于待验证版本包，不能由版本包自行提供',
      );
    }
  }
  const trustedBundleSigners = normalizeTrustedBundleSigners(
    options.trustedBundleSigners
      ?? existingManifest?.trustedBundleSigners
      ?? (source.distribution === 'versioned-local-bundle' ? [] : sourceManifest.trustedBundleSigners),
  );
  const verifiedSourceDigest = verifyBundleSource(source, options.bundleSha256);
  const bundleSignature = verifyBundleSignature(
    source,
    sourceManifest,
    verifiedSourceDigest,
    {
      trustedBundleSigners,
      ...(options.bundleSignaturePath ? { bundleSignaturePath: options.bundleSignaturePath } : {}),
    },
  );
  const parent = path.dirname(root);
  const stage = path.join(parent, `.${path.basename(root)}.stage-${process.pid}-${crypto.randomUUID()}`);
  const backup = path.join(parent, `.${path.basename(root)}.backup-${process.pid}-${crypto.randomUUID()}`);
  const lastKnownGood = `${root}.last-known-good`;
  const retiredLastKnownGood = path.join(parent, `.${path.basename(root)}.lkg-retired-${process.pid}-${crypto.randomUUID()}`);
  const discoveryRoots = defaultDiscoveryRoots(options);
  fs.mkdirSync(parent, { recursive: true });
  const files = [];
  let movedExisting = false;
  try {
    fs.mkdirSync(stage, { recursive: false, mode: 0o700 });
    copyTree(source.cli, path.join(stage, 'runtime', sourceManifest.cliVersion), `runtime/${sourceManifest.cliVersion}`, files);
    copyTree(source.skill, path.join(stage, 'skills', 'zhenzhen-canvas'), 'skills/zhenzhen-canvas', files);
    if (sourceDigest({
      cli: path.join(stage, 'runtime', sourceManifest.cliVersion),
      skill: path.join(stage, 'skills', 'zhenzhen-canvas'),
    }) !== verifiedSourceDigest) {
      throw new InstallerError('INSTALL_SOURCE_CHANGED', '安装源在复制期间发生变化；未替换当前安装，请重新检查后重试');
    }
    files.push(writeLauncher(stage, sourceManifest.cliVersion));
    files.sort((left, right) => left.path.localeCompare(right.path));
    const manifest = {
      schema: INSTALL_SCHEMA,
      skillName: sourceManifest.skillName,
      skillVersion: sourceManifest.skillVersion,
      cliVersion: sourceManifest.cliVersion,
      controlProtocol: sourceManifest.controlProtocol,
      responseSchema: sourceManifest.responseSchema,
      canvasPatchProtocol: sourceManifest.canvasPatchProtocol,
      minimumDesktopVersion: sourceManifest.minimumDesktopVersion,
      installedAt: new Date().toISOString(),
      distribution: source.distribution,
      sourceDigest: verifiedSourceDigest,
      trustedBundleSigners,
      ...(bundleSignature.verified ? {
        bundleSignature: {
          schema: BUNDLE_SIGNATURE_SCHEMA,
          verified: true,
          algorithm: bundleSignature.algorithm,
          keyId: bundleSignature.keyId,
        },
      } : {}),
      discoveryRoots,
      files,
    };
    fs.writeFileSync(
      path.join(stage, INSTALL_MANIFEST),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
    if (fs.existsSync(root)) {
      readInstallManifest(root);
      fs.renameSync(root, backup);
      movedExisting = true;
    }
    fs.renameSync(stage, root);
    try {
      syncDiscoveryCopies(root, manifest);
      const verified = verifyInstallation({ ...options, installRoot: root });
      if (movedExisting) {
        if (fs.existsSync(lastKnownGood)) {
          readInstallManifest(lastKnownGood);
          fs.renameSync(lastKnownGood, retiredLastKnownGood);
        }
        fs.renameSync(backup, lastKnownGood);
        if (fs.existsSync(retiredLastKnownGood)) fs.rmSync(retiredLastKnownGood, { recursive: true, force: true });
      }
      return {
        ...verified,
        updated: movedExisting,
        sourceDigest: verifiedSourceDigest,
        rollbackAvailable: fs.existsSync(lastKnownGood),
        signatureVerified: bundleSignature.verified,
        signerKeyId: bundleSignature.keyId,
      };
    } catch (error) {
      try { removeDiscoveryCopies(root, manifest); } catch (_) {}
      try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
      if (movedExisting && fs.existsSync(backup)) {
        fs.renameSync(backup, root);
        try {
          const restoredManifest = readInstallManifest(root);
          syncDiscoveryCopies(root, restoredManifest);
        } catch (_) {}
      }
      throw error;
    }
  } finally {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(retiredLastKnownGood, { recursive: true, force: true }); } catch (_) {}
    if (!fs.existsSync(root) && movedExisting && fs.existsSync(backup)) {
      try { fs.renameSync(backup, root); } catch (_) {}
    }
  }
}

function rollback(options = {}) {
  const root = assertInstallRoot(defaultInstallRoot(options));
  const lastKnownGood = `${root}.last-known-good`;
  verifyInstallation({ ...options, installRoot: root });
  const currentManifestDigest = sha256File(path.join(root, INSTALL_MANIFEST));
  verifyInstallation({ ...options, installRoot: lastKnownGood, verifyDiscovery: false });
  const parent = path.dirname(root);
  const current = path.join(parent, `.${path.basename(root)}.rollback-current-${process.pid}-${crypto.randomUUID()}`);
  const rollbackCandidate = path.join(
    parent,
    `.${path.basename(root)}.rollback-candidate-${process.pid}-${crypto.randomUUID()}`,
  );
  let currentMoved = false;
  let rollbackActivated = false;
  let discoveryCommitted = false;
  try {
    fs.renameSync(root, current);
    currentMoved = true;
    fs.renameSync(lastKnownGood, root);
    rollbackActivated = true;
    syncDiscoveryCopies(root, readInstallManifest(root));
    discoveryCommitted = true;
    const verified = verifyInstallation({ ...options, installRoot: root });
    fs.renameSync(current, lastKnownGood);
    currentMoved = false;
    return {
      ...verified,
      rolledBack: true,
      rollbackAvailable: true,
    };
  } catch (error) {
    const restorationErrors = [];
    if (currentMoved) {
      if (rollbackActivated && fs.existsSync(root)) {
        try {
          fs.renameSync(root, rollbackCandidate);
        } catch (_) {
          restorationErrors.push('candidate-preserve-failed');
        }
      }
      if (!fs.existsSync(root) && fs.existsSync(current)) {
        try {
          fs.renameSync(current, root);
          currentMoved = false;
        } catch (_) {
          restorationErrors.push('current-restore-failed');
        }
      }
      if (fs.existsSync(rollbackCandidate) && !fs.existsSync(lastKnownGood)) {
        try {
          fs.renameSync(rollbackCandidate, lastKnownGood);
          rollbackActivated = false;
        } catch (_) {
          restorationErrors.push('rollback-candidate-restore-failed');
        }
      }
    }
    if (fs.existsSync(root)) {
      try {
        verifyInstallation({ ...options, installRoot: root, verifyDiscovery: false });
        if (sha256File(path.join(root, INSTALL_MANIFEST)) !== currentManifestDigest) {
          restorationErrors.push('current-version-changed');
        }
      } catch (_) {
        restorationErrors.push('current-verify-failed');
      }
      if (discoveryCommitted) {
        try {
          syncDiscoveryCopies(root, readInstallManifest(root));
          verifyInstallation({ ...options, installRoot: root });
        } catch (_) {
          restorationErrors.push('discovery-restore-failed');
        }
      }
    } else {
      restorationErrors.push('current-missing');
    }
    if (restorationErrors.length) {
      throw new InstallerError(
        'INSTALL_ROLLBACK_RESTORE_FAILED',
        'zcanvas 回滚失败，且原版本自动恢复未通过完整校验；请保留安装目录并重试更新',
      );
    }
    throw error instanceof InstallerError
      ? error
      : new InstallerError('INSTALL_ROLLBACK_FAILED', `无法回滚 zcanvas：${error?.message || '文件正在使用'}`);
  }
}

function uninstall(options = {}) {
  const root = assertInstallRoot(defaultInstallRoot(options));
  const manifest = readInstallManifest(root);
  const parent = path.dirname(root);
  const tombstone = path.join(parent, `.${path.basename(root)}.remove-${process.pid}-${crypto.randomUUID()}`);
  const lastKnownGood = `${root}.last-known-good`;
  const lastKnownGoodTombstone = path.join(parent, `.${path.basename(root)}.lkg-remove-${process.pid}-${crypto.randomUUID()}`);
  if (fs.existsSync(lastKnownGood)) readInstallManifest(lastKnownGood);
  removeDiscoveryCopies(root, manifest);
  fs.renameSync(root, tombstone);
  if (fs.existsSync(lastKnownGood)) fs.renameSync(lastKnownGood, lastKnownGoodTombstone);
  try {
    fs.rmSync(tombstone, { recursive: true, force: false });
    if (fs.existsSync(lastKnownGoodTombstone)) fs.rmSync(lastKnownGoodTombstone, { recursive: true, force: false });
  } catch (error) {
    if (!fs.existsSync(root) && fs.existsSync(tombstone)) fs.renameSync(tombstone, root);
    if (!fs.existsSync(lastKnownGood) && fs.existsSync(lastKnownGoodTombstone)) {
      fs.renameSync(lastKnownGoodTombstone, lastKnownGood);
    }
    if (fs.existsSync(root)) {
      try { syncDiscoveryCopies(root, readInstallManifest(root)); } catch (_) {}
    }
    throw new InstallerError('INSTALL_UNINSTALL_FAILED', `无法卸载 zcanvas：${error?.message || '文件正在使用'}`);
  }
  return {
    root,
    skillVersion: manifest.skillVersion,
    cliVersion: manifest.cliVersion,
    removed: true,
    credentialsPreserved: true,
    discoveryRoots: Array.isArray(manifest.discoveryRoots) ? manifest.discoveryRoots : [],
  };
}

module.exports = {
  BUNDLE_SIGNATURE_FILE,
  BUNDLE_SIGNATURE_SCHEMA,
  BUNDLE_TRUST_POLICY_SCHEMA,
  INSTALL_MANIFEST,
  INSTALL_SCHEMA,
  InstallerError,
  bundleSignaturePayload,
  defaultDiscoveryRoots,
  defaultInstallRoot,
  install,
  normalizeInstallManifest,
  normalizeSourceManifest,
  normalizeTrustedBundleSigners,
  readInstallManifest,
  readSourceManifest,
  readTrustedBundleSignerPolicy,
  rollback,
  sourceLayout,
  sourceDigest,
  uninstall,
  verifyBundleSignature,
  verifyBundleSource,
  verifyInstallation,
};
