'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'audit-project-database-writers.cjs');
const MANIFEST = path.join(ROOT, 'scripts', 'project-database-method-classification.json');
const PROJECT_DATABASE_SOURCE = path.join(ROOT, 'backend', 'src', 'services', 'projectDatabase.js');
const {
  METHOD_CLASSIFICATION_CATEGORIES,
  REPORT_STATUS,
  REPORT_VERSION,
  annotateProjectDatabaseWriterPolicy,
  buildWriterInventory,
  classifyProjectDatabaseMethods,
  externalRawDatabaseInventory,
  inventoryProjectDatabase,
  loadProjectDatabaseMethodClassification,
} = require('../scripts/audit-project-database-writers.cjs');

let cachedReport;
let cachedProjectDatabaseSourceLines;

function report() {
  if (!cachedReport) cachedReport = buildWriterInventory(ROOT);
  return cachedReport;
}

function methodNamed(name) {
  const method = report().projectDatabase.methods.find((entry) => entry.name === name);
  assert.ok(method, `expected ProjectDatabase.${name} in the static inventory`);
  return method;
}

function methodSource(name) {
  const method = methodNamed(name);
  if (!cachedProjectDatabaseSourceLines) {
    cachedProjectDatabaseSourceLines = fs.readFileSync(PROJECT_DATABASE_SOURCE, 'utf8').split(/\r?\n/);
  }
  return cachedProjectDatabaseSourceLines.slice(method.line - 1, method.endLine).join('\n');
}

const STRICT_BOUNDARY_UNRESOLVED_METHODS = [];
const STRICT_BOUNDARY_UNRESOLVED_METHOD_SET = new Set(STRICT_BOUNDARY_UNRESOLVED_METHODS);
const INTERNAL_COORDINATOR_ASSERTED_METHODS = [
  '_deleteCanvasSnapshotPin',
  '_syncRunIntentSnapshotPin',
  '_ensureSchema31SnapshotOwnerAuthority',
  '_syncRunSnapshotPin',
  '_syncReviewSnapshotPins',
  '_syncCanvasPatchSnapshotPin',
  '_upsertCanvasResourceGrant',
  '_syncCanvasDocumentResourceGrants',
  '_commitCanvasResourceState',
  '_grantCanvasSubflowResource',
  '_invalidateCollaborationTextBindings',
  '_invalidateCollaborationTextForOperation',
  '_compactCanvasSnapshotHistory',
  '_recordCanvasSnapshot',
  '_reserveCommonOperationIdentities',
  '_assertCommonEvidenceCapacity',
  '_insertCommonOperationBatch',
  '_compactCanvasOperationHistory',
  '_applyOperations',
  '_applyCanvasPatch',
  '_revertCanvasPatch',
  '_ensureReviewCanvasSnapshot',
  '_updateMember',
  '_insertReviewMention',
  '_insertReviewAttachment',
  '_insertReviewReferences',
  '_insertReviewNotifications',
  '_createReviewOperationNotifications',
  '_createReviewThreadWithComment',
  '_createReviewCommentWithThreadRevision',
  '_applyCommonReviewBatch',
  '_applyCommonSubflowBatch',
  '_appendDeterministicRunRecoveryEvent',
  '_completeRecoveredRunAttemptInTransaction',
  '_applyCommonHostArtifactBatch',
  '_createRunIntent',
  '_updateRunIntent',
  '_recordRunOutputAssets',
  '_recoverInterruptedRuns',
  '_bumpAssetCatalogRevision',
  '_bumpAssetOrganizationRevision',
  '_cleanupOrphanAssetBlob',
  '_syncAssetBlobReference',
  '_replaceAssetFingerprints',
  '_syncAssetSemanticModelObservations',
  '_setAssetSemanticProfile',
  '_pruneAssetSemanticGenerationPayloads',
  '_sealAssetSemanticRebuild',
  '_invalidateSemanticEmbeddingDependency',
  '_finishStaleSemanticRunningJob',
  '_supersedeAssetSemanticJobs',
  '_syncAssetAvailabilityObservations',
  '_setAssetTags',
  '_deleteAssetCollection',
  '_setAssetCollectionMembers',
  '_refreshAssetDuplicateCandidates',
  '_applyAssetBatch',
  '_recoverInterruptedAssetUploadSessions',
  '_expireAssetUploadSessions',
  '_expireUnlockedAssetUploadSessions',
  '_appendAuditEvent',
];
const INTERNAL_EXISTING_TRANSACTION_ASSERTED_METHODS = [
  '_ensureProjectDurableLedgerState',
  '_assertDurableLedgerAccounting',
  '_ensureCanvasPermanentLedgerState',
  '_assertCanvasPermanentLedgerAccounting',
  '_ensureCanvasHistoryState',
  '_insertCommonGraphEvidenceRow',
  '_putCanvasSnapshotPin',
  '_ensureRecoveryAnchorPin',
  '_releaseTerminalRunSnapshotPins',
  '_createSnapshotPinOwnerIndex',
  '_dropSnapshotPinOwnerIndex',
  '_assertCanvasHistoryAccounting',
  '_assertCanvasSnapshotPins',
  '_advanceCanvasResourceGrantState',
];
const INTERNAL_UNRESOLVED_METHODS = [
  '_assertProjectDatabaseHistoryCandidate',
  '_copyRecoveryEvidence',
  '_writeRecoveryGenerationState',
  '_createBackupAtomically',
  '_reconcileTerminalRunSnapshotPins',
];
const STRICT_WRITER_INTERNAL_IMPLEMENTATIONS = new Map([
  ['reserveCommonOperationIdentities', '_reserveCommonOperationIdentities'],
  ['insertCommonOperationBatch', '_insertCommonOperationBatch'],
  ['compactCanvasOperationHistory', '_compactCanvasOperationHistory'],
  ['applyOperations', '_applyOperations'],
  ['applyCanvasPatch', '_applyCanvasPatch'],
  ['revertCanvasPatch', '_revertCanvasPatch'],
  ['updateMember', '_updateMember'],
  ['createReviewThreadWithComment', '_createReviewThreadWithComment'],
  ['createReviewCommentWithThreadRevision', '_createReviewCommentWithThreadRevision'],
  ['applyCommonReviewBatch', '_applyCommonReviewBatch'],
  ['applyCommonSubflowBatch', '_applyCommonSubflowBatch'],
  ['applyCommonHostArtifactBatch', '_applyCommonHostArtifactBatch'],
  ['recordRunOutputAssets', '_recordRunOutputAssets'],
  ['recoverInterruptedRuns', '_recoverInterruptedRuns'],
  ['syncAssetSemanticModelObservations', '_syncAssetSemanticModelObservations'],
  ['setAssetSemanticProfile', '_setAssetSemanticProfile'],
  ['pruneAssetSemanticGenerationPayloads', '_pruneAssetSemanticGenerationPayloads'],
  ['sealAssetSemanticRebuild', '_sealAssetSemanticRebuild'],
  ['supersedeAssetSemanticJobs', '_supersedeAssetSemanticJobs'],
  ['syncAssetAvailabilityObservations', '_syncAssetAvailabilityObservations'],
  ['setAssetTags', '_setAssetTags'],
  ['deleteAssetCollection', '_deleteAssetCollection'],
  ['setAssetCollectionMembers', '_setAssetCollectionMembers'],
  ['refreshAssetDuplicateCandidates', '_refreshAssetDuplicateCandidates'],
  ['applyAssetBatch', '_applyAssetBatch'],
  ['recoverInterruptedAssetUploadSessions', '_recoverInterruptedAssetUploadSessions'],
  ['expireAssetUploadSessions', '_expireAssetUploadSessions'],
  ['expireUnlockedAssetUploadSessions', '_expireUnlockedAssetUploadSessions'],
]);

function assertDirectCoordinatorPolicy(methodName) {
  const writer = methodNamed(methodName);
  if (STRICT_BOUNDARY_UNRESOLVED_METHOD_SET.has(methodName)) {
    assert.equal(writer.policyCompliant, null, methodName);
    assert.equal(writer.policyReason, 'direct-coordinator-call-observed-boundary-not-proven', methodName);
    assert.equal(writer.coordinatorBoundaryProof.proven, false, methodName);
    return;
  }
  assert.equal(writer.policyCompliant, true, methodName);
  assert.equal(writer.policyReason, 'direct-coordinator-boundary-proven', methodName);
  assert.equal(writer.coordinatorBoundaryProof.proven, true, methodName);
  assert.equal(writer.coordinatorBoundaryProof.uncoveredEffectCount, 0, methodName);
}

