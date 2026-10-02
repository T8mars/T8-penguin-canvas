'use strict';

const dns = require('dns').promises;
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');

const DEFAULT_MAX_BYTES = 30 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 4;
const DEFAULT_JSON_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_JSON_MAX_DEPTH = 64;
const DEFAULT_JSON_MAX_NODES = 50_000;
const DEFAULT_UPLOAD_RESPONSE_MAX_BYTES = 64 * 1024;
const REQUEST_WRITE_CHUNK_BYTES = 64 * 1024;
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);
const TUN_FAKE_IPV4_NETWORK = 0xc6120000;
const TUN_FAKE_IPV4_PREFIX_LENGTH = 15;
const TUN_PUBLIC_DNS_TIMEOUT_MS = 3_000;
const TUN_PUBLIC_DNS_SERVERS = Object.freeze(
  String(process.env.T8_TUN_PUBLIC_DNS_SERVERS || '223.5.5.5,1.1.1.1,8.8.8.8')
    .split(',')
    .map((value) => value.trim())
    .filter((value, index, all) => net.isIP(value) && all.indexOf(value) === index)
    .slice(0, 4),
);
const TUN_DOH_ENDPOINTS = Object.freeze([
  Object.freeze({ address: '223.5.5.5', servername: 'dns.alidns.com', path: '/resolve' }),
  Object.freeze({ address: '1.1.1.1', servername: 'cloudflare-dns.com' }),
  Object.freeze({ address: '8.8.8.8', servername: 'dns.google' }),
]);
const TUN_DOH_MAX_BYTES = 64 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const CROSS_ORIGIN_SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'cookie2',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'api-key',
  'x-goog-api-key',
]);

function remoteMediaError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizeAddress(value) {
  let text = String(value || '').trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  return text;
}

function parseIpv4Number(value) {
  const address = normalizeAddress(value);
  if (!net.isIPv4(address)) return null;
  return address.split('.').reduce((result, part) => ((result * 256) + Number(part)) >>> 0, 0);
}

function matchesIpv4Cidr(value, network, prefixLength) {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return ((value & mask) >>> 0) === ((network & mask) >>> 0);
}

// IANA special-purpose ranges that are not ordinary globally-routable unicast
// destinations. Several of the 192/8 entries are anycast/protocol assignments;
// a media downloader has no reason to reach them and treating them as public
// creates unnecessary SSRF ambiguity.
const BLOCKED_IPV4_RANGES = Object.freeze([
  [0x00000000, 8], // 0.0.0.0/8, this network
  [0x0a000000, 8], // RFC1918
  [0x64400000, 10], // RFC6598 shared address space / CGNAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local
  [0xac100000, 12], // RFC1918
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // TEST-NET-1
  [0xc01fc400, 24], // AS112-v4 anycast
  [0xc034c100, 24], // AMT anycast
  [0xc0586300, 24], // deprecated 6to4 relay anycast
  [0xc0a80000, 16], // RFC1918
  [0xc0af3000, 24], // AS112 direct delegation
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // TEST-NET-2
  [0xcb007100, 24], // TEST-NET-3
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved and limited broadcast
]);

function parseIpv6Bytes(value) {
  const normalized = normalizeAddress(value);
  if (!normalized || normalized.includes('%') || !net.isIPv6(normalized)) return null;
  let address = normalized;
  if (address.includes('.')) {
    const colon = address.lastIndexOf(':');
    const ipv4 = parseIpv4Number(address.slice(colon + 1));
    if (colon < 0 || ipv4 === null) return null;
    address = `${address.slice(0, colon)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = halves.length === 2
    ? [...left, ...Array(missing).fill('0'), ...right]
    : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const bytes = Buffer.allocUnsafe(16);
  parts.forEach((part, index) => bytes.writeUInt16BE(Number.parseInt(part, 16), index * 2));
  return bytes;
}

function matchesIpv6Cidr(value, network, prefixLength) {
  const fullBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (value[index] !== network[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (value[fullBytes] & mask) === (network[fullBytes] & mask);
}

function tunFakeIpv6Ranges() {
  const configured = String(process.env.T8_TUN_FAKE_IPV6_CIDRS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const cidrs = ['fdfe:dcba:9876::/64', ...configured];
  const seen = new Set();
  const ranges = [];
  for (const cidr of cidrs) {
    const separator = cidr.lastIndexOf('/');
    if (separator <= 0) continue;
    const prefixLength = Number(cidr.slice(separator + 1));
    const network = parseIpv6Bytes(cidr.slice(0, separator));
    if (!network || !Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 128) continue;
    const key = `${network.toString('hex')}/${prefixLength}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push(Object.freeze({ network, prefixLength }));
  }
  return Object.freeze(ranges);
}

// Clash/Mihomo uses 198.18.0.0/15 and fdfe:dcba:9876::/64 as synthetic
// routing tokens in Fake-IP mode. They are exempted only when a hostname was
// resolved by the active TUN; literal Fake-IP URLs and ordinary private
// addresses still fail closed. Trusted Provider downloads additionally use
// Chromium's system route, so the TUN keeps ownership of the real connection.
const TUN_FAKE_IPV6_RANGES = tunFakeIpv6Ranges();

function isTunFakeAddress(value) {
  const ipv4 = ipv4NumberFromAddress(value);
  if (ipv4 !== null) {
    return matchesIpv4Cidr(
      ipv4,
      TUN_FAKE_IPV4_NETWORK,
      TUN_FAKE_IPV4_PREFIX_LENGTH,
    );
  }
  const ipv6 = parseIpv6Bytes(value);
  return Boolean(ipv6 && TUN_FAKE_IPV6_RANGES.some(({ network, prefixLength }) => (
    matchesIpv6Cidr(ipv6, network, prefixLength)
  )));
}

const BLOCKED_IPV6_RANGES = Object.freeze([
  ['2001::', 23], // IETF special-purpose space (Teredo, benchmarking, ORCHID, etc.)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // deprecated 6to4
  ['2620:4f:8000::', 48], // AS112 direct delegation anycast
  ['3fff::', 20], // documentation
].map(([network, prefixLength]) => Object.freeze({
  network: parseIpv6Bytes(network),
  prefixLength,
})));

function ipv4FromMappedIpv6(bytes) {
  if (!bytes || bytes.length !== 16) return null;
  for (let index = 0; index < 10; index += 1) {
    if (bytes[index] !== 0) return null;
  }
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return bytes.readUInt32BE(12);
}

function ipv4FromStandardNat64(bytes) {
  if (!bytes || bytes.length !== 16) return null;
  if (bytes[0] !== 0x00 || bytes[1] !== 0x64 || bytes[2] !== 0xff || bytes[3] !== 0x9b) {
    return null;
  }
  for (let index = 4; index < 12; index += 1) {
    if (bytes[index] !== 0) return null;
  }
  return bytes.readUInt32BE(12);
}

function ipv4NumberFromAddress(value) {
  const direct = parseIpv4Number(value);
  if (direct !== null) return direct;
  const ipv6 = parseIpv6Bytes(value);
  if (!ipv6) return null;
  return ipv4FromMappedIpv6(ipv6) ?? ipv4FromStandardNat64(ipv6);
}

function isLoopbackAddress(value) {
  const address = normalizeAddress(value);
  if (address === 'localhost') return true;
  const ipv4 = ipv4NumberFromAddress(address);
  if (ipv4 !== null) return matchesIpv4Cidr(ipv4, 0x7f000000, 8);
  const ipv6 = parseIpv6Bytes(address);
  if (!ipv6) return false;
  return ipv6.subarray(0, 15).every((byte) => byte === 0) && ipv6[15] === 1;
}

