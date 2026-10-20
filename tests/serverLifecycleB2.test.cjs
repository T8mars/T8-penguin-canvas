'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.T8_FIGMA_BRIDGE_AUTOSTART = '0';
process.env.T8_COLLAB_MANAGEMENT_TOKEN = 'B'.repeat(43);

function cannotConnect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('closed backend port still accepted or hung a connection'));
    }, 1_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error('closed backend port accepted a connection'));
    });
    socket.once('error', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function runLifecycleProbe(source, timeout = 15_000) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      T8_FIGMA_BRIDGE_AUTOSTART: '0',
      T8_COLLAB_MANAGEMENT_TOKEN: 'C'.repeat(43),
    },
  });
  assert.equal(
    result.status,
    0,
    `lifecycle probe failed\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`,
  );
  const line = String(result.stdout || '').split(/\r?\n/).find((entry) => entry.startsWith('T8_LIFECYCLE_RESULT='));
  assert.ok(line, `lifecycle probe did not return a result\nstdout:\n${result.stdout || ''}`);
  return JSON.parse(line.slice('T8_LIFECYCLE_RESULT='.length));
}

function isolatedServerPrelude() {
  return `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
process.env.T8_FIGMA_BRIDGE_AUTOSTART = '0';
process.env.T8_COLLAB_MANAGEMENT_TOKEN = 'D'.repeat(43);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-server-lifecycle-probe-'));
const config = require('./backend/src/config');
Object.assign(config, {
  HOST: '127.0.0.1',
  PORT: 0,
  HTTP_SHUTDOWN_TIMEOUT_MS: 150,
  DATA_DIR: path.join(root, 'data'),
  INPUT_DIR: path.join(root, 'input'),
  OUTPUT_DIR: path.join(root, 'output'),
  THUMBNAILS_DIR: path.join(root, 'thumbnails'),
  ASSET_PREVIEWS_DIR: path.join(root, 'thumbnails', 'asset-previews'),
  ASSET_BLOB_DIR: path.join(root, 'data', 'asset-blobs'),
  COLLAB_UPLOAD_TEMP_DIR: path.join(root, 'data', 'collaboration-uploads'),
  PROJECT_DB_FILE: path.join(root, 'data', 'projects.sqlite3'),
  PROJECT_DB_BACKUP_FILE: path.join(root, 'data', 'projects.sqlite3.backup'),
});
for (const directory of [config.DATA_DIR, config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR]) {
  fs.mkdirSync(directory, { recursive: true });
}
`;
}