function assertExactSelfWrappedOperation(methodName, operation, classification = 'write') {
  const writer = methodNamed(methodName);
  assert.equal(writer.classification, classification);
  assertDirectCoordinatorPolicy(methodName);
  assert.equal(writer.direct.transactionFactoryCount, 0);
  assert.ok(writer.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));
  const source = methodSource(methodName);
  assert.equal(
    (source.match(/\bwithProjectDatabaseWrite\s*\(/g) || []).length,
    1,
    `expected one self-wrapped coordinator call in ProjectDatabase.${methodName}`,
  );
  const escapedOperation = operation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    source,
    new RegExp(`withProjectDatabaseWrite\\s*\\(\\s*['"]${escapedOperation}['"]`),
    `expected ProjectDatabase.${methodName} to self-wrap exact operation ${operation}`,
  );
  const internalMethodName = STRICT_WRITER_INTERNAL_IMPLEMENTATIONS.get(methodName);
  if (internalMethodName) {
    const internal = methodNamed(internalMethodName);
    assert.equal(internal.visibility, 'internal', internalMethodName);
    assert.equal(internal.classification, classification, internalMethodName);
    assert.equal(internal.async, false, internalMethodName);
    assert.equal(internal.direct.transactionFactoryCount, 0, internalMethodName);
    assert.equal(internal.direct.coordinatorCallCount, 0, internalMethodName);
    assert.equal(internal.policyCompliant, true, internalMethodName);
    assert.equal(
      internal.policyReason,
      'internal-coordinator-transaction-assertion-proven',
      internalMethodName,
    );
    assert.equal(internal.internalTransactionAssertion.proven, true, internalMethodName);
    assert.equal(internal.internalTransactionAssertion.context, 'coordinator', internalMethodName);
    assert.equal(internal.internalTransactionProof.proven, true, internalMethodName);
    assert.deepEqual(internal.internalTransactionProof.unsafeCallees, [], internalMethodName);
    assert.deepEqual(
      writer.calledProjectDatabaseMethods,
      [internalMethodName, 'withProjectDatabaseWrite'],
      `expected ProjectDatabase.${methodName} to call only its synchronous internal implementation`,
    );
    assert.equal(writer.direct.databaseEffectCount, 0, methodName);
    assert.match(
      source,
      new RegExp(`=>\\s*(?:\\(\\s*)?this\\.${internalMethodName}\\(`),
      `expected ProjectDatabase.${methodName} to invoke ${internalMethodName} in the exact inline callback`,
    );
  }
}

const ASSET_ORGANIZATION_WRITER_OPERATIONS = [
  ['setAssetTags', 'asset.tags.update'],
  ['createAssetCollection', 'asset.collection.create'],
  ['updateAssetCollection', 'asset.collection.update'],
  ['deleteAssetCollection', 'asset.collection.delete'],
  ['setAssetCollectionMembers', 'asset.collection.members.replace'],
  ['addAssetCollectionMember', 'asset.collection.members.add'],
  ['removeAssetCollectionMember', 'asset.collection.members.remove'],
];

test('B2 asset organization writers self-wrap exactly one coordinator operation', async (t) => {
  for (const [methodName, operation] of ASSET_ORGANIZATION_WRITER_OPERATIONS) {
    await t.test(methodName, () => assertExactSelfWrappedOperation(methodName, operation));
  }
});

const ASSET_UPLOAD_STATIC_WRITER_OPERATIONS = [
  ['markAssetBlobStored', 'asset.blob.store'],
  ['createAssetUploadSession', 'asset.upload.session-create'],
  ['recordAssetUploadChunk', 'asset.upload.chunk-record'],
  ['claimAssetUploadCompletion', 'asset.upload.completion-claim'],
  ['completeAssetUploadSession', 'asset.upload.session-complete'],
  ['commitAssetUpload', 'asset.upload.commit'],
  ['failAssetUploadSession', 'asset.upload.fail'],
  ['recoverInterruptedAssetUploadSessions', 'asset.upload.recover-interrupted', 'maintenance'],
  ['expireAssetUploadSessions', 'asset.upload.expire', 'maintenance'],
  ['expireUnlockedAssetUploadSessions', 'asset.upload.expire-unlocked', 'maintenance'],
  ['purgeAssetUploadChunks', 'asset.upload.chunk-purge', 'maintenance'],
];