// Despite its historical name, this is intentionally a "not globally-routable
// unicast" classifier. Unknown address syntax also fails closed.
function isPrivateAddress(value) {
  const address = normalizeAddress(value);
  if (!address || address === 'localhost') return true;
  const ipv4 = ipv4NumberFromAddress(address);
  if (ipv4 !== null) {
    return BLOCKED_IPV4_RANGES.some(([network, prefixLength]) => matchesIpv4Cidr(ipv4, network, prefixLength));
  }
  const ipv6 = parseIpv6Bytes(address);
  if (!ipv6) return true;
  // Standard IPv4-mapped and RFC 6052 well-known NAT64 addresses were already
  // classified through their embedded IPv4 value above. Remaining addresses
  // must be ordinary RFC 4291 global unicast.
  if ((ipv6[0] & 0xe0) !== 0x20) return true;
  return BLOCKED_IPV6_RANGES.some(({ network, prefixLength }) => matchesIpv6Cidr(ipv6, network, prefixLength));
}

function privateAddressAllowedForTests(setting, hostname) {
  if (setting === true) return true;
  return typeof setting === 'function' && setting(normalizeAddress(hostname)) === true;
}

async function resolveFromPublicDnsServer(hostname, server) {
  const resolver = new dns.Resolver();
  resolver.setServers([server]);
  let timer;
  try {
    const settled = await Promise.race([
      Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname),
      ]),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          resolver.cancel();
          reject(remoteMediaError('tun_dns_fallback_timeout', 'TUN 公共 DNS 回源解析超时。'));
        }, TUN_PUBLIC_DNS_TIMEOUT_MS);
      }),
    ]);
    const records = [];
    for (const [index, result] of settled.entries()) {
      if (result.status !== 'fulfilled') continue;
      const family = index === 0 ? 4 : 6;
      for (const value of result.value || []) {
        const address = normalizeAddress(value);
        if (net.isIP(address) === family) records.push({ address, family });
      }
    }
    return records;
  } finally {
    if (timer) clearTimeout(timer);
    resolver.cancel();
  }
}

function normalizedTunPublicRecords(records) {
  const normalized = [];
  for (const record of records || []) {
    const address = normalizeAddress(record?.address);
    const detectedFamily = net.isIP(address);
    const family = Number(record?.family) || detectedFamily;
    if (!detectedFamily || family !== detectedFamily) continue;
    normalized.push({ address, family });
  }
  return normalized;
}

function parseDohAnswer(data) {
  if (Number(data?.Status) !== 0 || !Array.isArray(data?.Answer)) return [];
  const records = [];
  for (const answer of data.Answer) {
    const type = Number(answer?.type);
    const address = normalizeAddress(answer?.data);
    if (type === 1 && net.isIPv4(address)) records.push({ address, family: 4 });
    else if (type === 28 && net.isIPv6(address)) records.push({ address, family: 6 });
  }
  return records;
}

function resolveDohRecordType(hostname, endpoint, type) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let total = 0;
    const chunks = [];
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const request = https.request({
      protocol: 'https:',
      hostname: endpoint.address,
      port: 443,
      servername: endpoint.servername,
      method: 'GET',
      path: `${String(endpoint.path || '/dns-query').replace(/\?+$/, '')}?name=${encodeURIComponent(hostname)}&type=${encodeURIComponent(type)}`,
      agent: false,
      headers: {
        Host: endpoint.servername,
        Accept: 'application/dns-json',
        Connection: 'close',
        'User-Agent': 'T8-PenguinCanvas/1.0',
      },
      timeout: TUN_PUBLIC_DNS_TIMEOUT_MS,
    }, (response) => {
      if (Number(response.statusCode || 0) < 200 || Number(response.statusCode || 0) >= 300) {
        response.resume();
        finish(reject, remoteMediaError(
          'tun_dns_fallback_doh_http',
          `加密 DNS 回源返回 HTTP ${Number(response.statusCode || 0) || 'unknown'}。`,
        ));
        return;
      }
      response.on('data', (chunk) => {
        if (settled) return;
        total += chunk.length;
        if (total > TUN_DOH_MAX_BYTES) {
          response.destroy();
          finish(reject, remoteMediaError('tun_dns_fallback_doh_too_large', '加密 DNS 回源响应过大。'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        try {
          finish(resolve, parseDohAnswer(JSON.parse(Buffer.concat(chunks, total).toString('utf8'))));
        } catch (error) {
          finish(reject, remoteMediaError('tun_dns_fallback_doh_invalid', '加密 DNS 回源响应无效。', { cause: error }));
        }
      });
      response.on('error', (error) => finish(reject, error));
    });
    request.once('timeout', () => request.destroy(
      remoteMediaError('tun_dns_fallback_doh_timeout', '加密 DNS 回源超时。'),
    ));
    request.once('error', (error) => finish(reject, error));
    request.end();
  });
}