test('graceful shutdown during the listen startup window closes the server before storage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-server-lifecycle-b2-'));
  const config = require('../backend/src/config');
  Object.assign(config, {
    HOST: '127.0.0.1',
    PORT: 0,
    DATA_DIR: path.join(root, 'data'),
    INPUT_DIR: path.join(root, 'input'),
    OUTPUT_DIR: path.join(root, 'output'),
    THUMBNAILS_DIR: path.join(root, 'thumbnails'),
    ASSET_PREVIEWS_DIR: path.join(root, 'thumbnails', 'asset-previews'),
    ASSET_BLOB_DIR: path.join(root, 'data', 'asset-blobs'),
    COLLAB_UPLOAD_TEMP_DIR: path.join(root, 'data', 'collaboration-uploads'),
    PROJECT_DB_FILE: path.join(root, 'data', 'projects.sqlite3'),
    PROJECT_DB_BACKUP_FILE: path.join(root, 'data', 'projects.sqlite3.backup'),
  });
  for (const directory of [config.DATA_DIR, config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const backend = require('../backend/src/server');
  let boundPort = null;
  backend.server.once('listening', () => { boundPort = backend.server.address()?.port || null; });
  try {
    const stages = [];
    const first = backend.gracefulShutdown('TEST', { onProgress: phase => stages.push(phase) });
    const second = backend.gracefulShutdown();
    assert.strictEqual(second, first, 'concurrent shutdown callers must share one lifecycle promise');
    await first;
    assert.equal(backend.server.listening, false);
    assert.equal(backend.server.address(), null);
    if (boundPort) await cannotConnect(boundPort);
    await backend.gracefulShutdown();
    await backend.waitForRuntimeStorageCloseLifecycle();
    assert.ok(stages.indexOf('http-drain') < stages.indexOf('database-close'));
    assert.ok(stages.includes('deferred-drain'));
  } finally {
    if (backend.server.listening) {
      backend.server.closeAllConnections?.();
      await new Promise((resolve) => backend.server.close(() => resolve()));
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('listen EADDRINUSE is propagated through the exported startup outcome', () => {
  const result = runLifecycleProbe(`${isolatedServerPrelude()}
(async () => {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  config.PORT = blocker.address().port;
  const backend = require('./backend/src/server');
  const start = await backend.serverStartPromise;
  assert.equal(start.state, 'error');
  assert.equal(start.error?.code, 'EADDRINUSE');
  const shutdown = await backend.gracefulShutdown();
  assert.equal(shutdown.storageClosed, true);
  await new Promise((resolve) => blocker.close(resolve));
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  console.log('T8_LIFECYCLE_RESULT=' + JSON.stringify({ state: start.state, code: start.error.code }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`);
  assert.deepEqual(result, { state: 'error', code: 'EADDRINUSE' });
});

for (const externallyClosed of [false, true]) {
  test(`${externallyClosed ? 'external close-in-progress' : 'bounded close'} defers database close until async request work settles`, () => {
    const result = runLifecycleProbe(`${isolatedServerPrelude()}
(async () => {
  const backend = require('./backend/src/server');
  const start = await backend.serverStartPromise;
  assert.equal(start.state, 'listening');
  assert.match(config.BACKEND_INSTANCE_ID, /^[A-Za-z0-9_-]{43,128}$/);
  const database = require('./backend/src/services/projectDatabase').getProjectDatabase();
  let releaseHandler;
  const handlerGate = new Promise((resolve) => { releaseHandler = resolve; });
  let resolveStarted;
  const handlerStarted = new Promise((resolve) => { resolveStarted = resolve; });
  let resolveFinished;
  const handlerFinished = new Promise((resolve) => { resolveFinished = resolve; });
  let lateDatabaseAccess = null;
  backend.app.get('/__t8-lifecycle-delayed', async (_req, res) => {
    resolveStarted();
    await handlerGate;
    try {
      database.db.prepare('SELECT 1 AS ok').get();
      lateDatabaseAccess = 'ok';
    } catch (error) {
      lateDatabaseAccess = error?.message || String(error);
    }
    try { res.json({ ok: true }); } catch (_) {}
    resolveFinished();
  });
  const port = backend.server.address().port;
  const client = http.get({ host: '127.0.0.1', port, path: '/__t8-lifecycle-delayed' }, (response) => response.resume());
  client.on('error', () => {});
  await handlerStarted;
  if (${externallyClosed ? 'true' : 'false'}) backend.server.close();
  const before = Date.now();
  const shutdown = await backend.gracefulShutdown();
  const elapsedMs = Date.now() - before;
  assert.equal(shutdown.storageDeferred, true);
  assert.equal(shutdown.storageClosed, false);
  assert.equal(shutdown.http.forced, true);
  assert.equal(shutdown.http.drained, false);
  assert.ok(elapsedMs >= 100 && elapsedMs < 2_000, 'shutdown must keep a finite transport deadline');
  assert.equal(database.db.open, true, 'storage must remain open while the detached async handler is active');
  releaseHandler();
  await handlerFinished;
  assert.equal(lateDatabaseAccess, 'ok');
  await backend.waitForRuntimeStorageCloseLifecycle();
  assert.equal(database.db.open, false);
  client.destroy();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  console.log('T8_LIFECYCLE_RESULT=' + JSON.stringify({
    externallyClosed: ${externallyClosed ? 'true' : 'false'},
    elapsedMs,
    lateDatabaseAccess,
    storageClosed: !database.db.open,
  }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`);
    assert.equal(result.externallyClosed, externallyClosed);
    assert.equal(result.lateDatabaseAccess, 'ok');
    assert.equal(result.storageClosed, true);
    assert.ok(result.elapsedMs >= 100 && result.elapsedMs < 2_000);
  });
}

test('callback middleware keeps its request lease across forced close until delayed next dispatches', () => {
  const result = runLifecycleProbe(`${isolatedServerPrelude()}
(async () => {
  const backend = require('./backend/src/server');
  const start = await backend.serverStartPromise;
  assert.equal(start.state, 'listening');
  const database = require('./backend/src/services/projectDatabase').getProjectDatabase();
  let resolveStarted;
  const middlewareStarted = new Promise((resolve) => { resolveStarted = resolve; });
  let resolveFinished;
  const downstreamFinished = new Promise((resolve) => { resolveFinished = resolve; });
  let lateDatabaseAccess = null;
  backend.app.use('/__t8-lifecycle-callback', (_req, _res, next) => {
    resolveStarted();
    setTimeout(next, 350);
  });
  backend.app.get('/__t8-lifecycle-callback', async (_req, res) => {
    try {
      database.db.prepare('SELECT 1 AS ok').get();
      lateDatabaseAccess = 'ok';
    } catch (error) {
      lateDatabaseAccess = error?.message || String(error);
    }
    try { res.json({ ok: true }); } catch (_) {}
    resolveFinished();
  });
  const port = backend.server.address().port;
  const client = http.get({ host: '127.0.0.1', port, path: '/__t8-lifecycle-callback' }, (response) => response.resume());
  client.on('error', () => {});
  await middlewareStarted;
  const shutdown = await backend.gracefulShutdown();
  assert.equal(shutdown.storageDeferred, true);
  assert.equal(shutdown.http.forced, true);
  assert.equal(database.db.open, true);
  await downstreamFinished;
  assert.equal(lateDatabaseAccess, 'ok');
  await backend.waitForRuntimeStorageCloseLifecycle();
  assert.equal(database.db.open, false);
  client.destroy();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  console.log('T8_LIFECYCLE_RESULT=' + JSON.stringify({ lateDatabaseAccess, storageClosed: !database.db.open }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`);
  assert.deepEqual(result, { lateDatabaseAccess: 'ok', storageClosed: true });
});

test('callback handler releases its lease when a delayed response ends after forced close', () => {
  const result = runLifecycleProbe(`${isolatedServerPrelude()}
(async () => {
  const backend = require('./backend/src/server');
  const start = await backend.serverStartPromise;
  assert.equal(start.state, 'listening');
  const database = require('./backend/src/services/projectDatabase').getProjectDatabase();
  let resolveStarted;
  const handlerStarted = new Promise((resolve) => { resolveStarted = resolve; });
  let resolveFinished;
  const handlerFinished = new Promise((resolve) => { resolveFinished = resolve; });
  let lateDatabaseAccess = null;
  backend.app.get('/__t8-lifecycle-callback-response', (_req, res, _next) => {
    resolveStarted();
    setTimeout(() => {
      try {
        database.db.prepare('SELECT 1 AS ok').get();
        lateDatabaseAccess = 'ok';
      } catch (error) {
        lateDatabaseAccess = error?.message || String(error);
      }
      try { res.json({ ok: true }); } catch (_) {}
      resolveFinished();
    }, 350);
  });
  const port = backend.server.address().port;
  const client = http.get({ host: '127.0.0.1', port, path: '/__t8-lifecycle-callback-response' }, (response) => response.resume());
  client.on('error', () => {});
  await handlerStarted;
  const shutdown = await backend.gracefulShutdown();
  assert.equal(shutdown.storageDeferred, true);
  assert.equal(database.db.open, true);
  await handlerFinished;
  assert.equal(lateDatabaseAccess, 'ok');
  await backend.waitForRuntimeStorageCloseLifecycle();
  assert.equal(backend.applicationRequestStatus().activeRequests, 0);
  assert.equal(database.db.open, false);
  client.destroy();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  console.log('T8_LIFECYCLE_RESULT=' + JSON.stringify({ lateDatabaseAccess, storageClosed: !database.db.open }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`);
  assert.deepEqual(result, { lateDatabaseAccess: 'ok', storageClosed: true });
});

test('an explicitly tracked detached task keeps storage open after its response has finished', () => {
  const result = runLifecycleProbe(`${isolatedServerPrelude()}
(async () => {
  const backend = require('./backend/src/server');
  const start = await backend.serverStartPromise;
  assert.equal(start.state, 'listening');
  const database = require('./backend/src/services/projectDatabase').getProjectDatabase();
  let releaseTask;
  const taskGate = new Promise((resolve) => { releaseTask = resolve; });
  let resolveTaskStarted;
  const taskStarted = new Promise((resolve) => { resolveTaskStarted = resolve; });
  let resolveTaskFinished;
  const taskFinished = new Promise((resolve) => { resolveTaskFinished = resolve; });
  let lateDatabaseAccess = null;
  backend.app.get('/__t8-lifecycle-detached-task', (_req, res) => {
    const task = (async () => {
      resolveTaskStarted();
      await taskGate;
      try {
        database.db.prepare('SELECT 1 AS ok').get();
        lateDatabaseAccess = 'ok';
      } catch (error) {
        lateDatabaseAccess = error?.message || String(error);
      }
      resolveTaskFinished();
    })();
    res.locals.trackApplicationTask(task);
    res.json({ ok: true });
  });
  const port = backend.server.address().port;
  await new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/__t8-lifecycle-detached-task' }, (response) => {
      response.resume();
      response.once('end', resolve);
    });
    request.once('error', reject);
  });
  await taskStarted;
  const shutdown = await backend.gracefulShutdown();
  assert.equal(shutdown.storageDeferred, true);
  assert.equal(shutdown.http.drained, false);
  assert.equal(database.db.open, true);
  releaseTask();
  await taskFinished;
  assert.equal(lateDatabaseAccess, 'ok');
  await backend.waitForRuntimeStorageCloseLifecycle();
  assert.equal(database.db.open, false);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  console.log('T8_LIFECYCLE_RESULT=' + JSON.stringify({ lateDatabaseAccess, storageClosed: !database.db.open }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`);
  assert.deepEqual(result, { lateDatabaseAccess: 'ok', storageClosed: true });
});

test('backend shutdown terminally stops the collaboration gateway before shared storage closes', () => {
  const result = runLifecycleProbe(`${isolatedServerPrelude()}
(async () => {
  const backend = require('./backend/src/server');
  const start = await backend.serverStartPromise;
  assert.equal(start.state, 'listening');
  const database = require('./backend/src/services/projectDatabase').getProjectDatabase();
  const gateway = require('./backend/src/collaboration/gateway').getCollaborationGateway(config);
  const started = await gateway.start({ host: '127.0.0.1', port: 0 });
  assert.equal(started.running, true);
  const shutdown = await backend.gracefulShutdown();
  assert.equal(shutdown.storageClosed, true);
  assert.equal(shutdown.storageDeferred, false);
  assert.equal(shutdown.collaboration.applicationRequests.drained, true);
  assert.equal(gateway.managementStatus().running, false);
  assert.equal(database.db.open, false);
  await assert.rejects(
    gateway.start({ host: '127.0.0.1', port: 0 }),
    (error) => error?.code === 'collaboration_gateway_shutting_down',
  );
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  console.log('T8_LIFECYCLE_RESULT=' + JSON.stringify({
    gatewayRunning: gateway.managementStatus().running,
    storageClosed: !database.db.open,
  }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`);
  assert.deepEqual(result, { gatewayRunning: false, storageClosed: true });
});

test('forced collaboration transport close defers shared storage until its async handler settles', () => {
  const result = runLifecycleProbe(`${isolatedServerPrelude()}
(async () => {
  const backend = require('./backend/src/server');
  const start = await backend.serverStartPromise;
  assert.equal(start.state, 'listening');
  const database = require('./backend/src/services/projectDatabase').getProjectDatabase();
  const gateway = require('./backend/src/collaboration/gateway').getCollaborationGateway(config);
  const express = require('express');
  let releaseHandler;
  const handlerGate = new Promise((resolve) => { releaseHandler = resolve; });
  let resolveHandlerStarted;
  const handlerStarted = new Promise((resolve) => { resolveHandlerStarted = resolve; });
  let resolveHandlerFinished;
  const handlerFinished = new Promise((resolve) => { resolveHandlerFinished = resolve; });
  let lateDatabaseAccess = null;
  gateway.createApp = () => {
    const app = express();
    gateway.applicationLifecycle.install(app);
    app.get('/__t8-gateway-lifecycle-delayed', async (_req, res) => {
      resolveHandlerStarted();
      await handlerGate;
      try {
        database.db.prepare('SELECT 1 AS ok').get();
        lateDatabaseAccess = 'ok';
      } catch (error) {
        lateDatabaseAccess = error?.message || String(error);
      }
      try { res.json({ ok: true }); } catch (_) {}
      resolveHandlerFinished();
    });
    return app;
  };
  const running = await gateway.start({ host: '127.0.0.1', port: 0 });
  const client = http.get({
    host: '127.0.0.1',
    port: running.port,
    path: '/__t8-gateway-lifecycle-delayed',
  }, (response) => response.resume());
  client.on('error', () => {});
  await handlerStarted;
  const before = Date.now();
  const shutdown = await backend.gracefulShutdown();
  const elapsedMs = Date.now() - before;
  assert.equal(shutdown.storageDeferred, true);
  assert.equal(shutdown.storageClosed, false);
  assert.equal(shutdown.collaboration.applicationRequests.drained, false);
  assert.ok(elapsedMs >= 1_900 && elapsedMs < 5_000, 'gateway close must keep a finite transport deadline');
  assert.equal(database.db.open, true);
  releaseHandler();
  await handlerFinished;
  assert.equal(lateDatabaseAccess, 'ok');
  await backend.waitForRuntimeStorageCloseLifecycle();
  assert.equal(database.db.open, false);
  client.destroy();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  console.log('T8_LIFECYCLE_RESULT=' + JSON.stringify({ elapsedMs, lateDatabaseAccess, storageClosed: !database.db.open }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`, 20_000);
  assert.equal(result.lateDatabaseAccess, 'ok');
  assert.equal(result.storageClosed, true);
  assert.ok(result.elapsedMs >= 1_900 && result.elapsedMs < 5_000);
});

test('a late main-management task cannot reuse an earlier drained gateway outcome', () => {
  const result = runLifecycleProbe(`${isolatedServerPrelude()}
(async () => {
  const backend = require('./backend/src/server');
  const start = await backend.serverStartPromise;
  assert.equal(start.state, 'listening');
  const database = require('./backend/src/services/projectDatabase').getProjectDatabase();
  const gateway = require('./backend/src/collaboration/gateway').getCollaborationGateway(config);
  let releaseManagement;
  const managementGate = new Promise((resolve) => { releaseManagement = resolve; });
  let resolveManagementStarted;
  const managementStarted = new Promise((resolve) => { resolveManagementStarted = resolve; });
  let releaseGatewayTask;
  const gatewayTask = new Promise((resolve) => { releaseGatewayTask = resolve; });
  let resolveManagementFinished;
  const managementFinished = new Promise((resolve) => { resolveManagementFinished = resolve; });
  let lateDatabaseAccess = null;
  backend.app.get('/__t8-lifecycle-late-gateway-task', async (_req, res) => {
    resolveManagementStarted();
    await managementGate;
    gateway.applicationLifecycle.trackStandaloneTask((async () => {
      await gatewayTask;
      try {
        database.db.prepare('SELECT 1 AS ok').get();
        lateDatabaseAccess = 'ok';
      } catch (error) {
        lateDatabaseAccess = error?.message || String(error);
      }
    })());
    res.json({ ok: true });
    resolveManagementFinished();
  });
  const port = backend.server.address().port;
  const client = http.get({ host: '127.0.0.1', port, path: '/__t8-lifecycle-late-gateway-task' }, (response) => response.resume());
  client.on('error', () => {});
  await managementStarted;
  const shutdownPromise = backend.gracefulShutdown();
  await new Promise((resolve) => setTimeout(resolve, 25));
  releaseManagement();
  await managementFinished;
  const shutdown = await shutdownPromise;
  assert.equal(shutdown.http.drained, true);
  assert.equal(shutdown.collaboration.applicationRequests.drained, false);
  assert.equal(shutdown.storageDeferred, true);
  assert.equal(database.db.open, true);
  releaseGatewayTask();
  await backend.waitForRuntimeStorageCloseLifecycle();
  assert.equal(lateDatabaseAccess, 'ok');
  assert.equal(database.db.open, false);
  client.destroy();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  console.log('T8_LIFECYCLE_RESULT=' + JSON.stringify({ lateDatabaseAccess, storageClosed: !database.db.open }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`);
  assert.deepEqual(result, { lateDatabaseAccess: 'ok', storageClosed: true });
});

test('backend shutdown cancels a detached video child and drains its scheduler before storage close', () => {
  const result = runLifecycleProbe(`${isolatedServerPrelude()}
(async () => {
  const backend = require('./backend/src/server');
  const start = await backend.serverStartPromise;
  assert.equal(start.state, 'listening');
  const database = require('./backend/src/services/projectDatabase').getProjectDatabase();
  const videoOps = require('./backend/src/routes/videoOps');
  let releaseExecutor;
  const executorGate = new Promise((resolve) => { releaseExecutor = resolve; });
  let resolveExecutorStarted;
  const executorStarted = new Promise((resolve) => { resolveExecutorStarted = resolve; });
  let childKills = 0;
  const job = videoOps._test.makeJob('compose');
  const task = videoOps._test.scheduleAsyncVideoOperation(job, async () => {
    resolveExecutorStarted();
    await executorGate;
  }, '视频合成失败');
  await executorStarted;
  job.child = {
    kill() {
      childKills += 1;
      releaseExecutor();
    },
  };
  const shutdown = await backend.gracefulShutdown();
  await task;
  assert.equal(childKills, 1);
  assert.equal(job.status, 'cancelled');
  assert.equal(shutdown.videoOperations.tasks.drained, true);
  assert.equal(shutdown.storageClosed, true);
  assert.equal(database.db.open, false);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  console.log('T8_LIFECYCLE_RESULT=' + JSON.stringify({ childKills, status: job.status, storageClosed: !database.db.open }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`);
  assert.deepEqual(result, { childKills: 1, status: 'cancelled', storageClosed: true });
});
