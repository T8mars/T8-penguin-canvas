const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONTRACT_FINGERPRINT,
  EXPECTED_INTERNAL_LIFECYCLE_CALLS,
  LIFECYCLE_METHOD_CONTRACTS,
  LIFECYCLE_METHOD_NAMES,
  buildProjectDatabaseLifecyclePolicy,
} = require('../scripts/project-database-lifecycle-policy.cjs');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_DATABASE_SOURCE = path.join(ROOT, 'backend', 'src', 'services', 'projectDatabase.js');
const CLASSIFICATION_MANIFEST = path.join(ROOT, 'scripts', 'project-database-method-classification.json');
const EXPECTED_LIFECYCLE_METHODS = [
  'constructor',
  'preflightExistingDatabase',
  'initializeDatabase',
  'bootstrapRecoveryGeneration',
  'rotateRecoveryGeneration',
  'validateRecoveryCandidate',
  'recoverDatabase',
  'configure',
  'startStartupBackup',
  'createBackup',
  'waitForBackup',
  'close',
  '_assertProjectDatabaseHistoryCandidate',
  '_copyRecoveryEvidence',
  '_writeRecoveryGenerationState',
  '_createBackupAtomically',
  '_reconcileTerminalRunSnapshotPins',
];

const EXPECTED_PUBLIC_LIFECYCLE_METHODS = EXPECTED_LIFECYCLE_METHODS.slice(0, 12);
const EXPECTED_INTERNAL_LIFECYCLE_METHODS = EXPECTED_LIFECYCLE_METHODS.slice(12);

function makeInventoryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-project-db-lifecycle-policy-'));
  const services = path.join(root, 'backend', 'src', 'services');
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(services, { recursive: true });
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(PROJECT_DATABASE_SOURCE, path.join(services, 'projectDatabase.js'));
  fs.copyFileSync(CLASSIFICATION_MANIFEST, path.join(scripts, 'project-database-method-classification.json'));
  return root;
}

function mutateProjectDatabaseSource(root, mutate) {
  const filename = path.join(root, 'backend', 'src', 'services', 'projectDatabase.js');
  const before = fs.readFileSync(filename, 'utf8');
  const after = mutate(before);
  assert.notEqual(after, before, 'synthetic source mutation must change projectDatabase.js');
  fs.writeFileSync(filename, after, 'utf8');
}