test('B2 upload and blob writers self-wrap exact coordinator operations', async (t) => {
  for (const [methodName, operation, classification] of ASSET_UPLOAD_STATIC_WRITER_OPERATIONS) {
    await t.test(methodName, () => (
      assertExactSelfWrappedOperation(methodName, operation, classification)
    ));
  }
  await t.test('transitionAssetUploadSession', () => {
    const writer = methodNamed('transitionAssetUploadSession');
    assert.equal(writer.classification, 'write');
    assertDirectCoordinatorPolicy('transitionAssetUploadSession');
    assert.equal(writer.direct.transactionFactoryCount, 0);
    assert.ok(writer.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));
    const source = methodSource('transitionAssetUploadSession');
    assert.equal((source.match(/\bwithProjectDatabaseWrite\s*\(/g) || []).length, 1);
    assert.match(source, /const normalizedAction = String\(action \|\| ''\)/);
    assert.match(
      source,
      /return this\.withProjectDatabaseWrite\(`asset\.upload\.\$\{normalizedAction\}`/,
    );
    for (const action of ['pause', 'resume', 'cancel']) {
      assert.match(source, new RegExp(`\\b${action}:\\s*\\{`));
    }
    assert.ok(source.includes("pause: { from: ['uploading'], to: 'paused' }"));
    assert.ok(source.includes("resume: { from: ['paused'], to: 'uploading' }"));
    assert.ok(source.includes("cancel: { from: [...ASSET_UPLOAD_ACTIVE_STATUSES], to: 'cancelled' }"));
  });
});

const BUSINESS_WRITER_OPERATION_GROUPS = [
  ['canvas/core', [
    ['ensureCanvas', 'canvas.ensure'],
    ['compactCanvasSnapshotHistory', 'canvas.snapshot-history.compact', 'maintenance'],
    ['recordCanvasSnapshot', 'canvas.snapshot.record'],
    ['reserveCollaborationOperationIdentity', 'collaboration.operation-identity.reserve'],
    ['reserveCommonOperationIdentities', 'collaboration.common-operation-identities.reserve'],
    ['insertCommonOperationBatch', 'collaboration.common-operation-batch.insert'],
    ['insertCanvasOperationBatch', 'canvas.operation-batch.insert'],
    ['compactCanvasOperationHistory', 'canvas.operation-history.compact', 'maintenance'],
    ['insertCanvasOperationRecord', 'canvas.operation.record'],
    ['recordCanvasMutationMarks', 'canvas.mutation-provenance.record'],
    ['recordCanvasOperationMutation', 'canvas.operation-mutation.record'],
    ['recordCanvasResetMutation', 'canvas.reset-mutation.record'],
    ['restoreCanvasSnapshot', 'canvas.snapshot-restore'],
    ['deleteCanvas', 'canvas.delete'],
    ['saveCanvasSnapshot', 'canvas.snapshot-save'],
    ['applyOperations', 'canvas.operations.apply'],
    ['applyCanvasPatch', 'canvas.patch.apply'],
    ['revertCanvasPatch', 'canvas.patch.revert'],
  ]],
  ['semantic', [
    ['beginAssetSemanticModelDelete', 'asset.semantic.model.delete-begin'],
    ['setAssetSemanticModelState', 'asset.semantic.model.state'],
    ['syncAssetSemanticModelObservations', 'asset.semantic.models.sync'],
    ['setAssetSemanticProfile', 'asset.semantic.profile.update'],
    ['pruneAssetSemanticGenerationPayloads', 'asset.semantic.generation.payload-prune', 'maintenance'],
    ['beginAssetSemanticRebuild', 'asset.semantic.generation.begin'],
    ['sealAssetSemanticRebuild', 'asset.semantic.generation.seal'],
    ['finishAssetSemanticRebuild', 'asset.semantic.generation.finish'],
    ['supersedeBuildingAssetSemanticGeneration', 'asset.semantic.generation.supersede'],
    ['promoteAssetSemanticGeneration', 'asset.semantic.generation.promote'],
    ['enqueueAssetSemanticJob', 'asset.semantic.job.enqueue'],
    ['claimNextAssetSemanticJob', 'asset.semantic.job.claim'],
    ['completeAssetSemanticJob', 'asset.semantic.job.complete'],
    ['rescheduleAssetSemanticJob', 'asset.semantic.job.reschedule'],
    ['retryAssetSemanticJob', 'asset.semantic.job.retry'],
    ['retryAssetSemanticJobs', 'asset.semantic.jobs.retry'],
    ['recoverInterruptedAssetSemanticJobs', 'asset.semantic.jobs.recover-interrupted', 'maintenance'],
    ['supersedeAssetSemanticJobs', 'asset.semantic.jobs.supersede'],
  ]],
  ['lineage', [
    ['recordAssetLineageEvent', 'asset.lineage.record'],
    ['addAssetLineage', 'asset.lineage.add'],
  ]],
  ['collaboration text', [
    ['archiveReusedCollaborationTextDisplayBindings', 'collaboration.text.binding.archive-reused-display'],
    ['writeCollaborationTextBinding', 'collaboration.text.binding.write'],
    ['insertCollaborationTextIdempotencyRecord', 'collaboration.text.idempotency.insert'],
    ['updateCollaborationTextReviewBody', 'collaboration.text.review.materialize'],
    ['commitCollaborationTextCanvasDocument', 'collaboration.text.canvas.commit'],
    ['advanceCollaborationTextClientSequence', 'collaboration.text.client-sequence.advance'],
    ['saveCollaborativeTextDocument', 'collaboration.text.legacy-save'],
  ]],
];

test('B2 public business writers freeze exact coordinator operations', async (t) => {
  for (const [groupName, writers] of BUSINESS_WRITER_OPERATION_GROUPS) {
    await t.test(groupName, async (group) => {
      for (const [methodName, operation, classification] of writers) {
        await group.test(methodName, () => (
          assertExactSelfWrappedOperation(methodName, operation, classification)
        ));
      }
    });
  }
});

test('B2 writer inventory classifies every ProjectDatabase method while policy stays explicitly incomplete', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /require\(\s*['"]better-sqlite3['"]\s*\)/);
  assert.doesNotMatch(source, /require\(\s*['"][^'"]*projectDatabase(?:\.js)?['"]\s*\)/i);
  assert.doesNotMatch(source, /new\s+ProjectDatabase\b/);
  assert.equal(fs.existsSync(MANIFEST), true);

  const inventory = report();
  assert.equal(inventory.reportVersion, REPORT_VERSION);
  assert.equal(inventory.status, REPORT_STATUS);
  assert.equal(inventory.evidenceLevel, 'static-source-inventory-only');
  assert.equal(inventory.classificationComplete, true);
  assert.equal(inventory.classificationGatePassed, true);
  assert.equal(inventory.policyCompliant, false);
  assert.equal(inventory.parser.package, '@babel/parser');
  assert.ok(inventory.disclaimer.some((line) => /never opens/i.test(line)));
  assert.ok(inventory.disclaimer.some((line) => /not writer-policy implementation or completion evidence/i.test(line)));
  assert.ok(inventory.disclaimer.some((line) => /dynamic SQL.*higher-order/i.test(line)));

  assert.equal(inventory.methodClassification.manifestFile, 'scripts/project-database-method-classification.json');
  assert.equal(inventory.methodClassification.classificationComplete, true);
  assert.equal(inventory.methodClassification.classificationConsistent, true);
  assert.equal(inventory.methodClassification.classificationGatePassed, true);
  assert.equal(inventory.methodClassification.issueCount, 0);
  assert.equal(inventory.methodClassification.consistencyIssueCount, 0);
  assert.deepEqual(inventory.methodClassification.categories, [...METHOD_CLASSIFICATION_CATEGORIES]);
  assert.deepEqual(inventory.methodClassification.counts, {
    read: 201,
    write: 184,
    maintenance: 45,
    migration: 32,
    'test-only': 0,
    unclassified: 0,
  });
  assert.deepEqual(inventory.methodClassification.manifestCounts, {
    read: 201,
    write: 184,
    maintenance: 45,
    migration: 32,
    'test-only': 0,
  });
  assert.equal(inventory.projectDatabase.methodCount, 462);
  assert.equal(inventory.writerPolicy.policyCompliant, false);
  assert.deepEqual(inventory.writerPolicy.methodCounts, {
    compliant: 413,
    noncompliant: 12,
    unresolved: 5,
    notApplicable: 32,
  });
  assert.deepEqual(
    inventory.projectDatabase.methods
      .filter((method) => method.policyReason === 'direct-coordinator-call-observed-boundary-not-proven')
      .map((method) => method.name),
    STRICT_BOUNDARY_UNRESOLVED_METHODS,
  );
  assert.deepEqual(
    inventory.projectDatabase.methods
      .filter((method) => method.policyReason === 'internal-coordinator-transaction-assertion-proven')
      .map((method) => method.name),
    INTERNAL_COORDINATOR_ASSERTED_METHODS,
  );
  assert.deepEqual(
    inventory.projectDatabase.methods
      .filter((method) => method.policyReason === 'internal-existing-transaction-assertion-proven')
      .map((method) => method.name),
    INTERNAL_EXISTING_TRANSACTION_ASSERTED_METHODS,
  );
  assert.deepEqual(inventory.writerPolicy.unresolvedInternalMethods, INTERNAL_UNRESOLVED_METHODS);
  assert.equal(inventory.writerPolicy.externalRawEntryCount, 0);
  assert.equal(inventory.writerPolicy.externalRawUnclassifiedCount, 0);
});

test('ProjectDatabase inventory freezes structure and selected known direct writers', () => {
  const inventory = report().projectDatabase;
  assert.equal(inventory.file, 'backend/src/services/projectDatabase.js');
  assert.equal(inventory.className, 'ProjectDatabase');
  assert.equal(inventory.methods.length, inventory.methodCount);
  assert.equal(inventory.methodCount, 462);

  for (const method of inventory.methods) {
    assert.equal(typeof method.name, 'string');
    assert.equal(typeof method.definitionResolved, 'boolean');
    assert.equal(typeof method.internalTransactionAssertion.proven, 'boolean');
    assert.ok(Array.isArray(method.internalTransactionAssertion.failureReasons));
    assert.deepEqual(
      method.internalTransactionAssertion.allowedContexts,
      ['coordinator', 'existing-transaction'],
    );
    assert.equal(typeof method.internalTransactionProof.proven, 'boolean');
    assert.ok(Array.isArray(method.internalTransactionProof.failureReasons));
    assert.ok(Array.isArray(method.internalTransactionProof.unsafeCallees));
    assert.equal(typeof method.line, 'number');
    assert.equal(typeof method.endLine, 'number');
    assert.equal(typeof method.direct.runCount, 'number');
    assert.equal(typeof method.direct.execCount, 'number');
    assert.equal(typeof method.direct.writePragmaCount, 'number');
    assert.equal(typeof method.direct.filesystemMutationCount, 'number');
    assert.equal(typeof method.direct.mutationQueryCount, 'number');
    assert.equal(typeof method.direct.transactionFactoryCount, 'number');
    assert.equal(typeof method.direct.storageCapacityTranslationCount, 'number');
    assert.equal(typeof method.direct.databaseEffectCount, 'number');
    assert.ok(Array.isArray(method.direct.databaseEffectSites));
    assert.equal(typeof method.direct.coordinatorCallCount, 'number');
    assert.ok(Array.isArray(method.direct.coordinatorCalls));
    assert.equal(typeof method.direct.dynamicProjectDatabaseCallCount, 'number');
    assert.ok(Array.isArray(method.direct.transactionTypes));
    assert.ok(Array.isArray(method.direct.storageCapacityTranslations));
    assert.ok(Array.isArray(method.calledProjectDatabaseMethods));
    assert.equal(typeof method.calledProjectDatabaseMethodCallCount, 'number');
    assert.ok(Array.isArray(method.calledProjectDatabaseMethodCalls));
    assert.ok(METHOD_CLASSIFICATION_CATEGORIES.includes(method.classification));
    assert.equal(typeof method.policyApplicable, 'boolean');
    assert.ok([true, false, null].includes(method.policyCompliant));
    assert.equal(typeof method.policyReason, 'string');
    assert.equal(typeof method.coordinatorBoundaryProof.proven, 'boolean');
    assert.ok(Array.isArray(method.coordinatorBoundaryProof.failureReasons));
  }

  const configure = methodNamed('configure');
  assert.deepEqual(
    configure.direct.writePragmas.map((entry) => entry.pragma),
    ['journal_mode = WAL', 'foreign_keys = ON', 'busy_timeout = 5000'],
  );

  assertExactSelfWrappedOperation('applyOperations', 'canvas.operations.apply');
  assertExactSelfWrappedOperation('ensureCanvas', 'canvas.ensure');
  assert.equal(methodNamed('ensureCanvas').direct.storageCapacityTranslationCount, 0);
  assertExactSelfWrappedOperation('restoreCanvasSnapshot', 'canvas.snapshot-restore');
  const restoreCanvasSnapshot = methodNamed('restoreCanvasSnapshot');
  assert.equal(restoreCanvasSnapshot.direct.storageCapacityTranslationCount, 1);

  const coordinator = methodNamed('withProjectDatabaseWrite');
  assert.deepEqual(coordinator.direct.transactionTypes, ['immediate']);
  assert.equal(coordinator.direct.storageCapacityTranslationCount, 2);

  for (const [methodName, operation] of [
    ['createNodeRun', 'run.node-create'],
    ['updateNodeRun', 'run.node-update'],
    ['createAttempt', 'run.attempt-create'],
    ['updateAttempt', 'run.attempt-update'],
  ]) assertExactSelfWrappedOperation(methodName, operation);

  for (const [methodName, operation] of [
    ['createRunIntent', 'collaboration.run-intent.reserve'],
    ['acceptRunIntentForDispatch', 'collaboration.run-intent.accept'],
    ['transitionRunIntentQueueState', 'collaboration.run-intent.update'],
    ['leaseRunIntentForDispatch', 'collaboration.run-intent.lease'],
    ['renewRunIntentDispatchLease', 'collaboration.run-intent.lease-renew'],
    ['returnRunIntentToPendingConfirmation', 'collaboration.run-intent.confirmation-requeue'],
    ['releaseRunIntentDispatchLease', 'collaboration.run-intent.lease-release'],
    ['requestRunIntentCancellation', 'collaboration.run-intent.cancel'],
    ['claimRunIntent', 'run-intent.claim'],
    ['finishRunIntentForRun', 'run-intent.finish'],
  ]) assertExactSelfWrappedOperation(methodName, operation);

  for (const methodName of [
    'syncCanvasDocumentResourceGrants',
    'initializeCanvasResourceGrantsForSharing',
    'ensureCanvasResourceGrantState',
    'grantCanvasAssetResource',
    'grantCanvasSubflowResource',
    'createInvite',
  ]) {
    const resourceWriter = methodNamed(methodName);
    assert.equal(resourceWriter.classification, 'write');
    assertDirectCoordinatorPolicy(methodName);
    assert.equal(resourceWriter.direct.transactionFactoryCount, 0);
    assert.ok(resourceWriter.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));
  }

  for (const methodName of [
    'recoverInterruptedAssetUploadSessions',
    'expireAssetUploadSessions',
    'purgeAssetUploadChunks',
  ]) {
    const uploadMaintenanceWriter = methodNamed(methodName);
    assert.equal(uploadMaintenanceWriter.classification, 'maintenance');
    assertDirectCoordinatorPolicy(methodName);
    assert.equal(uploadMaintenanceWriter.direct.transactionFactoryCount, 0);
    assert.ok(uploadMaintenanceWriter.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));
  }

  for (const methodName of ['getAssetCatalogRevision', 'getAssetAccessPolicy']) {
    const pureDefaultMetadataRead = methodNamed(methodName);
    assert.equal(pureDefaultMetadataRead.classification, 'read');
    assert.equal(pureDefaultMetadataRead.policyCompliant, true);
    assert.equal(pureDefaultMetadataRead.hasDirectSqlMutationCandidate, false);
    assert.equal(pureDefaultMetadataRead.direct.runCount, 0);
    assert.equal(pureDefaultMetadataRead.direct.transactionFactoryCount, 0);
  }

  const setAssetAccessPolicy = methodNamed('setAssetAccessPolicy');
  assert.equal(setAssetAccessPolicy.classification, 'write');
  assertDirectCoordinatorPolicy('setAssetAccessPolicy');
  assert.equal(setAssetAccessPolicy.direct.transactionFactoryCount, 0);
  assert.ok(setAssetAccessPolicy.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));

  const duplicateCompute = methodNamed('_computeAssetDuplicateCandidates');
  assert.equal(duplicateCompute.classification, 'read');
  assert.equal(duplicateCompute.hasDirectSqlMutationCandidate, false);
  assert.equal(duplicateCompute.direct.runCount, 0);
  assert.equal(duplicateCompute.direct.transactionFactoryCount, 0);

  const duplicateList = methodNamed('listAssetDuplicates');
  assert.equal(duplicateList.classification, 'read');
  assert.equal(duplicateList.policyCompliant, true);
  assert.equal(duplicateList.hasDirectSqlMutationCandidate, false);
  assert.equal(duplicateList.direct.runCount, 0);
  assert.equal(duplicateList.direct.transactionFactoryCount, 0);
  assert.equal(duplicateList.calledProjectDatabaseMethods.includes('_computeAssetDuplicateCandidates'), false);
  assert.equal(duplicateList.calledProjectDatabaseMethods.includes('refreshAssetDuplicateCandidates'), false);
  assert.equal(duplicateList.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'), false);

  for (const methodName of ['refreshAssetDuplicateCandidates', 'setAssetDuplicateDecision']) {
    const duplicateWriter = methodNamed(methodName);
    assert.equal(
      duplicateWriter.classification,
      methodName === 'refreshAssetDuplicateCandidates' ? 'maintenance' : 'write',
    );
    assertDirectCoordinatorPolicy(methodName);
    assert.equal(duplicateWriter.direct.transactionFactoryCount, 0);
    assert.ok(duplicateWriter.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));
  }

  const retention = methodNamed('setRunRetentionPolicy');
  assertDirectCoordinatorPolicy('setRunRetentionPolicy');
  assert.equal(retention.direct.transactionFactoryCount, 0);
  assert.ok(retention.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));

  const pruneRuns = methodNamed('pruneRuns');
  assertDirectCoordinatorPolicy('pruneRuns');
  assert.equal(pruneRuns.direct.transactionFactoryCount, 0);
  assert.ok(pruneRuns.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));
  assert.deepEqual(pruneRuns.direct.writePragmas, []);
  assert.equal(pruneRuns.coordinatorBoundaryProof.uncoveredEffectCount, 0);
  assert.equal(pruneRuns.direct.execCalls.some((entry) => /VACUUM/.test(entry.snippet)), false);

  const recordRunOutputAssets = methodNamed('recordRunOutputAssets');
  assertDirectCoordinatorPolicy('recordRunOutputAssets');
  assert.equal(recordRunOutputAssets.direct.transactionFactoryCount, 0);
  assert.ok(recordRunOutputAssets.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));

  const rotateSession = methodNamed('rotateSession');
  assertDirectCoordinatorPolicy('rotateSession');
  assert.equal(rotateSession.direct.transactionFactoryCount, 0);
  assert.ok(rotateSession.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));

  const getSession = methodNamed('getSession');
  assert.equal(getSession.classification, 'read');
  assert.equal(getSession.policyCompliant, true);
  assert.equal(getSession.direct.transactionFactoryCount, 0);
  assert.equal(getSession.direct.runCount, 0);
  assert.equal(getSession.hasDirectPersistentMutationCandidate, false);
  assert.equal(getSession.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'), false);

  const activeUploadDiscovery = methodNamed('listActiveAssetUploadSessionIds');
  assert.equal(activeUploadDiscovery.classification, 'read');
  assert.equal(activeUploadDiscovery.policyCompliant, true);
  assert.equal(activeUploadDiscovery.hasDirectPersistentMutationCandidate, false);
  assert.equal(activeUploadDiscovery.direct.runCount, 0);
  assert.equal(activeUploadDiscovery.direct.transactionFactoryCount, 0);
  assert.equal(activeUploadDiscovery.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'), false);

  const heartbeatSession = methodNamed('heartbeatSession');
  assert.equal(heartbeatSession.classification, 'write');
  assertDirectCoordinatorPolicy('heartbeatSession');
  assert.equal(heartbeatSession.direct.transactionFactoryCount, 0);
  assert.equal(heartbeatSession.direct.runCount, 1);
  assert.ok(heartbeatSession.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));

  for (const methodName of [
    'enqueueAssetPreviewJob',
    'claimNextAssetPreviewJob',
    'patchAssetPreviewState',
    'completeAssetPreviewJob',
    'rescheduleAssetPreviewJob',
    'retryAssetPreviewJobs',
    'recoverAssetPreviewJobs',
  ]) {
    const previewWriter = methodNamed(methodName);
    assert.equal(previewWriter.direct.transactionFactoryCount, 0);
    assert.ok(previewWriter.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));
  }

  for (const methodName of ['removeAssetIndex', 'markAssetBlobDeleted']) {
    const assetDeleteWriter = methodNamed(methodName);
    assert.equal(assetDeleteWriter.direct.transactionFactoryCount, 0);
    assert.ok(assetDeleteWriter.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));
  }

  for (const methodName of ['getRecoveryGeneration', 'requiresRecoveryGeneration', 'syncCanvas']) {
    const generationRead = methodNamed(methodName);
    assert.equal(generationRead.classification, 'read');
    assert.equal(generationRead.policyCompliant, true);
    assert.equal(generationRead.hasDirectPersistentMutationCandidate, false);
    assert.equal(generationRead.direct.runCount, 0);
    assert.equal(generationRead.direct.transactionFactoryCount, 0);
  }

  const generationObserver = methodNamed('_readRecoveryGenerationState');
  assert.equal(generationObserver.classification, 'read');
  assert.equal(generationObserver.policyCompliant, true);
  assert.equal(generationObserver.direct.filesystemMutationCount, 0);

  for (const methodName of ['bootstrapRecoveryGeneration', 'rotateRecoveryGeneration']) {
    const generationMaintenance = methodNamed(methodName);
    assert.equal(generationMaintenance.classification, 'maintenance');
    assert.equal(generationMaintenance.direct.transactionTypes.includes('immediate'), true);
  }

  for (const methodName of ['getAssetAvailabilitySnapshot', 'listAssetAvailabilitySnapshots']) {
    const availabilityRead = methodNamed(methodName);
    assert.equal(availabilityRead.classification, 'read');
    assert.equal(availabilityRead.policyCompliant, true);
    assert.equal(availabilityRead.hasDirectSqlMutationCandidate, false);
    assert.equal(availabilityRead.direct.runCount, 0);
    assert.equal(availabilityRead.direct.transactionFactoryCount, 0);
  }

  const availabilityWriter = methodNamed('syncAssetAvailabilityObservations');
  assert.equal(availabilityWriter.classification, 'maintenance');
  assertDirectCoordinatorPolicy('syncAssetAvailabilityObservations');
  assert.equal(availabilityWriter.direct.transactionFactoryCount, 0);
  assert.ok(availabilityWriter.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));

  const semanticObservation = methodNamed('getAssetSemanticModelObservation');
  assert.equal(semanticObservation.classification, 'read');
  assert.equal(semanticObservation.policyCompliant, true);

  for (const methodName of ['setAssetSemanticModelState', 'syncAssetSemanticModelObservations']) {
    const semanticWriter = methodNamed(methodName);
    assert.equal(semanticWriter.classification, 'write');
    assertDirectCoordinatorPolicy(methodName);
  }

  const semanticRecovery = methodNamed('recoverInterruptedAssetSemanticJobs');
  assert.equal(semanticRecovery.classification, 'maintenance');
  assertDirectCoordinatorPolicy('recoverInterruptedAssetSemanticJobs');
  assert.equal(semanticRecovery.direct.transactionFactoryCount, 0);
  assert.ok(semanticRecovery.calledProjectDatabaseMethods.includes('withProjectDatabaseWrite'));

  for (const methodName of ['_migrateSchema30To31', 'migrateSchema31Down']) {
    const migration = methodNamed(methodName);
    assert.equal(migration.classification, 'migration');
    assert.equal(migration.policyApplicable, false);
    assert.equal(migration.policyCompliant, null);
  }
});

