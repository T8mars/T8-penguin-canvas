'use strict';

const crypto = require('node:crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function encodeQuery(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(query = {}) {
  return Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null)
    .sort()
    .map((key) => `${encodeQuery(key)}=${encodeQuery(query[key])}`)
    .join('&');
}

function signRequest(options) {
  const {
    accessKeyId,
    secretAccessKey,
    region = 'cn-beijing',
    service = 'ark',
    method = 'POST',
    host = 'open.volcengineapi.com',
    uri = '/',
    query = {},
    body = '',
    now = new Date(),
  } = options;
  if (!accessKeyId || !secretAccessKey) throw new Error('火山资产 API 缺少 AK/SK');

  const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256(body);
  const contentType = 'application/json; charset=UTF-8';
  const canonicalHeaders = `host:${host}\nx-content-sha256:${payloadHash}\nx-date:${xDate}\n`;
  const signedHeaders = 'host;x-content-sha256;x-date';
  const canonicalRequest = [
    method.toUpperCase(),
    uri,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(secretAccessKey, shortDate), region), service), 'request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  const authorization = `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': contentType,
    Host: host,
    'X-Content-Sha256': payloadHash,
    'X-Date': xDate,
    Authorization: authorization,
  };
}

module.exports = { signRequest };