function addMaintenanceClassification(root, methodName) {
  const filename = path.join(root, 'scripts', 'project-database-method-classification.json');
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  manifest.categories.maintenance.push(methodName);
  fs.writeFileSync(filename, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function issue(report, code, name = null) {
  return report.issues.find((entry) => entry.code === code && (name == null || entry.name === name));
}

test('current lifecycle gate freezes seventeen exact boundaries without claiming main writer completion', () => {
  const report = buildProjectDatabaseLifecyclePolicy(ROOT);
  assert.equal(report.lifecycleCompliant, true);
  assert.equal(report.status, 'lifecycle-policy-complete');
  assert.equal(report.issueCount, 0);
  assert.deepEqual(report.issues, []);
  assert.equal(report.writerInventory.classificationComplete, true);
  assert.equal(report.writerInventory.classificationGatePassed, true);
  assert.equal(report.writerInventory.mainWriterPolicyCompliant, false);
  assert.equal(report.writerInventory.mainWriterPolicyCounts.noncompliant, 12);
  assert.equal(Number.isInteger(report.writerInventory.mainWriterPolicyCounts.compliant), true);
  assert.equal(Number.isInteger(report.writerInventory.mainWriterPolicyCounts.unresolved), true);
  assert.equal(Number.isInteger(report.writerInventory.mainWriterPolicyCounts.notApplicable), true);

  assert.deepEqual(LIFECYCLE_METHOD_NAMES, EXPECTED_LIFECYCLE_METHODS);
  assert.deepEqual(report.lifecycle.allowlist, EXPECTED_LIFECYCLE_METHODS);
  assert.equal(report.lifecycle.allowlistCount, 17);
  assert.equal(report.lifecycle.observedCount, 17);
  assert.equal(report.lifecycle.contractFingerprint, CONTRACT_FINGERPRINT);
  assert.deepEqual(report.lifecycle.actualInternalCallsites, EXPECTED_INTERNAL_LIFECYCLE_CALLS);
  assert.match(CONTRACT_FINGERPRINT, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(LIFECYCLE_METHOD_CONTRACTS), true);
  assert.equal(Object.isFrozen(LIFECYCLE_METHOD_CONTRACTS[0].direct), true);
  assert.equal(report.productionCallsites.scannedFileCount > 0, true);
  assert.equal(report.productionCallsites.entryCount, 0);
  assert.deepEqual(report.productionCallsites.entries, []);

  const methods = new Map(report.lifecycle.observedMethods.map((entry) => [entry.name, entry]));
  for (const name of EXPECTED_PUBLIC_LIFECYCLE_METHODS) {
    const method = methods.get(name);
    assert.ok(method, name);
    assert.equal(method.classification, 'maintenance', name);
    assert.equal(method.visibility, 'public', name);
    assert.equal(method.async, false, name);
    assert.equal(method.mainWriterPolicyCompliant, false, name);
    assert.equal(method.mainWriterPolicyReason, 'public-stateful-method-without-direct-coordinator', name);
    assert.equal(method.direct.coordinatorCallCount, 0, name);
    assert.equal(method.direct.dynamicProjectDatabaseCallCount, 0, name);
  }
  for (const name of EXPECTED_INTERNAL_LIFECYCLE_METHODS) {
    const method = methods.get(name);
    assert.ok(method, name);
    assert.equal(method.classification, 'maintenance', name);
    assert.equal(method.visibility, 'internal', name);
    assert.equal(method.mainWriterPolicyCompliant, null, name);
    assert.equal(method.mainWriterPolicyReason, 'internal-caller-boundary-not-statically-proven', name);
    assert.equal(method.direct.coordinatorCallCount, 0, name);
    assert.equal(method.direct.dynamicProjectDatabaseCallCount, 0, name);
  }
  assert.deepEqual(report.lifecycle.expectedMainWriterNoncompliant.sort(), [
    ...EXPECTED_PUBLIC_LIFECYCLE_METHODS,
  ].sort());
  assert.deepEqual(report.lifecycle.actualMainWriterNoncompliant,
    report.lifecycle.expectedMainWriterNoncompliant);
  assert.deepEqual(report.lifecycle.expectedMainWriterUnresolved.sort(), [
    ...EXPECTED_INTERNAL_LIFECYCLE_METHODS,
  ].sort());
  assert.deepEqual(report.lifecycle.actualMainWriterUnresolved,
    report.lifecycle.expectedMainWriterUnresolved);
  assert.deepEqual(methods.get('configure').direct.writePragmas, [
    'journal_mode = WAL',
    'foreign_keys = ON',
    'busy_timeout = 5000',
  ]);
  assert.deepEqual(methods.get('bootstrapRecoveryGeneration').direct.transactionTypes, ['immediate']);
  assert.deepEqual(methods.get('rotateRecoveryGeneration').direct.transactionTypes, ['immediate']);
  assert.deepEqual(methods.get('constructor').direct.filesystemMutationMethods, ['mkdirSync']);
  assert.deepEqual(methods.get('preflightExistingDatabase').direct.filesystemMutationMethods, [
    'copyFileSync', 'rmSync', 'rmSync', 'rmSync',
  ]);
  assert.deepEqual(methods.get('recoverDatabase').direct.filesystemMutationMethods, [
    'chmodSync', 'rmSync', 'renameSync', 'rmdirSync', 'renameSync', 'rmSync', 'rmdirSync',
  ]);
  assert.deepEqual(methods.get('createBackup').calledProjectDatabaseMethods, ['_createBackupAtomically']);
  assert.deepEqual(methods.get('startStartupBackup').calledProjectDatabaseMethods, ['createBackup']);
  assert.deepEqual(methods.get('_reconcileTerminalRunSnapshotPins').direct.transactionTypes, ['immediate']);
  assert.deepEqual(methods.get('_writeRecoveryGenerationState').direct.filesystemMutationMethods, [
    'openSync', 'writeFileSync', 'fsyncSync', 'renameSync', 'rmSync',
  ]);
  assert.equal(methods.get('_createBackupAtomically').async, true);
  assert.deepEqual(methods.get('_createBackupAtomically').direct.writePragmas, [
    'foreign_keys = ON', 'wal_checkpoint(TRUNCATE)',
  ]);
});

test('temporary ProjectDatabase additions, removals and lifecycle shape drift all fail closed', () => {
  const variants = [
    {
      name: 'async-drift',
      mutate(source) {
        return source.replace('\n  close() {', '\n  async close() {');
      },
      assertReport(report) {
        const drift = issue(report, 'lifecycle-method-contract-drift', 'close');
        assert.ok(drift);
        assert.equal(drift.drifts.some((entry) => entry.field === 'async'
          && entry.expected === false && entry.actual === true), true);
      },
    },
    {
      name: 'removed-method',
      mutate(source) {
        return source.replace('\n  waitForBackup() {', '\n  waitForBackupRemoved() {');
      },
      assertReport(report) {
        assert.ok(issue(report, 'lifecycle-method-missing', 'waitForBackup'));
        assert.ok(issue(report, 'main-writer-noncompliant-set-drift'));
      },
    },
    {
      name: 'added-method',
      methodName: 'unexpectedLifecycleStartup',
      mutate(source) {
        return source.replace('\n  close() {', `
  unexpectedLifecycleStartup() {
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
  }

  close() {`);
      },
      assertReport(report) {
        const drift = issue(report, 'main-writer-noncompliant-set-drift');
        assert.ok(drift);
        assert.equal(drift.unexpected.includes('unexpectedLifecycleStartup'), true);
      },
    },
    {
      name: 'internal-caller-drift',
      mutate(source) {
        return source.replace('\n  getRecoveryGeneration() {', `
  getRecoveryGeneration() {
    this.recoverDatabase(new Error('synthetic lifecycle exposure'));`);
      },
      assertReport(report) {
        const drift = issue(report, 'lifecycle-internal-callsite-drift');
        assert.ok(drift);
        assert.equal(drift.actual.some((entry) => (
          entry.caller === 'getRecoveryGeneration' && entry.callee === 'recoverDatabase'
        )), true);
      },
    },
  ];

  for (const variant of variants) {
    const root = makeInventoryFixture();
    try {
      mutateProjectDatabaseSource(root, variant.mutate);
      if (variant.methodName) addMaintenanceClassification(root, variant.methodName);
      const report = buildProjectDatabaseLifecyclePolicy(root);
      assert.equal(report.lifecycleCompliant, false, variant.name);
      assert.equal(report.status, 'lifecycle-policy-incomplete', variant.name);
      assert.equal(report.issueCount > 0, true, variant.name);
      variant.assertReport(report);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('temporary HTTP, gateway, business-service, constructor and dynamic callsites fail closed', () => {
  const root = makeInventoryFixture();
  try {
    const routes = path.join(root, 'backend', 'src', 'routes');
    const collaboration = path.join(root, 'backend', 'src', 'collaboration');
    const services = path.join(root, 'backend', 'src', 'services');
    fs.mkdirSync(routes, { recursive: true });
    fs.mkdirSync(collaboration, { recursive: true });
    fs.writeFileSync(path.join(routes, 'lifecycleLeak.js'), `
      const { getProjectDatabase } = require('../services/projectDatabase');
      const database = getProjectDatabase({});
      router.post('/recover', () => database.recoverDatabase());
      router.post('/dynamic', (req) => database[req.body.lifecycleMethod]());
    `, 'utf8');
    fs.writeFileSync(path.join(collaboration, 'gatewayLeak.js'), `
      class GatewayLeak {
        constructor(database) { this.database = database; }
        exposeBackup() { return this.database.createBackup(); }
      }
      module.exports = { GatewayLeak };
    `, 'utf8');
    fs.writeFileSync(path.join(services, 'businessLeak.js'), `
      const { ProjectDatabase } = require('./projectDatabase');
      const leakedOwner = new ProjectDatabase(':memory:');
      class BusinessLeak {
        constructor(database) { this.database = database; }
        shutdown() { return this.database.close(); }
      }
      module.exports = { BusinessLeak, leakedOwner };
    `, 'utf8');

    const report = buildProjectDatabaseLifecyclePolicy(root);
    assert.equal(report.lifecycleCompliant, false);
    assert.equal(report.productionCallsites.entryCount, 5);
    assert.deepEqual(
      report.productionCallsites.entries.map((entry) => [entry.surface, entry.method, entry.usage]),
      [
        ['gateway', 'createBackup', 'call'],
        ['http-route', 'recoverDatabase', 'call'],
        ['http-route', null, 'call-dynamic'],
        ['business-service', 'constructor', 'construct'],
        ['business-service', 'close', 'call'],
      ],
    );
    assert.equal(report.issues.filter((entry) => (
      entry.code === 'lifecycle-production-callsite-exposed'
    )).length, 4);
    assert.equal(report.issues.filter((entry) => (
      entry.code === 'lifecycle-dynamic-production-callsite'
    )).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
