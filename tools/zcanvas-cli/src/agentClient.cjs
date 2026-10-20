'use strict';

const { discoverInstances } = require('./discovery.cjs');
const { readManifest } = require('./manifest.cjs');

const AGENT_CONTROL_RESPONSE_LIMIT = 256 * 1024;
const AGENT_CONTROL_TIMEOUT_MS = 8_000;

class AgentClientError extends Error {
  constructor(code, message, status = 0, details = {}) {
    super(message);
    this.name = 'AgentClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function assertLoopbackOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(String(origin || ''));
  } catch (_) {
    throw new AgentClientError('APP_INSTANCE_INVALID', '画布实例地址无效');
  }
  if (parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    throw new AgentClientError('APP_INSTANCE_INVALID', 'Agent Control 只允许连接本机画布实例');
  }
  return parsed.origin;
}

function semverTuple(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(String(value || '').trim());
  return match ? match.slice(1).map(Number) : null;
}

function compareSemver(left, right) {
  const a = semverTuple(left);
  const b = semverTuple(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function assertCompatibleInstance(instance, options = {}) {
  const manifest = options.manifest || readManifest();
  if (String(instance?.controlProtocol || '') !== String(manifest.controlProtocol || '')) {
    throw new AgentClientError(
      'AGENT_CONTROL_PROTOCOL_MISMATCH',
      `当前画布协议与 zcanvas 不兼容；需要 ${manifest.controlProtocol}`,
      0,
      { expected: manifest.controlProtocol, actual: instance?.controlProtocol || null },
    );
  }
  const comparison = compareSemver(instance?.appVersion, manifest.minimumDesktopVersion);
  if (comparison == null) {
    throw new AgentClientError(
      'APP_VERSION_INVALID',
      '画布实例没有返回可校验的版本，未执行任何操作',
      0,
    );
  }
  if (comparison < 0) {
    throw new AgentClientError(
      'APP_VERSION_INCOMPATIBLE',
      `当前画布 ${instance.appVersion} 过旧；zcanvas 至少需要 ${manifest.minimumDesktopVersion}`,
      0,
      { minimumDesktopVersion: manifest.minimumDesktopVersion, appVersion: instance.appVersion },
    );
  }
  const exactChecks = [
    ['skillVersion', 'AGENT_SKILL_VERSION_MISMATCH', 'Skill'],
    ['cliVersion', 'AGENT_CLI_VERSION_MISMATCH', 'CLI'],
    ['canvasPatchProtocol', 'CANVAS_PATCH_PROTOCOL_MISMATCH', 'CanvasPatch 协议'],
    ['nodeSchemaDigest', 'NODE_SCHEMA_DIGEST_MISMATCH', '节点 schema'],
    ['providerCatalogDigest', 'PROVIDER_CATALOG_DIGEST_MISMATCH', 'Provider 模型目录'],
    ['creativeCapabilityManifestDigest', 'CREATIVE_CAPABILITY_MANIFEST_DIGEST_MISMATCH', '创作能力清单'],
    ['creativeCapabilityGraphDigest', 'CREATIVE_CAPABILITY_GRAPH_DIGEST_MISMATCH', '创作能力图谱'],
    ['manifestDigest', 'AGENT_MANIFEST_DIGEST_MISMATCH', '兼容清单'],
  ];
  for (const [field, code, label] of exactChecks) {
    const expected = String(manifest[field] || '');
    const actual = String(instance?.[field] || '');
    if (!expected || actual !== expected) {
      throw new AgentClientError(
        code,
        `${label}与正在运行的画布不一致；即使版本号相同，内容摘要也必须匹配。请在该桌面画布设置中安装/修复 Agent 连接工具，再由连接端重新审阅工具目录；未执行任何写入`,
        0,
        { field, expected: expected || null, actual: actual || null },
      );
    }
  }
  return instance;
}

async function selectInstance(instanceId = '', options = {}) {
  const instances = await (options.discoverInstances || discoverInstances)(options.discoveryOptions || {});
  const requested = String(instanceId || '').trim();
  if (requested) {
    const selected = instances.find((item) => item.instanceId === requested);
    if (!selected) {
      throw new AgentClientError('APP_NOT_RUNNING', `找不到指定的画布实例：${requested}`, 0, { instances });
    }
    return assertCompatibleInstance(selected, options);
  }
  if (!instances.length) {
    throw new AgentClientError('APP_NOT_RUNNING', '没有发现可连接的贞贞无限画布实例', 0, { instances });
  }
  if (instances.length > 1) {
    throw new AgentClientError(
      'APP_INSTANCE_AMBIGUOUS',
      `发现 ${instances.length} 个画布实例，请使用 --instance 明确选择`,
      0,
      { instances },
    );
  }
  return assertCompatibleInstance(instances[0], options);
}

async function requestAgentControl(instance, pathname, options = {}) {
  const origin = assertLoopbackOrigin(instance?.origin);
  const normalizedPath = String(pathname || '');
  if (!normalizedPath.startsWith('/api/agent-control/v1/')) {
    throw new AgentClientError('AGENT_CONTROL_PATH_INVALID', 'Agent Control 请求路径无效');
  }
  const timeoutMs = Math.max(250, Math.min(30_000, Number(options.timeoutMs) || AGENT_CONTROL_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.accessToken) headers.Authorization = `Bearer ${String(options.accessToken)}`;
    const response = await (options.fetch || globalThis.fetch)(`${origin}${normalizedPath}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
      signal: controller.signal,
    });
    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > AGENT_CONTROL_RESPONSE_LIMIT) {
      throw new AgentClientError('AGENT_CONTROL_RESPONSE_TOO_LARGE', '画布返回内容超过安全限制');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > AGENT_CONTROL_RESPONSE_LIMIT) {
      throw new AgentClientError('AGENT_CONTROL_RESPONSE_TOO_LARGE', '画布返回内容超过安全限制');
    }
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_) {
      throw new AgentClientError('AGENT_CONTROL_RESPONSE_INVALID', '画布返回了无法识别的响应');
    }
    if (payload?.schema !== 't8-agent-control-http-v1') {
      throw new AgentClientError('AGENT_CONTROL_PROTOCOL_MISMATCH', '画布 Agent Control 协议不兼容');
    }
    if (!response.ok || payload.ok !== true) {
      throw new AgentClientError(
        String(payload?.code || 'AGENT_CONTROL_REQUEST_FAILED'),
        String(payload?.message || `画布请求失败（HTTP ${response.status}）`),
        response.status,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof AgentClientError) throw error;
    if (error?.name === 'AbortError') {
      throw new AgentClientError('AGENT_CONTROL_TIMEOUT', '连接画布超时，请确认应用仍在运行');
    }
    throw new AgentClientError('APP_CONNECTION_FAILED', `无法连接画布：${error?.message || String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  AGENT_CONTROL_RESPONSE_LIMIT,
  AgentClientError,
  assertCompatibleInstance,
  assertLoopbackOrigin,
  compareSemver,
  requestAgentControl,
  selectInstance,
};