test('classification manifest fails closed for source drift, duplicate entries and unknown categories', () => {
  const projectDatabase = inventoryProjectDatabase(ROOT);
  const loaded = loadProjectDatabaseMethodClassification(ROOT);
  const baseline = classifyProjectDatabaseMethods(projectDatabase, loaded);
  assert.equal(baseline.classification.classificationComplete, true);
  assert.equal(baseline.classification.classificationGatePassed, true);

  const addedMethod = {
    ...projectDatabase.methods[0],
    name: 'newUnclassifiedWriterForGateTest',
    line: projectDatabase.methods.at(-1).endLine + 1,
    endLine: projectDatabase.methods.at(-1).endLine + 2,
  };
  const sourceDrift = classifyProjectDatabaseMethods({
    ...projectDatabase,
    methods: [...projectDatabase.methods, addedMethod],
    methodCount: projectDatabase.methodCount + 1,
  }, loaded);
  assert.equal(sourceDrift.classification.classificationComplete, false);
  assert.deepEqual(
    sourceDrift.classification.issues.filter((issue) => issue.code === 'unclassified-source-method'),
    [{ code: 'unclassified-source-method', name: addedMethod.name }],
  );

  const duplicateManifest = structuredClone(loaded.manifest);
  duplicateManifest.categories.read.push(duplicateManifest.categories.write[0]);
  duplicateManifest.categories.experimental = ['never-accepted'];
  const manifestDrift = classifyProjectDatabaseMethods(projectDatabase, duplicateManifest);
  assert.equal(manifestDrift.classification.classificationComplete, false);
  assert.ok(manifestDrift.classification.issues.some((issue) => (
    issue.code === 'duplicate-manifest-method' && issue.name === 'withProjectDatabaseWrite'
  )));
  assert.ok(manifestDrift.classification.issues.some((issue) => (
    issue.code === 'unexpected-category' && issue.category === 'experimental'
  )));

  const changedRead = projectDatabase.methods.map((method) => (
    method.name === 'getAsset'
      ? { ...method, hasDirectPersistentMutationCandidate: true }
      : method
  ));
  const readDrift = classifyProjectDatabaseMethods({ ...projectDatabase, methods: changedRead }, loaded);
  assert.equal(readDrift.classification.classificationComplete, true);
  assert.equal(readDrift.classification.classificationConsistent, false);
  assert.equal(readDrift.classification.classificationGatePassed, false);
  assert.deepEqual(readDrift.classification.consistencyIssues, [{
    code: 'read-has-direct-persistent-mutation-candidate',
    name: 'getAsset',
  }]);
});