async function resolveFromPublicDoh(hostname, endpoint) {
  const settled = await Promise.allSettled([
    resolveDohRecordType(hostname, endpoint, 'A'),
    resolveDohRecordType(hostname, endpoint, 'AAAA'),
  ]);
  return settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

async function resolveTunPublicDns(hostname, options = {}) {
  const dnsServers = Array.isArray(options.dnsServers) ? options.dnsServers : TUN_PUBLIC_DNS_SERVERS;
  const dohEndpoints = Array.isArray(options.dohEndpoints) ? options.dohEndpoints : TUN_DOH_ENDPOINTS;
  const resolveFromServer = options.resolveFromServer || resolveFromPublicDnsServer;
  const resolveFromDoh = options.resolveFromDoh || resolveFromPublicDoh;
  let lastError = null;
  for (const server of dnsServers) {
    try {
      const records = normalizedTunPublicRecords(await resolveFromServer(hostname, server));
      if (!records.length) continue;
      if (records.some((record) => isPrivateAddress(record.address))) {
        lastError = remoteMediaError('tun_dns_fallback_private', '公共 DNS 返回了非公网地址。');
        continue;
      }
      return records;
    } catch (error) {
      lastError = error;
    }
  }
  // Clash Fake-IP/TUN 常会劫持全部 UDP/53，即便显式指定 1.1.1.1 仍返回
  // 198.18.0.0/15。此时直接连接可信 DoH 的固定公网 IP，并使用正确
  // TLS SNI/Host 取得真实记录；不依赖系统 DNS，也不会放宽任意内网地址。
  for (const endpoint of dohEndpoints) {
    try {
      const records = normalizedTunPublicRecords(await resolveFromDoh(hostname, endpoint));
      if (!records.length) continue;
      if (records.some((record) => isPrivateAddress(record.address))) {
        lastError = remoteMediaError('tun_dns_fallback_private', '加密 DNS 返回了非公网地址。');
        continue;
      }
      return records;
    } catch (error) {
      lastError = error;
    }
  }
  throw remoteMediaError(
    'tun_dns_fallback_failed',
    '检测到 TUN Fake-IP，但无法通过独立公共 DNS 或加密 DNS 获取真实公网地址。',
    { cause: lastError },
  );
}

function normalizedPublicRecords(records, bypass) {
  const normalizedRecords = (Array.isArray(records) ? records : (records ? [records] : [])).map((record) => {
    const address = normalizeAddress(record?.address);
    const detectedFamily = net.isIP(address);
    const family = Number(record?.family) || detectedFamily;
    return { address, family, detectedFamily };
  });
  if (!normalizedRecords.length || normalizedRecords.some((record) => (
    !record.detectedFamily || record.family !== record.detectedFamily || (!bypass && isPrivateAddress(record.address))
  ))) {
    throw remoteMediaError('private_address', '远程地址不是全球可路由单播地址，已拒绝访问。');
  }
  const deduped = [];
  const seen = new Set();
  for (const record of normalizedRecords) {
    const key = `${record.family}:${record.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      address: record.address,
      family: record.family,
      tunFake: false,
    });
  }
  // Prefer IPv4 when both families are available. A sizeable group of Windows
  // users has IPv6 enabled but no usable IPv6 route after TUN/VPN changes.
  // IPv6-only destinations are still supported and are attempted normally.
  return deduped.sort((left, right) => {
    if (left.family === right.family) return 0;
    return left.family === 4 ? -1 : 1;
  });
}

async function resolvePublicAddresses(
  hostname,
  lookupImpl = dns.lookup,
  allowPrivateForTests = false,
  publicLookupImpl = resolveTunPublicDns,
  acceptTunFake = true,
) {
  const normalizedHostname = normalizeAddress(hostname);
  const bypass = privateAddressAllowedForTests(allowPrivateForTests, normalizedHostname);
  if (!normalizedHostname || (!bypass && net.isIP(normalizedHostname) && isPrivateAddress(normalizedHostname))) {
    throw remoteMediaError('private_address', '远程地址不是全球可路由单播地址，已拒绝访问。');
  }
  let lookedUp;
  try {
    lookedUp = await lookupImpl(normalizedHostname, { all: true, verbatim: true });
  } catch (error) {
    if (!['ENOTFOUND', 'EAI_AGAIN'].includes(String(error?.code || '').toUpperCase())) throw error;
    lookedUp = await publicLookupImpl(normalizedHostname);
  }
  let records = Array.isArray(lookedUp) ? lookedUp : (lookedUp ? [lookedUp] : []);
  let normalizedRecords = records.map((record) => {
    const address = normalizeAddress(record?.address);
    const detectedFamily = net.isIP(address);
    const family = Number(record?.family) || detectedFamily;
    return { address, family, detectedFamily };
  });
  // A Fake-IP returned for a hostname is a routing token owned by the active
  // TUN, not the real destination. Keep all valid synthetic answers (IPv4
  // first, then IPv6) as the connection paths so
  // Clash/sing-box can apply the user's domain rules. Literal Fake-IP URLs are
  // still rejected above. If that connection fails, the caller falls back to
  // independently resolved public addresses without weakening the SSRF policy.
  const tunFakeRecords = normalizedRecords.filter((record) => (
    record.detectedFamily
    && record.family === record.detectedFamily
    && isTunFakeAddress(record.address)
  ));
  if (tunFakeRecords.length && normalizedRecords.some((record) => (
    !record.detectedFamily
    || record.family !== record.detectedFamily
    || (!bypass && isPrivateAddress(record.address) && !isTunFakeAddress(record.address))
  ))) {
    throw remoteMediaError('private_address', '远程地址不是全球可路由单播地址，已拒绝访问。');
  }
  if (tunFakeRecords.length && acceptTunFake) {
    const seenTunRecords = new Set();
    return tunFakeRecords
      .filter((record) => {
        const key = `${record.family}:${record.address}`;
        if (seenTunRecords.has(key)) return false;
        seenTunRecords.add(key);
        return true;
      })
      .map((record) => ({
        address: record.address,
        family: record.family,
        tunFake: true,
      }))
      .sort((left, right) => left.family === right.family ? 0 : (left.family === 4 ? -1 : 1));
  }
  if (tunFakeRecords.length) {
    records = await publicLookupImpl(normalizedHostname);
  }
  return normalizedPublicRecords(records, bypass);
}

async function resolvePublicAddress(
  hostname,
  lookupImpl = dns.lookup,
  allowPrivateForTests = false,
  publicLookupImpl = resolveTunPublicDns,
  acceptTunFake = true,
) {
  const records = await resolvePublicAddresses(
    hostname,
    lookupImpl,
    allowPrivateForTests,
    publicLookupImpl,
    acceptTunFake,
  );
  return records[0];
}

function positiveInteger(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function allowedProtocols(value) {
  let values;
  if (value === undefined) values = ['http:', 'https:'];
  else if (typeof value === 'string') values = [value];
  else {
    try { values = Array.from(value || []); } catch (_) {
      throw remoteMediaError('invalid_protocol', '远程资源协议限制无效。');
    }
  }
  const result = new Set(values.map((protocol) => {
    const normalized = String(protocol || '').trim().toLowerCase();
    return normalized.endsWith(':') ? normalized : `${normalized}:`;
  }));
  for (const protocol of result) {
    if (!SUPPORTED_PROTOCOLS.has(protocol)) {
      throw remoteMediaError('invalid_protocol', '只支持 HTTP/HTTPS 远程地址。');
    }
  }
  return result;
}

function parseRemoteUrl(inputUrl, options) {
  const raw = String(inputUrl || '').trim();
  if (!raw || raw.length > 16_384) throw remoteMediaError('invalid_url', '远程资源地址无效。');
  let target;
  try { target = new URL(raw); } catch (_) { throw remoteMediaError('invalid_url', '远程资源地址无效。'); }
  const protocols = options._protocols || allowedProtocols(options.protocols);
  if (!protocols.has(target.protocol)) {
    throw remoteMediaError('invalid_protocol', `远程资源协议 ${target.protocol || '(empty)'} 未获允许。`);
  }
  if (target.username || target.password) {
    throw remoteMediaError('url_credentials_forbidden', '远程资源地址禁止包含用户名或密码。');
  }
  if (!target.hostname) throw remoteMediaError('invalid_url', '远程资源地址缺少主机名。');
  target.hash = '';
  return target;
}

function requestHeaders(options, sensitiveHeadersAllowed = true) {
  const headers = new Map([
    ['accept', String(options.accept || '*/*')],
    ['user-agent', String(options.userAgent || 'T8-PenguinCanvas/1.0')],
  ]);
  for (const [name, value] of Object.entries(options.headers || {})) {
    const normalizedName = String(name).trim().toLowerCase();
    if (!normalizedName || HOP_BY_HOP_HEADERS.has(normalizedName) || value === undefined) continue;
    headers.set(normalizedName, value);
  }
  if (!sensitiveHeadersAllowed) {
    for (const name of CROSS_ORIGIN_SENSITIVE_HEADERS) headers.delete(name);
  }
  return Object.fromEntries(headers);
}

function fetchTimeoutError(kind) {
  return remoteMediaError(
    'fetch_timeout',
    kind === 'deadline' ? '远程资源读取超过绝对时限。' : '远程资源读取空闲超时。',
    { timeoutKind: kind },
  );
}

function remainingDeadlineMs(state) {
  const remaining = state.deadlineAt - Date.now();
  if (remaining <= 0) throw fetchTimeoutError('deadline');
  return remaining;
}

function transferAbortError(signal) {
  const error = remoteMediaError('request_aborted', '远程资源读取已取消。', {
    cause: signal?.reason,
  });
  error.name = 'AbortError';
  return error;
}

function throwIfTransferAborted(state) {
  if (state?.signal?.aborted) throw transferAbortError(state.signal);
}

async function withinDeadline(promise, state) {
  throwIfTransferAborted(state);
  const remaining = remainingDeadlineMs(state);
  let timer;
  let abortListener;
  try {
    const competitors = [
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(fetchTimeoutError('deadline')), remaining);
      }),
    ];
    if (state.signal) {
      competitors.push(new Promise((_, reject) => {
        abortListener = () => reject(transferAbortError(state.signal));
        state.signal.addEventListener('abort', abortListener, { once: true });
      }));
    }
    return await Promise.race(competitors);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener && state.signal) state.signal.removeEventListener('abort', abortListener);
  }
}

function writeRequestParts(request, parts, onBodyQueued = () => {}) {
  return new Promise((resolve, reject) => {
    let index = 0;
    let partOffset = 0;
    let settled = false;
    let scheduledImmediate = null;
    let bodyQueued = false;
    const cleanup = () => {
      if (scheduledImmediate) clearImmediate(scheduledImmediate);
      request.off('drain', writeNext);
      request.off('finish', onFinish);
      request.off('error', onError);
      request.off('close', onClose);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onFinish = () => settle(resolve);
    const onError = (error) => settle(reject, error);
    const onClose = () => {
      if (!request.writableFinished) {
        settle(reject, remoteMediaError('upload_incomplete', '远程上传请求体未完整发送。'));
      }
    };
    const markBodyQueued = () => {
      if (bodyQueued) return;
      bodyQueued = true;
      onBodyQueued();
    };
    const hasRemainingBody = () => {
      if (index < parts.length && partOffset < parts[index].length) return true;
      for (let nextIndex = index + 1; nextIndex < parts.length; nextIndex += 1) {
        if (parts[nextIndex].length > 0) return true;
      }
      return false;
    };
    const writeNext = () => {
      try {
        if (request.destroyed) {
          settle(reject, remoteMediaError('upload_incomplete', '远程上传请求体未完整发送。'));
          return;
        }
        while (index < parts.length && partOffset >= parts[index].length) {
          index += 1;
          partOffset = 0;
        }
        if (index < parts.length) {
          const part = parts[index];
          const nextOffset = Math.min(part.length, partOffset + REQUEST_WRITE_CHUNK_BYTES);
          const chunk = part.subarray(partOffset, nextOffset);
          partOffset = nextOffset;
          const accepted = request.write(chunk);
          if (!hasRemainingBody()) {
            markBodyQueued();
            request.end();
            return;
          }
          if (!accepted) {
            request.once('drain', writeNext);
            return;
          }
          // Yield between bounded writes so an endpoint that responds before
          // consuming the body can interrupt us before the whole Buffer is
          // handed to the Windows kernel send queue.
          scheduledImmediate = setImmediate(() => {
            scheduledImmediate = null;
            writeNext();
          });
          return;
        }
        markBodyQueued();
        request.end();
      } catch (error) {
        settle(reject, error);
      }
    };
    request.once('finish', onFinish);
    request.once('error', onError);
    request.once('close', onClose);
    writeNext();
  });
}

function issuePinnedRequest(target, pinned, headers, state, requestOptions = {}) {
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let request;
    let pendingResponse = null;
    let bodyQueued = !requestOptions.requireBodyCompletion;
    let bodyCompleted = !requestOptions.requireBodyCompletion;
    let settled = false;
    let deadlineTimer;
    let connectTimer;
    let requestSocket;
    let connectedEvent;
    let abortListener;
    const clearConnectTimer = () => {
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      if (requestSocket && connectedEvent) requestSocket.off(connectedEvent, clearConnectTimer);
      requestSocket = null;
      connectedEvent = null;
    };
    const cleanup = () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      clearConnectTimer();
      if (request) request.setTimeout(0);
      if (pendingResponse) {
        pendingResponse.off('error', fail);
        pendingResponse.off('aborted', responseAborted);
      }
      if (abortListener && state.signal) state.signal.removeEventListener('abort', abortListener);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (pendingResponse) pendingResponse.destroy();
      if (
        requestOptions.requireBodyCompletion
        && !bodyCompleted
        && String(error?.code || '').toUpperCase() === 'ECONNRESET'
      ) {
        reject(remoteMediaError(
          'upload_incomplete',
          '远程上传连接在请求体发送完毕前关闭，已拒绝将其视为成功。',
          { cause: error },
        ));
        return;
      }
      reject(error);
    };
    const responseAborted = () => fail(remoteMediaError('remote_response_aborted', '远程服务响应提前中断。'));
    const maybeResolve = () => {
      if (settled || !pendingResponse || !bodyCompleted) return;
      settled = true;
      const response = pendingResponse;
      cleanup();
      resolve(response);
    };
    try {
      throwIfTransferAborted(state);
      const remaining = remainingDeadlineMs(state);
      request = transport.request(target, {
        // The DNS result is deliberately pinned for this exact request. Reusing
        // a global Agent socket could silently keep the route that existed
        // before a TUN/VPN switch and would bypass the fresh lookup/fallback.
        agent: false,
        method: requestOptions.method || 'GET',
        headers,
        lookup(_hostname, lookupOptions, callback) {
          if (lookupOptions?.all) {
            callback(null, [{ address: pinned.address, family: pinned.family }]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        },
      }, (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        pendingResponse = response;
        clearConnectTimer();
        response.once('error', fail);
        response.once('aborted', responseAborted);
        if (requestOptions.requireBodyCompletion && !bodyQueued) {
          const error = remoteMediaError(
            'upload_incomplete',
            '远程上传地址在请求体发送完毕前返回响应，已拒绝将其视为成功。',
            { status: Number(response.statusCode || 0) },
          );
          request.destroy();
          fail(error);
          return;
        }
        maybeResolve();
      });
      request.once('socket', (socket) => {
        requestSocket = socket;
        if (!socket.connecting) {
          clearConnectTimer();
          return;
        }
        connectedEvent = target.protocol === 'https:' ? 'secureConnect' : 'connect';
        socket.once(connectedEvent, clearConnectTimer);
        const connectTimeoutMs = Math.max(
          1,
          Math.min(state.connectTimeoutMs, remainingDeadlineMs(state)),
        );
        connectTimer = setTimeout(() => request.destroy(remoteMediaError(
          'connect_timeout',
          `连接远程地址 ${pinned.family === 6 ? 'IPv6' : 'IPv4'} 超时，正在尝试其他可用地址。`,
        )), connectTimeoutMs);
      });
      request.setTimeout(state.idleTimeoutMs, () => request.destroy(fetchTimeoutError('idle')));
      deadlineTimer = setTimeout(() => request.destroy(fetchTimeoutError('deadline')), remaining);
      request.on('error', fail);
      if (state.signal) {
        abortListener = () => {
          const error = transferAbortError(state.signal);
          if (pendingResponse) pendingResponse.destroy(error);
          request.destroy(error);
        };
        state.signal.addEventListener('abort', abortListener, { once: true });
        if (state.signal.aborted) abortListener();
      }
      const bodyParts = Array.isArray(requestOptions.bodyParts) ? requestOptions.bodyParts : [];
      if (bodyParts.length || requestOptions.requireBodyCompletion) {
        void writeRequestParts(request, bodyParts, () => { bodyQueued = true; })
          .then(() => {
            bodyCompleted = true;
            maybeResolve();
          })
          .catch((error) => {
            request.destroy();
            fail(error);
          });
      }
      else request.end();
    } catch (error) {
      if (request) request.destroy();
      fail(error);
    }
  });
}

async function issuePinnedCandidates(target, candidates, headers, state) {
  let lastError = null;
  for (const pinned of candidates) {
    try {
      return await issuePinnedRequest(target, pinned, headers, state);
    } catch (error) {
      lastError = error;
      if (remainingDeadlineMs(state) <= 1) break;
    }
  }
  throw lastError || remoteMediaError('remote_connect_failed', '无法连接远程素材地址。');
}

async function openSafeRemoteResponse(inputUrl, options, state, initialRedirectCount = 0) {
  let currentUrl = inputUrl;
  let previousTarget = null;
  // Once a redirect crosses an origin boundary, credentials must stay stripped
  // for the rest of the chain. Rebuilding headers from the caller's original
  // options on a later same-origin hop would otherwise resurrect them.
  let sensitiveHeadersAllowed = true;
  let redirectCount = Math.max(0, Math.trunc(Number(initialRedirectCount)) || 0);
  while (true) {
    const target = parseRemoteUrl(currentUrl, options);
    if (previousTarget && previousTarget.origin !== target.origin) sensitiveHeadersAllowed = false;
    const privateTestSetting = options.allowPrivateForTests;
    const trustedProviderHostname = options.trustedProviderOutput === true;
    if (trustedProviderHostname && trustedSystemHostnameBlocked(target.hostname, privateTestSetting)) {
      throw remoteMediaError('private_address', 'Provider 结果地址使用了字面量本机、内网或本地域名，已拒绝访问。');
    }
    let pinnedCandidates = await withinDeadline(
      resolvePublicAddresses(
        target.hostname,
        options.lookupImpl || dns.lookup,
        trustedProviderHostname ? true : privateTestSetting,
        options.publicLookupImpl || resolveTunPublicDns,
        options.acceptTunFake !== false,
      ),
      state,
    );
    let response;
    try {
      response = await issuePinnedCandidates(
        target,
        pinnedCandidates,
        requestHeaders(options, sensitiveHeadersAllowed),
        state,
      );
    } catch (error) {
      if (!pinnedCandidates.some((candidate) => candidate.tunFake)) throw error;
      // TUN may have been disabled after the task was submitted or may not own
      // this Fake-IP anymore. Resolve the same hostname independently and retry
      // only this idempotent download; the generation request is never replayed.
      pinnedCandidates = await withinDeadline(
        resolvePublicAddresses(
          target.hostname,
          async (name) => (options.publicLookupImpl || resolveTunPublicDns)(name),
          privateTestSetting,
          options.publicLookupImpl || resolveTunPublicDns,
          false,
        ),
        state,
      );
      response = await issuePinnedCandidates(
        target,
        pinnedCandidates,
        requestHeaders(options, sensitiveHeadersAllowed),
        state,
      );
    }
    const status = Number(response.statusCode || 0);
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      response.destroy();
      if (redirectCount >= state.maxRedirects) {
        throw remoteMediaError('too_many_redirects', '远程资源重定向次数过多。');
      }
      let nextUrl;
      try { nextUrl = new URL(String(response.headers.location), target).toString(); } catch (_) {
        throw remoteMediaError('invalid_redirect', '远程资源重定向地址无效。');
      }
      redirectCount += 1;
      previousTarget = target;
      currentUrl = nextUrl;
      continue;
    }
    if (!options.allowHttpErrors && (status < 200 || status >= 300)) {
      response.resume();
      response.destroy();
      throw remoteMediaError('remote_http_error', `远程资源返回 HTTP ${status}。`, { status });
    }
    return { response, status, target };
  }
}

function isPrematureResponseError(error, response) {
  if (error?.code) {
    return error.code === 'ECONNRESET'
      || error.code === 'ERR_STREAM_PREMATURE_CLOSE'
      || error.code === 'HPE_INVALID_EOF_STATE';
  }
  return response.aborted === true || error?.message === 'aborted';
}

async function consumeResponse(response, state, onChunk) {
  throwIfTransferAborted(state);
  // Content-Length is advisory only. VPNs, transparent proxies and Chromium's
  // decoding layer may preserve an upstream encoded length while exposing a
  // decoded body. Acceptance is therefore based on the bytes actually read;
  // callers still enforce media signatures/decodability after this transport.
  const hasDeclaredLength = response.headers['content-length'] !== undefined;
  const remaining = remainingDeadlineMs(state);
  const deadlineTimer = setTimeout(() => response.destroy(fetchTimeoutError('deadline')), remaining);
  if (response.socket) {
    response.setTimeout(state.idleTimeoutMs, () => response.destroy(fetchTimeoutError('idle')));
  }
  let total = 0;
  let abortListener;
  if (state.signal) {
    abortListener = () => response.destroy(transferAbortError(state.signal));
    state.signal.addEventListener('abort', abortListener, { once: true });
    if (state.signal.aborted) abortListener();
  }
  try {
    for await (const value of response) {
      throwIfTransferAborted(state);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (total + chunk.length > state.maxBytes) {
        const error = remoteMediaError('item_too_large', `远程资源超过 ${state.maxBytes} bytes 限制。`);
        response.destroy(error);
        throw error;
      }
      await onChunk(chunk);
      total += chunk.length;
    }
    return total;
  } catch (error) {
    if (hasDeclaredLength && total > 0 && isPrematureResponseError(error, response)) {
      return total;
    }
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    if (response.socket) response.setTimeout(0);
    if (!response.complete) response.destroy();
    if (abortListener && state.signal) state.signal.removeEventListener('abort', abortListener);
  }
}

async function consumeResponseBuffer(response, state) {
  const chunks = [];
  const byteLength = await consumeResponse(response, state, async (chunk) => { chunks.push(chunk); });
  return Buffer.concat(chunks, byteLength);
}

function createTransferState(options) {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const deadlineMs = positiveInteger(options.deadlineMs, timeoutMs);
  const state = {
    deadlineAt: Date.now() + deadlineMs,
    connectTimeoutMs: positiveInteger(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS),
    idleTimeoutMs: positiveInteger(options.idleTimeoutMs, timeoutMs),
    maxBytes: positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES),
    maxRedirects: nonNegativeInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS),
    signal: options.signal || null,
  };
  throwIfTransferAborted(state);
  return state;
}

function systemFetchBridgeMetadata() {
  const candidate = globalThis.fetch;
  if (typeof candidate !== 'function') return null;
  return candidate[Symbol.for('t8-penguin-canvas.system-fetch-bridge.v1')] || null;
}

function hasSystemFetchBridge() {
  return Boolean(systemFetchBridgeMetadata());
}

function systemFetchFallbackAllowed(error) {
  if (error?.name === 'AbortError' || error?.code === 'request_aborted') return false;
  const code = String(error?.code || '').toUpperCase();
  const causeCode = String(error?.causeCode || error?.cause?.code || '').toUpperCase();
  const status = Number(error?.status || 0);
  if (code === 'REMOTE_HTTP_ERROR') {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  return new Set([
    'SYSTEM_NETWORK_FETCH_FAILED',
    'CONNECT_TIMEOUT',
    'FETCH_TIMEOUT',
    'REMOTE_RESPONSE_ABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
  ]).has(code) || new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
  ]).has(causeCode);
}

function trustedProviderFallbackState(options, primaryState) {
  const fallbackDeadlineMs = Number(options.trustedProviderFallbackDeadlineMs);
  if (!Number.isFinite(fallbackDeadlineMs) || fallbackDeadlineMs <= 0) {
    remainingDeadlineMs(primaryState);
    return primaryState;
  }
  // A trusted completed-result download may first follow Chromium's system
  // proxy/TUN route and then recover through the independently DNS-pinned
  // transport.  Giving the recovery route its own explicit budget prevents a
  // stalled system route from consuming the fallback before it can even open.
  // This option is deliberately opt-in so ordinary remote fetch callers keep
  // the historical single absolute deadline.
  return createTransferState({
    ...options,
    deadlineMs: fallbackDeadlineMs,
  });
}

function systemFetchNetworkError(error) {
  if (error?.name === 'AbortError' || error?.code === 'request_aborted') return error;
  if (error?.code && error.code !== 'ABORT_ERR' && error.code !== 'ERR_ABORTED') return error;
  const causeCode = String(error?.cause?.code || error?.code || '').trim();
  return remoteMediaError(
    'system_network_fetch_failed',
    '系统网络通道读取 Provider 结果失败，正在尝试安全直连回退。',
    { cause: error, causeCode },
  );
}

function trustedSystemHostnameBlocked(hostname, allowPrivateForTests) {
  const normalizedHostname = normalizeAddress(hostname);
  const bypass = privateAddressAllowedForTests(allowPrivateForTests, normalizedHostname);
  if (!normalizedHostname) return true;
  if (net.isIP(normalizedHostname)) return !bypass && isPrivateAddress(normalizedHostname);
  if (bypass) return false;
  const withoutTrailingDot = normalizedHostname.replace(/\.+$/, '');
  return withoutTrailingDot === 'localhost'
    || !withoutTrailingDot.includes('.')
    || withoutTrailingDot.endsWith('.localhost')
    || withoutTrailingDot.endsWith('.local')
    || withoutTrailingDot.endsWith('.internal')
    || withoutTrailingDot.endsWith('.home.arpa');
}

async function validateTrustedSystemTarget(target, options) {
  if (trustedSystemHostnameBlocked(target.hostname, options.allowPrivateForTests)) {
    throw remoteMediaError('private_address', 'Provider 结果地址使用了字面量本机、内网或本地域名，已拒绝访问。');
  }
  // This URL came from a Provider result/status contract, not from the generic
  // user URL fetcher. Chromium must own DNS, PAC, system proxy, TUN and VPN
  // routing end-to-end. Pre-classifying resolveHost endpoints recreates the
  // exact false-positive whenever a proxy adopts a new synthetic IPv4/IPv6
  // range, so hostname targets deliberately skip all resolved-address checks.
}

async function openTrustedSystemResponse(target, options, state, sensitiveHeadersAllowed) {
  throwIfTransferAborted(state);
  const controller = new AbortController();
  const connectTimeoutMs = Math.max(
    1,
    Math.min(state.connectTimeoutMs, remainingDeadlineMs(state)),
  );
  let timeoutError = null;
  let abortListener;
  const timer = setTimeout(() => {
    timeoutError = remoteMediaError(
      'connect_timeout',
      '通过系统代理、TUN 或 VPN 连接 Provider 结果地址超时。',
    );
    controller.abort(timeoutError);
  }, connectTimeoutMs);
  if (state.signal) {
    abortListener = () => controller.abort(transferAbortError(state.signal));
    state.signal.addEventListener('abort', abortListener, { once: true });
    if (state.signal.aborted) abortListener();
  }
  try {
    const response = await globalThis.fetch(target.toString(), {
      method: 'GET',
      headers: requestHeaders(options, sensitiveHeadersAllowed),
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
    });
    return { controller, response };
  } catch (error) {
    controller.abort();
    throwIfTransferAborted(state);
    throw timeoutError || systemFetchNetworkError(error);
  } finally {
    clearTimeout(timer);
    if (abortListener && state.signal) state.signal.removeEventListener('abort', abortListener);
  }
}

function systemResponseHeader(response, name) {
  const headers = response?.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  return String(headers[String(name).toLowerCase()] || headers[name] || '');
}

async function consumeTrustedSystemResponse(response, controller, state) {
  throwIfTransferAborted(state);
  if (!response.body || typeof response.body.getReader !== 'function') {
    controller.abort();
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let completed = false;
  let abortListener;
  if (state.signal) {
    abortListener = () => controller.abort(transferAbortError(state.signal));
    state.signal.addEventListener('abort', abortListener, { once: true });
    if (state.signal.aborted) abortListener();
  }
  try {
    while (true) {
      throwIfTransferAborted(state);
      const remaining = remainingDeadlineMs(state);
      const waitMs = Math.max(1, Math.min(remaining, state.idleTimeoutMs));
      const timeoutKind = remaining <= state.idleTimeoutMs ? 'deadline' : 'idle';
      let timer;
      let timeoutError = null;
      const next = reader.read();
      const result = await Promise.race([
        next,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timeoutError = fetchTimeoutError(timeoutKind);
            controller.abort(timeoutError);
            reject(timeoutError);
          }, waitMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (result.done) {
        completed = true;
        break;
      }
      const chunk = Buffer.from(result.value || []);
      if (total + chunk.length > state.maxBytes) {
        throw remoteMediaError('item_too_large', `远程资源超过 ${state.maxBytes} bytes 限制。`);
      }
      chunks.push(chunk);
      total += chunk.length;
      if (timeoutError) throw timeoutError;
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    throwIfTransferAborted(state);
    throw systemFetchNetworkError(error);
  } finally {
    if (!completed) {
      try { await reader.cancel(); } catch (_) {}
    }
    controller.abort();
    if (abortListener && state.signal) state.signal.removeEventListener('abort', abortListener);
  }
}

async function consumeTrustedSystemResponseToFile(response, controller, state, handle) {
  throwIfTransferAborted(state);
  let reader = null;
  let total = 0;
  let completed = false;
  let abortListener;
  if (state.signal) {
    abortListener = () => controller.abort(transferAbortError(state.signal));
    state.signal.addEventListener('abort', abortListener, { once: true });
    if (state.signal.aborted) abortListener();
  }
  try {
    if (!response.body || typeof response.body.getReader !== 'function') {
      completed = true;
      return 0;
    }
    reader = response.body.getReader();
    while (true) {
      throwIfTransferAborted(state);
      const remaining = remainingDeadlineMs(state);
      const waitMs = Math.max(1, Math.min(remaining, state.idleTimeoutMs));
      const timeoutKind = remaining <= state.idleTimeoutMs ? 'deadline' : 'idle';
      let timer;
      let timeoutError = null;
      const next = reader.read();
      const result = await Promise.race([
        next,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timeoutError = fetchTimeoutError(timeoutKind);
            controller.abort(timeoutError);
            reject(timeoutError);
          }, waitMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (result.done) {
        completed = true;
        break;
      }
      const chunk = Buffer.from(result.value || []);
      if (total + chunk.length > state.maxBytes) {
        throw remoteMediaError('item_too_large', `远程资源超过 ${state.maxBytes} bytes 限制。`);
      }
      await writeWholeChunk(handle, chunk, total);
      total += chunk.length;
      if (timeoutError) throw timeoutError;
    }
    return total;
  } catch (error) {
    throwIfTransferAborted(state);
    throw systemFetchNetworkError(error);
  } finally {
    if (reader && !completed) {
      try { await reader.cancel(); } catch (_) {}
    }
    controller.abort();
    if (abortListener && state.signal) state.signal.removeEventListener('abort', abortListener);
  }
}

async function downloadTrustedProviderOutputToFile(
  inputUrl,
  options,
  state,
  handle,
  initialRedirectCount = 0,
) {
  let currentUrl = inputUrl;
  let previousTarget = null;
  let sensitiveHeadersAllowed = true;
  let redirectCount = Math.max(0, Math.trunc(Number(initialRedirectCount)) || 0);
  while (true) {
    const target = parseRemoteUrl(currentUrl, options);
    if (previousTarget && previousTarget.origin !== target.origin) sensitiveHeadersAllowed = false;
    await validateTrustedSystemTarget(target, options);
    const { controller, response } = await openTrustedSystemResponse(
      target,
      options,
      state,
      sensitiveHeadersAllowed,
    );
    const status = Number(response.status || 0);
    const location = systemResponseHeader(response, 'location');
    if (status >= 300 && status < 400 && location) {
      try { await response.body?.cancel?.(); } catch (_) {}
      controller.abort();
      if (redirectCount >= state.maxRedirects) {
        throw remoteMediaError('too_many_redirects', '远程资源重定向次数过多。');
      }
      let nextUrl;
      try { nextUrl = new URL(location, target).toString(); } catch (_) {
        throw remoteMediaError('invalid_redirect', '远程资源重定向地址无效。');
      }
      redirectCount += 1;
      previousTarget = target;
      currentUrl = nextUrl;
      continue;
    }
    if (!options.allowHttpErrors && (status < 200 || status >= 300)) {
      try { await response.body?.cancel?.(); } catch (_) {}
      controller.abort();
      throw remoteMediaError('remote_http_error', `远程资源返回 HTTP ${status}。`, { status });
    }
    const byteSize = await consumeTrustedSystemResponseToFile(response, controller, state, handle);
    return {
      contentType: systemResponseHeader(response, 'content-type'),
      finalUrl: target.toString(),
      status,
      byteSize,
    };
  }
}

async function fetchTrustedProviderOutput(inputUrl, options, state, initialRedirectCount = 0) {
  let currentUrl = inputUrl;
  let previousTarget = null;
  let sensitiveHeadersAllowed = true;
  let redirectCount = Math.max(0, Math.trunc(Number(initialRedirectCount)) || 0);
  while (true) {
    const target = parseRemoteUrl(currentUrl, options);
    if (previousTarget && previousTarget.origin !== target.origin) sensitiveHeadersAllowed = false;
    await validateTrustedSystemTarget(target, options);
    const { controller, response } = await openTrustedSystemResponse(
      target,
      options,
      state,
      sensitiveHeadersAllowed,
    );
    const status = Number(response.status || 0);
    const location = systemResponseHeader(response, 'location');
    if (status >= 300 && status < 400 && location) {
      try { await response.body?.cancel?.(); } catch (_) {}
      controller.abort();
      if (redirectCount >= state.maxRedirects) {
        throw remoteMediaError('too_many_redirects', '远程资源重定向次数过多。');
      }
      let nextUrl;
      try { nextUrl = new URL(location, target).toString(); } catch (_) {
        throw remoteMediaError('invalid_redirect', '远程资源重定向地址无效。');
      }
      redirectCount += 1;
      previousTarget = target;
      currentUrl = nextUrl;
      continue;
    }
    if (!options.allowHttpErrors && (status < 200 || status >= 300)) {
      try { await response.body?.cancel?.(); } catch (_) {}
      controller.abort();
      throw remoteMediaError('remote_http_error', `远程资源返回 HTTP ${status}。`, { status });
    }
    const buffer = await consumeTrustedSystemResponse(response, controller, state);
    return {
      buffer,
      contentType: systemResponseHeader(response, 'content-type'),
      finalUrl: target.toString(),
      status,
    };
  }
}
// Tencent documents these two default bucket domains as official equivalents.
// Only the exact HTTPS bucket endpoint is eligible, never arbitrary suffix matches.
function tencentCosResultUrlFallback(value) {
  let target;
  try { target = new URL(String(value)); } catch { return null; }
  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) return null;
  if (!/^[a-z0-9][a-z0-9-]*-\d+\.cos\.[a-z0-9][a-z0-9-]*\.myqcloud\.com$/i.test(target.hostname)) return null;
  target.hostname = target.hostname.replace(/\.myqcloud\.com$/i, '.tencentcos.cn');
  return target.toString();
}

async function safeRemoteMediaFetch(inputUrl, options = {}, redirectCount = 0) {
  try {
    return await safeRemoteMediaFetchOnce(inputUrl, options, redirectCount);
  } catch (error) {
    const fallback = options.trustedProviderOutput === true && !options.signal?.aborted
      && systemFetchFallbackAllowed(error) ? tencentCosResultUrlFallback(inputUrl) : null;
    if (!fallback) throw error;
    // Same completed object, read-only recovery. Cross-origin request credentials
    // remain stripped; preserve the object's original signed path/query verbatim.
    const result = await safeRemoteMediaFetchOnce(fallback, { ...options, headers: requestHeaders(options, false) }, redirectCount);
    return { ...result, providerResultDomainFallback: 'tencent-cos' };
  }
}

async function safeRemoteMediaFetchOnce(inputUrl, options = {}, redirectCount = 0) {
  const normalizedOptions = { ...options, _protocols: allowedProtocols(options.protocols) };
  const state = createTransferState(normalizedOptions);
  let activeState = state;
  if (normalizedOptions.trustedProviderOutput === true && hasSystemFetchBridge()) {
    try {
      return await fetchTrustedProviderOutput(inputUrl, normalizedOptions, state, redirectCount);
    } catch (error) {
      if (!systemFetchFallbackAllowed(error)) throw error;
      activeState = trustedProviderFallbackState(normalizedOptions, state);
    }
  }
  const opened = await openSafeRemoteResponse(inputUrl, normalizedOptions, activeState, redirectCount);
  const buffer = await consumeResponseBuffer(opened.response, activeState);
  return {
    buffer,
    contentType: String(opened.response.headers['content-type'] || ''),
    finalUrl: opened.target.toString(),
    status: opened.status,
  };
}

function assertJsonComplexity(value, options = {}) {
  const maxDepth = positiveInteger(options.maxJsonDepth, DEFAULT_JSON_MAX_DEPTH);
  const maxNodes = positiveInteger(options.maxJsonNodes, DEFAULT_JSON_MAX_NODES);
  let nodes = 1;
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.value === null || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    if (current.depth > maxDepth) {
      throw remoteMediaError('json_too_complex', `远程 JSON 深度超过 ${maxDepth} 层限制。`);
    }
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    if (nodes + children.length > maxNodes) {
      throw remoteMediaError('json_too_complex', `远程 JSON 节点超过 ${maxNodes} 个限制。`);
    }
    nodes += children.length;
    for (const child of children) {
      if (child !== null && typeof child === 'object') {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return value;
}

/**
 * Fetch bounded JSON through the same redirect-revalidated transport.
 * Non-2xx responses are intentionally returned with their original status so
 * queue APIs can interpret bounded error/pending JSON. Authenticated Provider
 * status/result URLs may opt into Electron's system proxy/TUN-aware transport.
 */
async function safeRemoteJsonFetch(inputUrl, options = {}) {
  const normalizedOptions = {
    ...options,
    allowHttpErrors: true,
    maxBytes: positiveInteger(options.maxBytes, DEFAULT_JSON_MAX_BYTES),
    _protocols: allowedProtocols(options.protocols),
  };
  const fetched = await safeRemoteMediaFetch(inputUrl, normalizedOptions);
  const { buffer, status } = fetched;
  const text = buffer.toString('utf8').trim();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw remoteMediaError('invalid_json_response', '远程服务返回的内容不是有效 JSON。', { status });
    }
    assertJsonComplexity(data, normalizedOptions);
  }
  return {
    data,
    contentType: String(fetched.contentType || ''),
    finalUrl: fetched.finalUrl,
    ok: status >= 200 && status < 300,
    status,
  };
}

function normalizedBodyParts(value) {
  const source = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
  const parts = [];
  let byteLength = 0;
  for (const item of source) {
    const part = Buffer.isBuffer(item)
      ? item
      : (item instanceof Uint8Array ? Buffer.from(item.buffer, item.byteOffset, item.byteLength) : Buffer.from(String(item)));
    byteLength += part.length;
    if (!Number.isSafeInteger(byteLength)) throw remoteMediaError('upload_too_large', '上传请求体大小无效。');
    parts.push(part);
  }
  return { parts, byteLength };
}

/**
 * Send a request body only to a DNS-pinned globally-routable URL. Redirects are
 * never followed because replaying an upload body to a Provider-controlled
 * Location would create an SSRF primitive. The response body is still bounded.
 */
async function safeRemoteUpload(inputUrl, options = {}) {
  const method = String(options.method || 'PUT').trim().toUpperCase();
  if (method !== 'PUT' && method !== 'POST') {
    throw remoteMediaError('invalid_method', '远程上传只允许 POST 或 PUT。');
  }
  const normalizedOptions = { ...options, _protocols: allowedProtocols(options.protocols) };
  const target = parseRemoteUrl(inputUrl, normalizedOptions);
  const responseMaxBytes = positiveInteger(options.maxResponseBytes, DEFAULT_UPLOAD_RESPONSE_MAX_BYTES);
  const state = createTransferState({ ...normalizedOptions, maxBytes: responseMaxBytes, maxRedirects: 0 });
  const pinned = await withinDeadline(
    resolvePublicAddress(
      target.hostname,
      options.lookupImpl || dns.lookup,
      options.allowPrivateForTests,
      options.publicLookupImpl || resolveTunPublicDns,
      options.acceptTunFake !== false,
    ),
    state,
  );
  const body = normalizedBodyParts(options.bodyParts ?? options.body);
  const maxRequestBytes = positiveInteger(options.maxRequestBytes, 64 * 1024 * 1024);
  if (body.byteLength > maxRequestBytes) {
    throw remoteMediaError('upload_too_large', `上传请求体超过 ${maxRequestBytes} bytes 限制。`);
  }
  const headers = requestHeaders(normalizedOptions, true);
  headers['content-length'] = String(body.byteLength);
  const response = await issuePinnedRequest(target, pinned, headers, state, {
    method,
    bodyParts: body.parts,
    requireBodyCompletion: true,
  });
  const status = Number(response.statusCode || 0);
  const buffer = await consumeResponseBuffer(response, state);
  if (status >= 300 && status < 400) {
    throw remoteMediaError('upload_redirect_forbidden', '远程上传地址返回重定向，已拒绝重放请求体。', { status });
  }
  return {
    buffer,
    contentType: String(response.headers['content-type'] || ''),
    finalUrl: target.toString(),
    ok: status >= 200 && status < 300,
    status,
  };
}

async function openExclusiveDownloadTarget(targetPath) {
  const raw = String(targetPath || '');
  if (!raw || raw.includes('\0')) throw remoteMediaError('download_target_invalid', '下载目标路径无效。');
  const absolutePath = path.resolve(raw);
  let handle;
  let identity;
  try {
    handle = await fs.promises.open(absolutePath, 'wx', 0o600);
    identity = await handle.stat();
    await handle.chmod(0o600);
    return { absolutePath, handle, identity };
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch (_) {}
      try { await removeCreatedDownloadTarget(absolutePath, identity); } catch (_) {}
    }
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      throw remoteMediaError('download_target_exists', '下载目标已存在或是符号链接，拒绝覆盖。');
    }
    throw remoteMediaError('download_target_open_failed', '无法安全创建下载目标。', { cause: error });
  }
}

async function removeCreatedDownloadTarget(absolutePath, identity) {
  try {
    const current = await fs.promises.lstat(absolutePath);
    if (current.isSymbolicLink()) return;
    if (identity && (current.dev !== identity.dev || current.ino !== identity.ino)) return;
    await fs.promises.unlink(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeWholeChunk(handle, chunk, position = null) {
  let offset = 0;
  while (offset < chunk.length) {
    const writePosition = position === null ? null : position + offset;
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, writePosition);
    if (!bytesWritten) throw remoteMediaError('download_write_failed', '远程资源写入未取得进展。');
    offset += bytesWritten;
  }
}

/**
 * Stream a DNS-pinned remote HTTP(S) response into a new caller-controlled file.
 *
 * Relevant options:
 *   protocols: ['https:'] (defaults to ['http:', 'https:'])
 *   maxBytes, maxRedirects, deadlineMs (absolute transfer budget), idleTimeoutMs
 *   accept, userAgent, headers, lookupImpl
 *   trustedProviderOutput: true prefers Electron/Chromium system networking
 *   trustedProviderFallbackDeadlineMs: optional independent DNS-pinned recovery budget
 *
 * The target is opened with wx/0600 and is removed on every unsuccessful exit.
 * Resolves to { contentType, finalUrl, status, byteSize } without buffering the body.
 */
async function safeRemoteMediaDownload(inputUrl, targetPath, options = {}) {
  const normalizedOptions = { ...options, _protocols: allowedProtocols(options.protocols) };
  // Validate URL/protocol/userinfo before reserving a filesystem target.
  parseRemoteUrl(inputUrl, normalizedOptions);
  const state = createTransferState(normalizedOptions);
  let activeState = state;
  throwIfTransferAborted(state);
  const target = await openExclusiveDownloadTarget(targetPath);
  let response = null;
  let closed = false;
  try {
    throwIfTransferAborted(state);
    if (normalizedOptions.trustedProviderOutput === true && hasSystemFetchBridge()) {
      try {
        const downloaded = await downloadTrustedProviderOutputToFile(
          inputUrl,
          normalizedOptions,
          state,
          target.handle,
        );
        await target.handle.sync();
        throwIfTransferAborted(state);
        await target.handle.close();
        closed = true;
        return downloaded;
      } catch (error) {
        if (!systemFetchFallbackAllowed(error)) throw error;
        activeState = trustedProviderFallbackState(normalizedOptions, state);
        // System-network chunks use explicit positions, so truncation leaves
        // the descriptor ready for a clean DNS-pinned fallback from byte 0.
        await target.handle.truncate(0);
      }
    }
    const opened = await openSafeRemoteResponse(inputUrl, normalizedOptions, activeState);
    response = opened.response;
    const byteSize = await consumeResponse(response, activeState, (chunk) => writeWholeChunk(target.handle, chunk));
    await target.handle.sync();
    throwIfTransferAborted(activeState);
    await target.handle.close();
    closed = true;
    return {
      contentType: String(response.headers['content-type'] || ''),
      finalUrl: opened.target.toString(),
      status: opened.status,
      byteSize,
    };
  } catch (error) {
    if (response) response.destroy();
    if (!closed) {
      try { await target.handle.close(); } catch (_) {}
      closed = true;
    }
    try {
      await removeCreatedDownloadTarget(target.absolutePath, target.identity);
    } catch (cleanupError) {
      if (error && typeof error === 'object') error.cleanupError = cleanupError;
    }
    throw error;
  } finally {
    if (!closed) {
      try { await target.handle.close(); } catch (_) {}
    }
  }
}

module.exports = {
  assertJsonComplexity,
  isLoopbackAddress,
  isPrivateAddress,
  isTunFakeAddress,
  normalizeAddress,
  resolvePublicAddress,
  resolveTunPublicDns,
  safeRemoteMediaDownload,
  safeRemoteMediaFetch,
  safeRemoteJsonFetch,
  safeRemoteUpload,
  tencentCosResultUrlFallback,
};
