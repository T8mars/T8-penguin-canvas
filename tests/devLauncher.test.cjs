'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { waitForLocalService } = require('../scripts/wait-for-local-service.cjs');

test('development launcher waits for backend before frontend and browser', () => {
  const launcherPath = path.join(__dirname, '..', 'start-dev.bat');
  const launcherBytes = fs.readFileSync(launcherPath);
  const launcher = launcherBytes.toString('utf8');
  const cleanup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'stop-local-dev-processes.ps1'), 'utf8');
  const newlineCount = (launcher.match(/\n/g) || []).length;
  const windowsNewlineCount = (launcher.match(/\r\n/g) || []).length;
  const backendWait = launcher.indexOf('18766/api/status');
  const backendCommand = 'start "T8 Backend" cmd /d /k "chcp 65001 >nul && npm run dev:backend"';
  const frontendCommand = 'start "T8 Frontend" cmd /d /k "chcp 65001 >nul && npm run dev:vite"';
  const backendStart = launcher.indexOf(backendCommand);
  const frontendStart = launcher.indexOf(frontendCommand);
  const frontendWait = launcher.indexOf('127.0.0.1:11422/');
  const browserOpen = launcher.lastIndexOf('start "" "http://127.0.0.1:11422"');

  assert.ok(backendStart >= 0);
  assert.ok(backendStart < backendWait);
  assert.ok(backendWait >= 0);
  assert.ok(backendWait < frontendStart);
  assert.ok(frontendStart < frontendWait);
  assert.ok(frontendWait < browserOpen);
  assert.doesNotMatch(launcher, /cd backend && npm run dev/);
  assert.equal((launcher.match(/cmd \/d \/k "chcp 65001 >nul && npm run dev:/g) || []).length, 2);
  assert.match(backendCommand, /chcp 65001 >nul && npm run dev:backend/);
  assert.match(frontendCommand, /chcp 65001 >nul && npm run dev:vite/);
  assert.doesNotMatch(launcher, /timeout \/t [23] >nul/);
  assert.doesNotMatch(launcher, /netstat\s+-ano/);
  assert.match(launcher, /stop-local-dev-processes\.ps1/);
  assert.match(launcher, /-ProjectRoot "%~dp0\."/);
  assert.match(cleanup, /Get-NetTCPConnection -State Listen -LocalPort \$ports/);
  assert.match(cleanup, /\$owner -gt 0/);
  assert.match(cleanup, /taskkill\.exe \/F \/T \/PID \$rootId/);
  assert.match(cleanup, /Test-ProjectDevSeed/);
  assert.match(cleanup, /Test-LauncherShell/);
  assert.equal(
    windowsNewlineCount,
    newlineCount,
    'start-dev.bat must use CRLF consistently because cmd.exe can concatenate bare-LF commands',
  );
});

test('development cleanup script resolves its project root after parameter binding', { skip: process.platform !== 'win32' }, () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'stop-local-dev-processes.ps1');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-PortList', '65534,65535'],
    { encoding: 'utf8', timeout: 15_000 },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Cannot bind argument to parameter 'Path'/i);
});

test('development backend uses the Electron ABI owner and watches source dependencies', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const backendPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backend', 'package.json'), 'utf8'));
  const rootStart = rootPackage.scripts?.['start:backend'] || '';
  const rootDev = rootPackage.scripts?.['dev:backend'] || '';

  assert.match(rootStart, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(rootStart, /\belectron\b/);
  assert.match(rootStart, /backend\/src\/server\.js\b/);
  assert.doesNotMatch(rootStart, /\bnode\s+backend\/src\/server\.js\b/);

  assert.match(rootDev, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(rootDev, /\belectron\b/);
  assert.match(rootDev, /--watch\b/);
  assert.match(rootDev, /--watch-path=backend\/src\b/);
  assert.match(rootDev, /--watch-preserve-output\b/);
  assert.match(rootDev, /backend\/src\/server\.js\b/);
  assert.doesNotMatch(rootDev, /\bnode\s+--watch\b/);

  assert.equal(backendPackage.scripts?.start, 'npm --prefix .. run start:backend');
  assert.equal(backendPackage.scripts?.dev, 'npm --prefix .. run dev:backend');
});

test('local service waiter tolerates startup refusal/status errors until service is ready', async (t) => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.statusCode = requests < 3 ? 503 : 200;
    response.end(requests < 3 ? 'starting' : 'ready');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const result = await waitForLocalService({
    url: `http://127.0.0.1:${address.port}/status`,
    timeoutMs: 2_000,
    intervalMs: 10,
    requestTimeoutMs: 200,
    label: '测试服务',
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.attempts, 3);
});