test('direct coordinator policy proves only strict inline synchronous callback containment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-writer-inline-boundary-'));
  const services = path.join(root, 'backend', 'src', 'services');
  fs.mkdirSync(services, { recursive: true });
  try {
    fs.writeFileSync(path.join(services, 'projectDatabase.js'), `
      const fs = require('node:fs');
      class ProjectDatabase {
        withProjectDatabaseWrite(operation, callback) { return callback(); }
        _internalWriter() { return this.db.prepare('UPDATE example SET value = 1').run(); }
        inlineDirect() {
          return this.withProjectDatabaseWrite('inline.direct', () => {
            return this.db.prepare('UPDATE example SET value = 2').run();
          });
        }
        inlineStateful() {
          return this.withProjectDatabaseWrite('inline.stateful', () => this._internalWriter());
        }
        writeBefore() {
          this.db.prepare('UPDATE example SET value = 3').run();
          return this.withProjectDatabaseWrite('outside.before', () => 1);
        }
        writeAfter() {
          this.withProjectDatabaseWrite('outside.after', () => 1);
          return this.db.prepare('UPDATE example SET value = 4').run();
        }
        deadBranch() {
          if (false) this.withProjectDatabaseWrite('dead.branch', () => 1);
          return this.db.prepare('UPDATE example SET value = 5').run();
        }
        namedCallback() {
          const persist = () => this.db.prepare('UPDATE example SET value = 6').run();
          return this.withProjectDatabaseWrite('named.callback', persist);
        }
        asyncCallback() {
          return this.withProjectDatabaseWrite('async.callback', async () => {
            return this.db.prepare('UPDATE example SET value = 7').run();
          });
        }
        generatorCallback() {
          return this.withProjectDatabaseWrite('generator.callback', function* () {
            return this.db.prepare('UPDATE example SET value = 8').run();
          });
        }
        promiseCallback() {
          return this.withProjectDatabaseWrite('promise.callback', () => (
            Promise.resolve().then(() => this.db.prepare('UPDATE example SET value = 9').run())
          ));
        }
        timeoutCallback() {
          return this.withProjectDatabaseWrite('timeout.callback', () => (
            setTimeout(() => this.db.prepare('UPDATE example SET value = 10').run(), 0)
          ));
        }
        nestedCallback() {
          return this.withProjectDatabaseWrite('nested.callback', () => {
            [1].map((value) => value);
            return this.db.prepare('UPDATE example SET value = 11').run();
          });
        }
        dynamicCoordinatorAlias() {
          const coordinate = this.withProjectDatabaseWrite.bind(this);
          return coordinate('dynamic.alias', () => (
            this.db.prepare('UPDATE example SET value = 12').run()
          ));
        }
        externalCallback(callback) {
          return this.withProjectDatabaseWrite('external.callback', callback);
        }
        statefulOutside() {
          this._internalWriter();
          return this.withProjectDatabaseWrite('stateful.outside', () => 1);
        }
        filesystemInside() {
          return this.withProjectDatabaseWrite('filesystem.inside', () => {
            fs.writeFileSync('sidecar.json', '{}');
            return this.db.prepare('UPDATE example SET value = 13').run();
          });
        }
        rawTransactionInside() {
          return this.withProjectDatabaseWrite('raw.transaction', () => (
            this.db.transaction(() => this.db.prepare('UPDATE example SET value = 14').run()).immediate()
          ));
        }
        dynamicProjectDatabaseCall(methodName) {
          return this.withProjectDatabaseWrite('dynamic.method', () => {
            this[methodName]();
            return this.db.prepare('UPDATE example SET value = 15').run();
          });
        }
      }
    `);
    const parsed = inventoryProjectDatabase(root);
    const methodNames = parsed.methods.map((method) => method.name);
    const manifest = {
      manifestVersion: 1,
      sourceFile: 'backend/src/services/projectDatabase.js',
      classificationSemantics: 'persistent-side-effect',
      categories: {
        read: [],
        write: methodNames,
        maintenance: [],
        migration: [],
        'test-only': [],
      },
    };
    const classified = classifyProjectDatabaseMethods(parsed, manifest);
    assert.equal(classified.classification.classificationComplete, true);
    const annotated = annotateProjectDatabaseWriterPolicy(
      classified.projectDatabase,
      true,
      { entryCount: 0, entries: [] },
    ).projectDatabase;
    const named = (name) => annotated.methods.find((method) => method.name === name);

    for (const name of ['inlineDirect', 'inlineStateful']) {
      assert.equal(named(name).policyCompliant, true, name);
      assert.equal(named(name).policyReason, 'direct-coordinator-boundary-proven', name);
      assert.equal(named(name).coordinatorBoundaryProof.proven, true, name);
      assert.equal(named(name).coordinatorBoundaryProof.uncoveredEffectCount, 0, name);
    }

    for (const name of [
      'writeBefore',
      'writeAfter',
      'deadBranch',
      'namedCallback',
      'asyncCallback',
      'generatorCallback',
      'promiseCallback',
      'timeoutCallback',
      'nestedCallback',
      'dynamicCoordinatorAlias',
      'externalCallback',
      'statefulOutside',
      'filesystemInside',
      'rawTransactionInside',
      'dynamicProjectDatabaseCall',
    ]) {
      assert.equal(named(name).policyCompliant, null, name);
      assert.equal(named(name).policyReason, 'direct-coordinator-call-observed-boundary-not-proven', name);
      assert.equal(named(name).coordinatorBoundaryProof.proven, false, name);
    }
    for (const name of ['writeBefore', 'writeAfter', 'deadBranch', 'statefulOutside']) {
      assert.ok(
        named(name).coordinatorBoundaryProof.failureReasons.includes(
          'effect-outside-eligible-coordinator-callback',
        ),
        name,
      );
    }
    for (const name of ['asyncCallback', 'generatorCallback', 'promiseCallback', 'timeoutCallback', 'nestedCallback']) {
      assert.ok(
        named(name).coordinatorBoundaryProof.failureReasons.includes(
          'coordinator-callback-not-strictly-synchronous-inline',
        ),
        name,
      );
    }
    assert.ok(named('dynamicCoordinatorAlias').coordinatorBoundaryProof.failureReasons.includes(
      'no-exact-inline-coordinator-call',
    ));
    assert.ok(named('filesystemInside').coordinatorBoundaryProof.failureReasons.includes(
      'filesystem-mutation-observed',
    ));
    assert.ok(named('rawTransactionInside').coordinatorBoundaryProof.failureReasons.includes(
      'raw-transaction-observed',
    ));
    assert.ok(named('dynamicProjectDatabaseCall').coordinatorBoundaryProof.failureReasons.includes(
      'dynamic-project-database-call-observed',
    ));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('internal transaction proof accepts only one exact synchronous first-statement assertion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-writer-internal-transaction-'));
  const services = path.join(root, 'backend', 'src', 'services');
  fs.mkdirSync(services, { recursive: true });
  try {
    fs.writeFileSync(path.join(services, 'projectDatabase.js'), `
      const fs = require('node:fs');
      class ProjectDatabase {
        _assertProjectDatabaseMutationTransaction(context) { return context; }
        _coordinatorFirst() {
          this._assertProjectDatabaseMutationTransaction('coordinator');
          return this.db.prepare('UPDATE example SET value = 1').run();
        }
        _existingTransactionFirst() {
          this._assertProjectDatabaseMutationTransaction('existing-transaction');
          return this.db.prepare('UPDATE example SET value = 2').run();
        }
        _conditionalAssertion(flag) {
          if (flag) this._assertProjectDatabaseMutationTransaction('coordinator');
          return this.db.prepare('UPDATE example SET value = 3').run();
        }
        _lateAssertion() {
          const value = 4;
          this._assertProjectDatabaseMutationTransaction('coordinator');
          return this.db.prepare('UPDATE example SET value = ?').run(value);
        }
        async _asyncAssertion() {
          this._assertProjectDatabaseMutationTransaction('coordinator');
          return this.db.prepare('UPDATE example SET value = 5').run();
        }
        _dynamicAliasAssertion() {
          const assertTransaction = this._assertProjectDatabaseMutationTransaction.bind(this);
          assertTransaction('coordinator');
          return this.db.prepare('UPDATE example SET value = 6').run();
        }
        _computedAssertion() {
          this['_assertProjectDatabaseMutationTransaction']('coordinator');
          return this.db.prepare('UPDATE example SET value = 7').run();
        }
        _invalidContext() {
          this._assertProjectDatabaseMutationTransaction('anything-goes');
          return this.db.prepare('UPDATE example SET value = 8').run();
        }
        _dynamicContext(context) {
          this._assertProjectDatabaseMutationTransaction(context);
          return this.db.prepare('UPDATE example SET value = 9').run();
        }
        _multipleAssertions() {
          this._assertProjectDatabaseMutationTransaction('coordinator');
          this._assertProjectDatabaseMutationTransaction('coordinator');
          return this.db.prepare('UPDATE example SET value = 10').run();
        }
        _filesystemAssertion() {
          this._assertProjectDatabaseMutationTransaction('coordinator');
          fs.writeFileSync('outside-database.txt', 'forbidden');
          return this.db.prepare('UPDATE example SET value = 11').run();
        }
        _rawTransactionAssertion() {
          this._assertProjectDatabaseMutationTransaction('coordinator');
          return this.db.transaction(() => (
            this.db.prepare('UPDATE example SET value = 12').run()
          )).immediate();
        }
        _filesystemHelper() {
          fs.writeFileSync('transitive-outside-database.txt', 'forbidden');
        }
        _transitiveFilesystemAssertion() {
          this._assertProjectDatabaseMutationTransaction('coordinator');
          this._filesystemHelper();
          return this.db.prepare('UPDATE example SET value = 13').run();
        }
        publicSpoof() {
          this._assertProjectDatabaseMutationTransaction('coordinator');
          return this.db.prepare('UPDATE example SET value = 14').run();
        }
      }
    `);
    const parsed = inventoryProjectDatabase(root);
    const assertionName = '_assertProjectDatabaseMutationTransaction';
    const methodNames = parsed.methods.map((method) => method.name);
    const manifest = {
      manifestVersion: 1,
      sourceFile: 'backend/src/services/projectDatabase.js',
      classificationSemantics: 'persistent-side-effect',
      categories: {
        read: [assertionName],
        write: methodNames.filter((name) => name !== assertionName),
        maintenance: [],
        migration: [],
        'test-only': [],
      },
    };
    const classified = classifyProjectDatabaseMethods(parsed, manifest);
    assert.equal(classified.classification.classificationComplete, true);
    assert.equal(classified.classification.classificationConsistent, true);
    const annotated = annotateProjectDatabaseWriterPolicy(
      classified.projectDatabase,
      true,
      { entryCount: 0, entries: [] },
    ).projectDatabase;
    const named = (name) => annotated.methods.find((method) => method.name === name);

    assert.equal(named('_coordinatorFirst').policyCompliant, true);
    assert.equal(
      named('_coordinatorFirst').policyReason,
      'internal-coordinator-transaction-assertion-proven',
    );
    assert.equal(named('_coordinatorFirst').internalTransactionAssertion.context, 'coordinator');
    assert.equal(named('_existingTransactionFirst').policyCompliant, true);
    assert.equal(
      named('_existingTransactionFirst').policyReason,
      'internal-existing-transaction-assertion-proven',
    );
    assert.equal(
      named('_existingTransactionFirst').internalTransactionAssertion.context,
      'existing-transaction',
    );

    for (const name of [
      '_conditionalAssertion',
      '_lateAssertion',
      '_asyncAssertion',
      '_dynamicAliasAssertion',
      '_computedAssertion',
      '_invalidContext',
      '_dynamicContext',
      '_multipleAssertions',
    ]) {
      assert.equal(named(name).policyCompliant, null, name);
      assert.equal(named(name).policyReason, 'internal-caller-boundary-not-statically-proven', name);
      assert.equal(named(name).internalTransactionAssertion.proven, false, name);
    }
    for (const name of [
      '_filesystemAssertion',
      '_rawTransactionAssertion',
      '_transitiveFilesystemAssertion',
    ]) {
      assert.equal(named(name).policyCompliant, null, name);
      assert.equal(named(name).policyReason, 'internal-caller-boundary-not-statically-proven', name);
      assert.equal(named(name).internalTransactionAssertion.proven, true, name);
      assert.equal(named(name).internalTransactionProof.proven, false, name);
    }
    assert.ok(named('_conditionalAssertion').internalTransactionAssertion.failureReasons.includes(
      'assertion-not-first-direct-statement',
    ));
    assert.ok(named('_lateAssertion').internalTransactionAssertion.failureReasons.includes(
      'assertion-not-first-direct-statement',
    ));
    assert.ok(named('_asyncAssertion').internalTransactionAssertion.failureReasons.includes('method-async'));
    assert.ok(named('_dynamicAliasAssertion').internalTransactionAssertion.failureReasons.includes(
      'exact-assertion-call-missing',
    ));
    assert.ok(named('_computedAssertion').internalTransactionAssertion.failureReasons.includes(
      'exact-assertion-call-missing',
    ));
    assert.ok(named('_invalidContext').internalTransactionAssertion.failureReasons.includes(
      'assertion-context-invalid',
    ));
    assert.ok(named('_dynamicContext').internalTransactionAssertion.failureReasons.includes(
      'assertion-context-not-string-literal',
    ));
    assert.ok(named('_multipleAssertions').internalTransactionAssertion.failureReasons.includes(
      'multiple-exact-assertion-calls',
    ));
    assert.ok(named('_filesystemAssertion').internalTransactionProof.failureReasons.includes(
      'filesystem-mutation-observed',
    ));
    assert.ok(named('_rawTransactionAssertion').internalTransactionProof.failureReasons.includes(
      'raw-transaction-observed',
    ));
    assert.ok(named('_transitiveFilesystemAssertion').internalTransactionProof.failureReasons.includes(
      'unsafe-transitive-callee-observed',
    ));
    assert.deepEqual(named('_transitiveFilesystemAssertion').internalTransactionProof.unsafeCallees, [{
      path: ['_transitiveFilesystemAssertion', '_filesystemHelper'],
      hazards: ['filesystem-mutation'],
    }]);
    assert.equal(named('publicSpoof').policyCompliant, false);
    assert.equal(named('publicSpoof').policyReason, 'public-stateful-method-without-direct-coordinator');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('real parser and external inventory fail closed for static aliases, bound members and fluent RETURNING writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-writer-inventory-parser-'));
  const services = path.join(root, 'backend', 'src', 'services');
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(services, { recursive: true });
  fs.mkdirSync(scripts, { recursive: true });
  try {
    fs.writeFileSync(path.join(services, 'projectDatabase.js'), `
      const fs = require('node:fs');
      const { writeFileSync: persistSidecar } = fs;
      const { openSync: openSidecar } = fs;
      class ProjectDatabase {
        normalRead() { return 1; }
        readOnlyOpen() { return fs.openSync('sidecar.json', 'r'); }
        readOnlyOpenAlias() { return openSidecar('sidecar.json', 'rs'); }
        dynamicOpen(flags) { return fs.openSync('sidecar.json', flags); }
        aliasedDbRead() {
          const owner = this;
          const db = owner.db;
          const update = db.prepare('UPDATE example SET value = 1 RETURNING value').pluck();
          const transaction = db.transaction(() => update.get());
          return transaction.immediate();
        }
        destructuredFsRead() { persistSidecar('sidecar.json', '{}'); }
        delegatedRead() { return this.writer.call(this); }
        writer() { return this.db.prepare('UPDATE example SET value = 2').run(); }
        boundWriter = this.writer.bind(this);
        bareFieldAlias = this.writer;
        shadowedStatementsRead() {
          { const statement = this.db.prepare('UPDATE example SET value = 4 RETURNING value'); statement.get(); }
          { const statement = this.db.prepare('SELECT value FROM example'); statement.get(); }
        }
        fieldWriter = () => { fs.writeFileSync('sidecar.json', '{}'); };
      }
      const { prototype: projectDatabasePrototype } = ProjectDatabase;
      let assignedPrototype;
      ({ prototype: assignedPrototype } = ProjectDatabase);
      projectDatabasePrototype.prototypeWriter = function prototypeWriter() {
        return this.db.prepare('UPDATE example SET value = 3 RETURNING value').get();
      };
      projectDatabasePrototype.readAlias = ProjectDatabase.prototype.writer;
      assignedPrototype.assignedPrototypeAlias = assignedPrototype.writer;
      const define = Object.defineProperty;
      define(projectDatabasePrototype, 'definedAlias', {
        value: ProjectDatabase.prototype.writer,
      });
      Reflect.defineProperty(projectDatabasePrototype, 'reflectAlias', {
        value: ProjectDatabase.prototype.writer,
      });
      const boundDefine = Object.defineProperty.bind(Object);
      boundDefine(projectDatabasePrototype, 'boundDefineAlias', {
        value: ProjectDatabase.prototype.writer,
      });
      define.call(Object, projectDatabasePrototype, 'calledDefineAlias', {
        value: ProjectDatabase.prototype.writer,
      });
      define.apply(Object, [projectDatabasePrototype, 'appliedDefineAlias', {
        value: ProjectDatabase.prototype.writer,
      }]);
      define(projectDatabasePrototype, 'lastDescriptorAlias', {
        value: function safeRead() { return 1; },
        value: ProjectDatabase.prototype.writer,
      });
      define(projectDatabasePrototype, 'spreadDescriptorAlias', {
        value: ProjectDatabase.prototype.writer,
        ...runtimeDescriptor,
      });
      define(projectDatabasePrototype, 'descriptorGetterAlias', {
        get value() { return ProjectDatabase.prototype.writer; },
      });
      Object.defineProperties(projectDatabasePrototype, {
        multiAlias: { value: ProjectDatabase.prototype.writer },
      });
      const runtimeSource = loadRuntimeSource();
      Object.assign(
        ProjectDatabase.prototype,
        { assignedFromFirst() { return this.writer.apply(this, []); } },
        runtimeSource,
        { assignedFromSecond() { return 2; } },
        { get getterAlias() { return ProjectDatabase.prototype.writer; } },
        { ...runtimeSource },
      );
    `);
    const parsed = inventoryProjectDatabase(root);
    const parsedNames = parsed.methods.map((method) => method.name);
    for (const name of [
      'aliasedDbRead',
      'appliedDefineAlias',
      'assignedFromFirst',
      'assignedFromSecond',
      'assignedPrototypeAlias',
      'bareFieldAlias',
      'boundDefineAlias',
      'boundWriter',
      'calledDefineAlias',
      'delegatedRead',
      'descriptorGetterAlias',
      'definedAlias',
      'destructuredFsRead',
      'fieldWriter',
      'getterAlias',
      'lastDescriptorAlias',
      'multiAlias',
      'normalRead',
      'readOnlyOpen',
      'readOnlyOpenAlias',
      'dynamicOpen',
      'prototypeWriter',
      'readAlias',
      'reflectAlias',
      'shadowedStatementsRead',
      'spreadDescriptorAlias',
      'writer',
    ]) assert.ok(parsedNames.includes(name), `expected callable member ${name}`);
    const unresolvedNames = parsedNames.filter((name) => name.startsWith('<dynamic-prototype-assign@'));
    assert.equal(unresolvedNames.length, 2);
    assert.equal(parsed.methods.find((method) => method.name === 'fieldWriter').kind, 'field-function');
    assert.equal(parsed.methods.find((method) => method.name === 'fieldWriter').direct.filesystemMutationCount, 1);
    assert.equal(parsed.methods.find((method) => method.name === 'boundWriter').kind, 'field-bound-method');
    assert.deepEqual(
      parsed.methods.find((method) => method.name === 'boundWriter').calledProjectDatabaseMethods,
      ['writer'],
    );
    assert.equal(parsed.methods.find((method) => method.name === 'bareFieldAlias').kind, 'field-method-alias');
    assert.deepEqual(
      parsed.methods.find((method) => method.name === 'bareFieldAlias').calledProjectDatabaseMethods,
      ['writer'],
    );
    assert.ok(parsed.methods.find((method) => method.name === 'shadowedStatementsRead').direct.mutationQueryCount >= 1);
    assert.equal(parsed.methods.find((method) => method.name === 'aliasedDbRead').direct.mutationQueryCount, 1);
    assert.deepEqual(
      parsed.methods.find((method) => method.name === 'aliasedDbRead').direct.transactionTypes,
      ['immediate'],
    );
    assert.equal(parsed.methods.find((method) => method.name === 'destructuredFsRead').direct.filesystemMutationCount, 1);
    assert.equal(parsed.methods.find((method) => method.name === 'readOnlyOpen').direct.filesystemMutationCount, 0);
    assert.equal(parsed.methods.find((method) => method.name === 'readOnlyOpenAlias').direct.filesystemMutationCount, 0);
    assert.equal(parsed.methods.find((method) => method.name === 'dynamicOpen').direct.filesystemMutationCount, 1);
    assert.deepEqual(
      parsed.methods.find((method) => method.name === 'delegatedRead').calledProjectDatabaseMethods,
      ['writer'],
    );
    assert.deepEqual(
      parsed.methods.find((method) => method.name === 'assignedFromFirst').calledProjectDatabaseMethods,
      ['writer'],
    );
    for (const name of [
      'appliedDefineAlias', 'assignedPrototypeAlias', 'boundDefineAlias', 'calledDefineAlias',
      'definedAlias', 'lastDescriptorAlias', 'multiAlias', 'readAlias', 'reflectAlias',
    ]) {
      assert.deepEqual(
        parsed.methods.find((method) => method.name === name).calledProjectDatabaseMethods,
        ['writer'],
      );
      assert.equal(parsed.methods.find((method) => method.name === name).definitionResolved, true);
    }
    const unresolvedMethodNames = parsed.methods
      .filter((method) => method.definitionResolved === false)
      .map((method) => method.name);
    for (const name of [
      ...unresolvedNames, 'descriptorGetterAlias', 'getterAlias', 'spreadDescriptorAlias',
    ]) {
      assert.ok(unresolvedMethodNames.includes(name), `expected unresolved callable definition ${name}`);
    }
    assert.equal(parsed.methods.find((method) => method.name === 'prototypeWriter').kind, 'prototype-assignment');
    assert.equal(parsed.methods.find((method) => method.name === 'prototypeWriter').direct.mutationQueryCount, 1);

    const readMethods = parsed.methods
      .map((method) => method.name)
      .filter((name) => !['fieldWriter', 'prototypeWriter', 'writer'].includes(name));
    const fixtureManifest = {
      manifestVersion: 1,
      sourceFile: 'backend/src/services/projectDatabase.js',
      classificationSemantics: 'persistent-side-effect',
      categories: {
        read: readMethods,
        write: ['fieldWriter', 'prototypeWriter', 'writer'],
        maintenance: [],
        migration: [],
        'test-only': [],
      },
    };
    const classified = classifyProjectDatabaseMethods(parsed, fixtureManifest);
    assert.equal(classified.classification.classificationComplete, true);
    assert.equal(classified.classification.classificationConsistent, false);
    assert.equal(classified.classification.classificationGatePassed, false);
    assert.ok(classified.classification.consistencyIssues.some((issue) => (
      issue.code === 'read-has-direct-persistent-mutation-candidate' && issue.name === 'aliasedDbRead'
    )));
    assert.ok(classified.classification.consistencyIssues.some((issue) => (
      issue.code === 'read-has-direct-persistent-mutation-candidate' && issue.name === 'destructuredFsRead'
    )));
    for (const name of [
      'appliedDefineAlias', 'assignedFromFirst', 'assignedPrototypeAlias', 'bareFieldAlias',
      'boundDefineAlias', 'boundWriter', 'calledDefineAlias', 'definedAlias', 'delegatedRead',
      'lastDescriptorAlias', 'multiAlias', 'readAlias', 'reflectAlias',
    ]) {
      assert.ok(classified.classification.consistencyIssues.some((issue) => (
        issue.code === 'read-reaches-stateful-method'
        && issue.name === name
        && issue.dependency === 'writer'
      )));
    }
    for (const name of unresolvedMethodNames) {
      assert.ok(classified.classification.consistencyIssues.some((issue) => (
        issue.code === 'method-definition-unresolved' && issue.name === name
      )));
    }
    fs.writeFileSync(
      path.join(scripts, 'project-database-method-classification.json'),
      JSON.stringify(fixtureManifest),
    );
    const gate = spawnSync(process.execPath, [SCRIPT, '--root', root, '--compact', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 5000,
    });
    assert.equal(gate.signal, null, gate.error?.message);
    assert.equal(gate.status, 1, gate.stderr);
    assert.equal(JSON.parse(gate.stdout).classificationGatePassed, false);

    fs.writeFileSync(path.join(services, 'aliasedWriter.js'), `
      function write(context) {
        const { projectDatabase: owner0 } = context;
        const owner = owner0;
        const { db: chained } = owner;
        const raw = chained;
        const statement = raw.prepare('UPDATE example SET value = 2 RETURNING value');
        statement.pluck().get();
        const db = owner.db;
        db.prepare('UPDATE example SET value = 3 RETURNING value').get();
        const { db: second } = owner;
        second.prepare('DELETE FROM example RETURNING value').all();
        raw.prepare('SELECT value FROM example').pluck().get();
      }
      function unrelated(raw, owner) {
        raw.prepare('UPDATE unrelated SET value = 1 RETURNING value').pluck().get();
        owner.db.prepare('DELETE FROM unrelated RETURNING value').all();
      }
      module.exports = { write, unrelated };
    `);
    const external = externalRawDatabaseInventory(root);
    assert.equal(external.entryCount, 3);
    assert.ok(external.entries.every((entry) => entry.kind === 'raw-prepared-mutation-query'));
    assert.equal(external.entries.filter((entry) => /SELECT/.test(entry.sql || '')).length, 0);
    assert.equal(external.entries.filter((entry) => /unrelated/i.test(entry.sql || '')).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('external raw database inventory rejects production mutation candidates', () => {
  const inventory = report().externalProductionRawDatabase;
  const files = new Set(inventory.files.map((entry) => entry.file));
  assert.equal(inventory.entryCount, 0);
  assert.equal(inventory.fileCount, 0);
  assert.deepEqual(inventory.entries, []);
  for (const migratedFile of [
    'backend/src/services/assetUploadManager.js',
    'backend/src/services/collaborationTextPersistence.js',
    'backend/src/collaboration/gateway.js',
    'backend/src/routes/projectRuns.js',
    'backend/src/routes/videoOps.js',
  ]) {
    assert.equal(files.has(migratedFile), false, `unexpected raw database candidate in ${migratedFile}`);
  }
  assert.equal(inventory.entries.some((entry) => entry.file.endsWith('/assetUploadManager.js')
    && entry.classification?.startsWith('mutation-candidate')), false);
  const collaborationTextSource = fs.readFileSync(
    path.join(ROOT, 'backend', 'src', 'services', 'collaborationTextPersistence.js'),
    'utf8',
  );
  assert.doesNotMatch(collaborationTextSource, /\b(?:this|database)\.db\b/);
  assert.doesNotMatch(collaborationTextSource, /\.prepare\s*\(|\.transaction\s*\(/);
});

test('fixed 400/500 inventory freezes known route hits without assigning semantics', () => {
  const inventory = report().fixedRouteStatuses;
  assert.deepEqual(inventory.statuses, [400, 500]);
  assert.equal(inventory.entries.length, inventory.entryCount);
  assert.ok(inventory.entries.every((entry) => entry.status === 400 || entry.status === 500));

  const files = new Set(inventory.files.map((entry) => entry.file));
  for (const file of [
    'backend/src/routes/canvas.js',
    'backend/src/routes/projectRuns.js',
    'backend/src/routes/subflows.js',
  ]) {
    assert.ok(files.has(file), `expected fixed route status hit in ${file}`);
  }
  assert.ok(inventory.entries.some((entry) => entry.file.endsWith('/canvas.js') && entry.status === 500));
  assert.ok(inventory.entries.some((entry) => entry.file.endsWith('/projectRuns.js') && entry.status === 400));
  assert.ok(inventory.entries.some((entry) => entry.file.endsWith('/subflows.js') && entry.status === 400));
});

test('writer inventory CLI emits parseable deterministic machine JSON', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--compact', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), report());

  const help = spawnSync(process.execPath, [SCRIPT, '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--check fails when the explicit manifest drifts/);

  const invalid = spawnSync(process.execPath, [SCRIPT, '--definitely-unknown'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /unknown argument/);
});

test('writer inventory CLI --check exits nonzero for a real manifest drift fixture', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-writer-inventory-cli-drift-'));
  const services = path.join(root, 'backend', 'src', 'services');
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(services, { recursive: true });
  fs.mkdirSync(scripts, { recursive: true });
  try {
    fs.copyFileSync(
      path.join(ROOT, 'backend', 'src', 'services', 'projectDatabase.js'),
      path.join(services, 'projectDatabase.js'),
    );
    const manifest = structuredClone(loadProjectDatabaseMethodClassification(ROOT).manifest);
    const removed = manifest.categories.read.shift();
    fs.writeFileSync(
      path.join(scripts, 'project-database-method-classification.json'),
      JSON.stringify(manifest),
    );
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--compact', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, '');
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.classificationComplete, false);
    assert.equal(parsed.classificationGatePassed, false);
    assert.ok(parsed.methodClassification.issues.some((issue) => (
      issue.code === 'unclassified-source-method' && issue.name === removed
    )));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
