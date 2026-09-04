#!/usr/bin/env node
'use strict';

/**
 * Independent ProjectDatabase lifecycle policy gate.
 *
 * This gate consumes the existing static writer inventory. It does not change
 * or complete the main writer policy: the accepted public lifecycle methods
 * remain noncompliant there and the accepted internal helpers remain
 * unresolved until this separate exact policy domain is applied.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');

const {
  buildWriterInventory,
} = require('./audit-project-database-writers.cjs');

const REPORT_VERSION = 1;
const DEFAULT_ROOT = path.resolve(__dirname, '..');
const PROJECT_DATABASE_SOURCE_FILE = 'backend/src/services/projectDatabase.js';
const PRODUCTION_SOURCE_ROOTS = Object.freeze(['backend/src']);
const JAVASCRIPT_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const MEMBER_NODE_TYPES = new Set(['MemberExpression', 'OptionalMemberExpression']);
const CALL_NODE_TYPES = new Set(['CallExpression', 'OptionalCallExpression']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function directContract(options = {}) {
  const writePragmas = [...(options.writePragmas || [])];
  const filesystemMutationMethods = [...(options.filesystemMutationMethods || [])];
  const transactionTypes = [...(options.transactionTypes || [])];
  return {
    runCount: options.runCount || 0,
    execCount: options.execCount || 0,
    mutationQueryCount: options.mutationQueryCount || 0,
    databaseEffectCount: options.databaseEffectCount ?? writePragmas.length,
    writePragmas,
    filesystemMutationCount: filesystemMutationMethods.length,
    filesystemMutationMethods,
    backupCount: options.backupCount || 0,
    transactionFactoryCount: options.transactionFactoryCount ?? transactionTypes.length,
    transactionTypes,
    storageCapacityTranslationCount: options.storageCapacityTranslationCount || 0,
    coordinatorCallCount: 0,
    dynamicProjectDatabaseCallCount: 0,
  };
}

function lifecycleContract(name, options = {}) {
  const visibility = options.visibility || 'public';
  const mainWriterPolicyCompliant = visibility === 'internal' ? null : false;
  return {
    name,
    classification: 'maintenance',
    visibility,
    kind: options.kind || 'method',
    async: options.async === true,
    definitionResolved: true,
    policyApplicable: true,
    mainWriterPolicyCompliant,
    mainWriterPolicyReason: visibility === 'internal'
      ? 'internal-caller-boundary-not-statically-proven'
      : 'public-stateful-method-without-direct-coordinator',
    calledProjectDatabaseMethods: [...(options.calledProjectDatabaseMethods || [])],
    calledProjectDatabaseMethodCallCount: options.calledProjectDatabaseMethodCallCount || 0,
    hasDirectSqlMutationCandidate: options.hasDirectSqlMutationCandidate === true,
    hasDirectPersistentMutationCandidate: options.hasDirectPersistentMutationCandidate === true,
    direct: directContract(options.direct),
  };
}

const LIFECYCLE_METHOD_CONTRACTS = deepFreeze([
  lifecycleContract('constructor', {
    kind: 'constructor',
    calledProjectDatabaseMethods: [
      'initializeDatabase',
      'preflightExistingDatabase',
      'recoverDatabase',
      'startStartupBackup',
    ],
    calledProjectDatabaseMethodCallCount: 5,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      filesystemMutationMethods: ['mkdirSync'],
      storageCapacityTranslationCount: 1,
    },
  }),
  lifecycleContract('preflightExistingDatabase', {
    calledProjectDatabaseMethods: ['_assertProjectDatabaseHistoryCandidate'],
    calledProjectDatabaseMethodCallCount: 2,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      filesystemMutationMethods: ['copyFileSync', 'rmSync', 'rmSync', 'rmSync'],
    },
  }),
  lifecycleContract('initializeDatabase', {
    calledProjectDatabaseMethods: [
      '_assertCanvasHistoryAccounting',
      '_assertCanvasPermanentLedgerAccounting',
      '_assertCanvasSnapshotPins',
      '_assertDurableLedgerAccounting',
      '_reconcileTerminalRunSnapshotPins',
      'bootstrapRecoveryGeneration',
      'configure',
      'migrate',
      'recoverInterruptedRuns',
      'withProjectDatabaseReadSnapshot',
    ],
    calledProjectDatabaseMethodCallCount: 12,
  }),
  lifecycleContract('bootstrapRecoveryGeneration', {
    calledProjectDatabaseMethods: [
      '_readRecoveryGenerationState',
      '_writeRecoveryGenerationState',
      'getRecoveryGeneration',
    ],
    calledProjectDatabaseMethodCallCount: 14,
    hasDirectSqlMutationCandidate: true,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      databaseEffectCount: 2,
      writePragmas: ['query_only = ON', 'query_only = OFF'],
      filesystemMutationMethods: ['openSync', 'writeFileSync', 'fsyncSync'],
      transactionTypes: ['immediate'],
      storageCapacityTranslationCount: 1,
    },
  }),
  lifecycleContract('rotateRecoveryGeneration', {
    calledProjectDatabaseMethods: [
      '_ensureProjectDurableLedgerState',
      '_readRecoveryGenerationState',
      '_writeRecoveryGenerationState',
      'getRecoveryGeneration',
    ],
    calledProjectDatabaseMethodCallCount: 5,
    hasDirectSqlMutationCandidate: true,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      runCount: 1,
      mutationQueryCount: 1,
      databaseEffectCount: 2,
      transactionTypes: ['immediate'],
      transactionFactoryCount: 2,
      storageCapacityTranslationCount: 1,
    },
  }),
  lifecycleContract('validateRecoveryCandidate', {
    hasDirectSqlMutationCandidate: true,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      writePragmas: ['query_only = ON'],
    },
  }),
  lifecycleContract('recoverDatabase', {
    calledProjectDatabaseMethods: [
      '_copyRecoveryEvidence',
      '_readRecoveryGenerationState',
      '_recoveryArtifactSuffix',
      'validateRecoveryCandidate',
    ],
    calledProjectDatabaseMethodCallCount: 8,
    hasDirectSqlMutationCandidate: true,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      runCount: 1,
      databaseEffectCount: 5,
      writePragmas: [
        'query_only = ON',
        'query_only = ON',
        'foreign_keys = ON',
        'wal_checkpoint(TRUNCATE)',
      ],
      filesystemMutationMethods: [
        'chmodSync',
        'rmSync',
        'renameSync',
        'rmdirSync',
        'renameSync',
        'rmSync',
        'rmdirSync',
      ],
    },
  }),
  lifecycleContract('configure', {
    hasDirectSqlMutationCandidate: true,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      writePragmas: ['journal_mode = WAL', 'foreign_keys = ON', 'busy_timeout = 5000'],
    },
  }),
  lifecycleContract('startStartupBackup', {
    calledProjectDatabaseMethods: ['createBackup'],
    calledProjectDatabaseMethodCallCount: 1,
  }),
  lifecycleContract('createBackup', {
    calledProjectDatabaseMethods: ['_createBackupAtomically'],
    calledProjectDatabaseMethodCallCount: 1,
  }),
  lifecycleContract('waitForBackup'),
  lifecycleContract('close', {
    calledProjectDatabaseMethods: ['waitForBackup'],
    calledProjectDatabaseMethodCallCount: 1,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      filesystemMutationMethods: ['rmSync'],
    },
  }),
  lifecycleContract('_assertProjectDatabaseHistoryCandidate', {
    visibility: 'internal',
  }),
  lifecycleContract('_copyRecoveryEvidence', {
    visibility: 'internal',
    hasDirectPersistentMutationCandidate: true,
    direct: {
      filesystemMutationMethods: ['copyFileSync'],
    },
  }),
  lifecycleContract('_writeRecoveryGenerationState', {
    visibility: 'internal',
    calledProjectDatabaseMethods: ['_readRecoveryGenerationState'],
    calledProjectDatabaseMethodCallCount: 1,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      filesystemMutationMethods: [
        'openSync',
        'writeFileSync',
        'fsyncSync',
        'renameSync',
        'rmSync',
      ],
    },
  }),
  lifecycleContract('_createBackupAtomically', {
    visibility: 'internal',
    async: true,
    calledProjectDatabaseMethods: ['validateRecoveryCandidate'],
    calledProjectDatabaseMethodCallCount: 1,
    hasDirectSqlMutationCandidate: true,
    hasDirectPersistentMutationCandidate: true,
    direct: {
      databaseEffectCount: 2,
      writePragmas: ['foreign_keys = ON', 'wal_checkpoint(TRUNCATE)'],
      filesystemMutationMethods: ['renameSync', 'rmSync'],
      backupCount: 1,
      storageCapacityTranslationCount: 1,
    },
  }),
  lifecycleContract('_reconcileTerminalRunSnapshotPins', {
    visibility: 'internal',
    calledProjectDatabaseMethods: [
      '_assertCanvasHistoryAccounting',
      '_assertProjectDatabaseMutationTransaction',
      '_compactCanvasSnapshotHistory',
      '_releaseTerminalRunSnapshotPins',
    ],
    calledProjectDatabaseMethodCallCount: 4,
    direct: {
      transactionFactoryCount: 1,
      transactionTypes: ['immediate'],
    },
  }),
]);

const LIFECYCLE_METHOD_NAMES = Object.freeze(LIFECYCLE_METHOD_CONTRACTS.map((entry) => entry.name));
const LIFECYCLE_METHOD_NAME_SET = new Set(LIFECYCLE_METHOD_NAMES);
const LIFECYCLE_MEMBER_NAME_SET = new Set(LIFECYCLE_METHOD_NAMES.filter((name) => name !== 'constructor'));
const EXPECTED_INTERNAL_LIFECYCLE_CALLS = deepFreeze([
  { caller: '_createBackupAtomically', callee: 'validateRecoveryCandidate', count: 1 },
  { caller: '_migrateSchema31To32', callee: '_writeRecoveryGenerationState', count: 1 },
  { caller: 'bootstrapRecoveryGeneration', callee: '_writeRecoveryGenerationState', count: 4 },
  { caller: 'close', callee: 'waitForBackup', count: 1 },
  { caller: 'constructor', callee: 'initializeDatabase', count: 2 },
  { caller: 'constructor', callee: 'preflightExistingDatabase', count: 1 },
  { caller: 'constructor', callee: 'recoverDatabase', count: 1 },
  { caller: 'constructor', callee: 'startStartupBackup', count: 1 },
  { caller: 'createBackup', callee: '_createBackupAtomically', count: 1 },
  { caller: 'initializeDatabase', callee: '_reconcileTerminalRunSnapshotPins', count: 1 },
  { caller: 'initializeDatabase', callee: 'bootstrapRecoveryGeneration', count: 2 },
  { caller: 'initializeDatabase', callee: 'configure', count: 1 },
  { caller: 'preflightExistingDatabase', callee: '_assertProjectDatabaseHistoryCandidate', count: 2 },
  { caller: 'recoverDatabase', callee: '_copyRecoveryEvidence', count: 2 },
  { caller: 'recoverDatabase', callee: 'validateRecoveryCandidate', count: 2 },
  { caller: 'rotateRecoveryGeneration', callee: '_writeRecoveryGenerationState', count: 2 },
  { caller: 'startStartupBackup', callee: 'createBackup', count: 1 },
]);
const CONTRACT_FINGERPRINT = crypto.createHash('sha256')
  .update(JSON.stringify(LIFECYCLE_METHOD_CONTRACTS), 'utf8')
  .digest('hex');

function normalizePath(value) {
  return String(value).replace(/\\/g, '/');
}

function relativePath(root, filename) {
  return normalizePath(path.relative(root, filename));
}

function stableJson(value) {
  return JSON.stringify(value);
}

function isMemberNode(node) {
  return Boolean(node && MEMBER_NODE_TYPES.has(node.type));
}

function isCallNode(node) {
  return Boolean(node && CALL_NODE_TYPES.has(node.type));
}

function staticText(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral' || node.type === 'DirectiveLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((entry) => entry.value.cooked ?? entry.value.raw ?? '').join('');
  }
  return null;
}

function propertyName(node) {
  if (!isMemberNode(node)) return null;
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  return staticText(node.property);
}

function memberChain(node) {
  if (!node) return [];
  if (node.type === 'ThisExpression') return ['this'];
  if (node.type === 'Identifier') return [node.name];
  if (!isMemberNode(node)) return [];
  const name = propertyName(node);
  if (!name) return [];
  const prefix = memberChain(node.object);
  return prefix.length > 0 ? [...prefix, name] : [];
}

function unwrapExpression(node) {
  let current = node;
  while (current && [
    'ChainExpression',
    'TSAsExpression',
    'TSNonNullExpression',
    'TSSatisfiesExpression',
    'TypeCastExpression',
  ].includes(current.type)) current = current.expression;
  return current;
}

function walk(node, visitor, ancestors = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  visitor(node, ancestors);
  const nextAncestors = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if ([
      'start', 'end', 'loc', 'extra', 'errors', 'comments', 'tokens',
      'leadingComments', 'innerComments', 'trailingComments',
    ].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && typeof child.type === 'string') {
          walk(child, visitor, nextAncestors, seen);
        }
      }
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visitor, nextAncestors, seen);
    }
  }
}

function parseSource(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const isTypeScript = /\.(?:cts|mts|ts|tsx)$/.test(filename);
  const isJsx = /\.(?:jsx|tsx)$/.test(filename);
  const ast = parser.parse(source, {
    sourceType: 'unambiguous',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    errorRecovery: false,
    plugins: [
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'dynamicImport',
      'importMeta',
      'optionalCatchBinding',
      'optionalChaining',
      'topLevelAwait',
      ...(isTypeScript ? ['typescript'] : []),
      ...(isJsx ? ['jsx'] : []),
    ],
  });
  return { source, ast };
}

function sourceLine(source, line) {
  return String(source.split(/\r?\n/)[Math.max(0, Number(line || 1) - 1)] || '').trim();
}

function listJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile() && JAVASCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(filename);
      }
    }
  };
  visit(directory);
  return files;
}

function projectDatabaseModule(sourceValue) {
  if (typeof sourceValue !== 'string') return false;
  const normalized = normalizePath(sourceValue).replace(/\.(?:c?js|mjs|ts)$/, '');
  return /(?:^|\/)projectDatabase$/.test(normalized);
}

function requireSource(node) {
  const current = unwrapExpression(node);
  if (!isCallNode(current) || current.callee?.type !== 'Identifier' || current.callee.name !== 'require') {
    return null;
  }
  return staticText(current.arguments?.[0]);
}

function bindingName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'AssignmentPattern') return bindingName(node.left);
  return null;
}

function objectPatternBindings(pattern) {
  const entries = [];
  for (const property of pattern?.properties || []) {
    if (property.type !== 'ObjectProperty' && property.type !== 'Property') continue;
    const imported = property.computed ? staticText(property.key) : (property.key?.name || staticText(property.key));
    const local = bindingName(property.value);
    if (imported && local) entries.push({ imported, local, line: property.loc?.start?.line || 1 });
  }
  return entries;
}

function callsiteSurface(file) {
  if (file.startsWith('backend/src/routes/')) return 'http-route';
  if (file === 'backend/src/collaboration/gateway.js'
    || file.startsWith('backend/src/collaboration/gateway')) return 'gateway';
  if (file.startsWith('backend/src/services/')) return 'business-service';
  if (file === 'backend/src/server.js') return 'server-lifecycle';
  return 'backend-production';
}

function databaseReceiverHint(chain) {
  const final = String(chain.at(-1) || '');
  return /^(?:database|db|projectDatabase|projectDb)$/i.test(final);
}

function collectProjectDatabaseBindings(ast, source, file) {
  const namespaces = new Set();
  const constructors = new Set(['ProjectDatabase']);
  const getters = new Set(['getProjectDatabase']);
  const lifecycleBindings = new Map();
  const importExposures = [];

  const registerBinding = (imported, local, line) => {
    if (imported === 'ProjectDatabase') constructors.add(local);
    if (imported === 'getProjectDatabase') getters.add(local);
    if (LIFECYCLE_MEMBER_NAME_SET.has(imported)) {
      lifecycleBindings.set(local, imported);
      importExposures.push({
        file,
        line,
        method: imported,
        usage: 'module-import',
        receiver: null,
        computed: false,
        surface: callsiteSurface(file),
        snippet: sourceLine(source, line),
      });
    }
  };

  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration' && projectDatabaseModule(staticText(node.source))) {
      for (const specifier of node.specifiers || []) {
        if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name);
        if (specifier.type === 'ImportDefaultSpecifier') namespaces.add(specifier.local.name);
        if (specifier.type === 'ImportSpecifier') {
          registerBinding(
            specifier.imported?.name || staticText(specifier.imported),
            specifier.local?.name,
            specifier.loc?.start?.line || node.loc?.start?.line || 1,
          );
        }
      }
      return;
    }
    if (node.type !== 'VariableDeclarator' || !node.init) return;
    const required = requireSource(node.init);
    if (projectDatabaseModule(required)) {
      if (node.id.type === 'Identifier') namespaces.add(node.id.name);
      if (node.id.type === 'ObjectPattern') {
        for (const entry of objectPatternBindings(node.id)) {
          registerBinding(entry.imported, entry.local, entry.line);
        }
      }
      return;
    }
    if (isMemberNode(node.init) && projectDatabaseModule(requireSource(node.init.object))) {
      const imported = propertyName(node.init);
      const local = bindingName(node.id);
      if (imported && local) registerBinding(imported, local, node.loc?.start?.line || 1);
      return;
    }
    if (node.init.type === 'Identifier' && namespaces.has(node.init.name) && node.id.type === 'ObjectPattern') {
      for (const entry of objectPatternBindings(node.id)) {
        registerBinding(entry.imported, entry.local, entry.line);
      }
      return;
    }
    if (isMemberNode(node.init) && node.init.object?.type === 'Identifier'
      && namespaces.has(node.init.object.name)) {
      const imported = propertyName(node.init);
      const local = bindingName(node.id);
      if (imported && local) registerBinding(imported, local, node.loc?.start?.line || 1);
    }
  });

  return { constructors, getters, importExposures, lifecycleBindings, namespaces };
}

function expressionContainsDatabaseSource(node, state, seen = new Set()) {
  const current = unwrapExpression(node);
  if (!current || seen.has(current)) return false;
  seen.add(current);
  if (current.type === 'Identifier') return state.taintedIdentifiers.has(current.name);
  if (current.type === 'NewExpression') {
    if (current.callee?.type === 'Identifier' && state.constructors.has(current.callee.name)) return true;
    if (isMemberNode(current.callee)) {
      const chain = memberChain(current.callee);
      return chain.length === 2 && state.namespaces.has(chain[0]) && chain[1] === 'ProjectDatabase';
    }
    return false;
  }
  if (isCallNode(current)) {
    if (current.callee?.type === 'Identifier'
      && (state.getters.has(current.callee.name) || state.helperGetters.has(current.callee.name))) return true;
    if (isMemberNode(current.callee)) {
      const chain = memberChain(current.callee);
      if (chain.length === 2 && state.namespaces.has(chain[0]) && chain[1] === 'getProjectDatabase') return true;
    }
    return false;
  }
  if (isMemberNode(current)) {
    const chain = memberChain(current).join('.');
    return Boolean(chain && state.taintedMemberChains.has(chain));
  }
  if (current.type === 'AwaitExpression') return expressionContainsDatabaseSource(current.argument, state, seen);
  if (current.type === 'AssignmentExpression') return expressionContainsDatabaseSource(current.right, state, seen);
  if (current.type === 'ConditionalExpression') {
    return expressionContainsDatabaseSource(current.consequent, state, seen)
      || expressionContainsDatabaseSource(current.alternate, state, seen);
  }
  if (current.type === 'LogicalExpression' || current.type === 'BinaryExpression') {
    return expressionContainsDatabaseSource(current.left, state, seen)
      || expressionContainsDatabaseSource(current.right, state, seen);
  }
  if (current.type === 'SequenceExpression') {
    return current.expressions.some((entry) => expressionContainsDatabaseSource(entry, state, seen));
  }
  return false;
}

function functionName(node, ancestors) {
  if (node.type === 'FunctionDeclaration') return node.id?.name || null;
  const parent = ancestors.at(-1);
  if ((node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
    && parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name;
  return null;
}

function functionReturnsDatabase(node, state) {
  if (node.type === 'ArrowFunctionExpression' && node.body?.type !== 'BlockStatement') {
    return expressionContainsDatabaseSource(node.body, state);
  }
  let found = false;
  walk(node.body, (candidate, ancestors) => {
    if (found || candidate.type !== 'ReturnStatement' || !candidate.argument) return;
    if (ancestors.some((ancestor) => ancestor !== node.body
      && ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'].includes(ancestor.type))) return;
    if (expressionContainsDatabaseSource(candidate.argument, state)) found = true;
  });
  return found;
}

function collectDatabaseSources(ast, bindings) {
  const state = {
    ...bindings,
    helperGetters: new Set(),
    taintedIdentifiers: new Set(),
    taintedMemberChains: new Set(),
  };
  for (let pass = 0; pass < 12; pass += 1) {
    const before = state.helperGetters.size + state.taintedIdentifiers.size + state.taintedMemberChains.size;
    walk(ast, (node, ancestors) => {
      if (['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'].includes(node.type)) {
        const name = functionName(node, ancestors);
        if (name && functionReturnsDatabase(node, state)) state.helperGetters.add(name);
      }
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier'
        && expressionContainsDatabaseSource(node.init, state)) {
        state.taintedIdentifiers.add(node.id.name);
      }
      if (node.type === 'AssignmentExpression' && expressionContainsDatabaseSource(node.right, state)) {
        if (node.left?.type === 'Identifier') state.taintedIdentifiers.add(node.left.name);
        if (isMemberNode(node.left)) {
          const chain = memberChain(node.left).join('.');
          if (chain) state.taintedMemberChains.add(chain);
        }
      }
    });
    const after = state.helperGetters.size + state.taintedIdentifiers.size + state.taintedMemberChains.size;
    if (after === before) break;
  }
  return state;
}

function isDatabaseReceiver(node, state) {
  const current = unwrapExpression(node);
  if (!current) return false;
  if (expressionContainsDatabaseSource(current, state)) return true;
  const chain = memberChain(current);
  if (chain.length > 0 && databaseReceiverHint(chain)) return true;
  return false;
}

function constructorCall(node, state) {
  if (node?.type !== 'NewExpression') return false;
  if (node.callee?.type === 'Identifier' && state.constructors.has(node.callee.name)) return true;
  if (!isMemberNode(node.callee)) return false;
  const chain = memberChain(node.callee);
  return chain.length === 2 && state.namespaces.has(chain[0]) && chain[1] === 'ProjectDatabase';
}

function memberUsage(node, parent) {
  if (isCallNode(parent) && parent.callee === node) return 'call';
  if (parent?.type === 'NewExpression' && parent.callee === node) return 'construct';
  return 'reference';
}

function scanFileLifecycleCallsites(root, filename) {
  const file = relativePath(root, filename);
  const { source, ast } = parseSource(filename);
  const bindings = collectProjectDatabaseBindings(ast, source, file);
  const state = collectDatabaseSources(ast, bindings);
  const entries = [...bindings.importExposures];

  walk(ast, (node, ancestors) => {
    const parent = ancestors.at(-1);
    const line = node.loc?.start?.line || 1;
    if (constructorCall(node, state)) {
      entries.push({
        file,
        line,
        method: 'constructor',
        usage: 'construct',
        receiver: null,
        computed: false,
        surface: callsiteSurface(file),
        snippet: sourceLine(source, line),
      });
      return;
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'ObjectPattern'
      && isDatabaseReceiver(node.init, state)) {
      for (const entry of objectPatternBindings(node.id)) {
        if (!LIFECYCLE_MEMBER_NAME_SET.has(entry.imported)) continue;
        entries.push({
          file,
          line: entry.line,
          method: entry.imported,
          usage: 'destructure-reference',
          receiver: memberChain(node.init).join('.') || null,
          computed: false,
          surface: callsiteSurface(file),
          snippet: sourceLine(source, entry.line),
        });
      }
      return;
    }
    if (!isMemberNode(node)) return;
    const method = propertyName(node);
    const receiverChain = memberChain(node.object);
    const receiver = receiverChain.join('.') || null;
    if (method && LIFECYCLE_MEMBER_NAME_SET.has(method)) {
      if (method === 'close' && !isDatabaseReceiver(node.object, state)) return;
      entries.push({
        file,
        line,
        method,
        usage: memberUsage(node, parent),
        receiver,
        computed: node.computed === true,
        surface: callsiteSurface(file),
        snippet: sourceLine(source, line),
      });
      return;
    }
    if (!method && node.computed && isDatabaseReceiver(node.object, state)) {
      entries.push({
        file,
        line,
        method: null,
        usage: `${memberUsage(node, parent)}-dynamic`,
        receiver,
        computed: true,
        surface: callsiteSurface(file),
        snippet: sourceLine(source, line),
      });
    }
  });

  const unique = new Map();
  for (const entry of entries) {
    const key = stableJson([entry.file, entry.line, entry.method, entry.usage, entry.receiver]);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()].sort((left, right) => (
    left.line - right.line
    || String(left.method).localeCompare(String(right.method))
    || left.usage.localeCompare(right.usage)
  ));
}

function scanProductionLifecycleCallsites(root = DEFAULT_ROOT, options = {}) {
  const resolvedRoot = path.resolve(root);
  const sourceRoots = options.sourceRoots || PRODUCTION_SOURCE_ROOTS;
  const files = [];
  const scanIssues = [];
  for (const sourceRoot of sourceRoots) {
    const absolute = path.join(resolvedRoot, sourceRoot);
    if (!fs.existsSync(absolute)) {
      scanIssues.push({ code: 'production-source-root-missing', sourceRoot: normalizePath(sourceRoot) });
      continue;
    }
    files.push(...listJavaScriptFiles(absolute));
  }
  const uniqueFiles = [...new Set(files.map((filename) => path.resolve(filename)))].sort();
  const entries = [];
  let scannedFileCount = 0;
  for (const filename of uniqueFiles) {
    const relative = relativePath(resolvedRoot, filename);
    if (relative === PROJECT_DATABASE_SOURCE_FILE) continue;
    scannedFileCount += 1;
    try {
      entries.push(...scanFileLifecycleCallsites(resolvedRoot, filename));
    } catch (error) {
      scanIssues.push({
        code: 'production-source-parse-failed',
        file: relative,
        error: String(error?.message || error),
      });
    }
  }
  entries.sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || String(left.method).localeCompare(String(right.method))
    || left.usage.localeCompare(right.usage)
  ));
  return {
    scannedRoots: sourceRoots.map(normalizePath),
    excludedDefinitionFile: PROJECT_DATABASE_SOURCE_FILE,
    scannedFileCount,
    entryCount: entries.length,
    fileCount: new Set(entries.map((entry) => entry.file)).size,
    entries,
    scanIssues,
  };
}

function normalizeLifecycleMethodShape(method) {
  const direct = method?.direct || {};
  return {
    name: method?.name ?? null,
    classification: method?.classification ?? null,
    visibility: method?.visibility ?? null,
    kind: method?.kind ?? null,
    async: method?.async === true,
    definitionResolved: method?.definitionResolved === true,
    policyApplicable: method?.policyApplicable === true,
    mainWriterPolicyCompliant: method?.policyCompliant ?? null,
    mainWriterPolicyReason: method?.policyReason ?? null,
    calledProjectDatabaseMethods: [...(method?.calledProjectDatabaseMethods || [])],
    calledProjectDatabaseMethodCallCount: Number(method?.calledProjectDatabaseMethodCallCount || 0),
    hasDirectSqlMutationCandidate: method?.hasDirectSqlMutationCandidate === true,
    hasDirectPersistentMutationCandidate: method?.hasDirectPersistentMutationCandidate === true,
    direct: {
      runCount: Number(direct.runCount || 0),
      execCount: Number(direct.execCount || 0),
      mutationQueryCount: Number(direct.mutationQueryCount || 0),
      databaseEffectCount: Number(direct.databaseEffectCount || 0),
      writePragmas: (direct.writePragmas || []).map((entry) => entry.pragma),
      filesystemMutationCount: Number(direct.filesystemMutationCount || 0),
      filesystemMutationMethods: (direct.filesystemMutationCalls || []).map((entry) => entry.method),
      backupCount: Number(direct.backupCount || 0),
      transactionFactoryCount: Number(direct.transactionFactoryCount || 0),
      transactionTypes: [...(direct.transactionTypes || [])],
      storageCapacityTranslationCount: Number(direct.storageCapacityTranslationCount || 0),
      coordinatorCallCount: Number(direct.coordinatorCallCount || 0),
      dynamicProjectDatabaseCallCount: Number(direct.dynamicProjectDatabaseCallCount || 0),
    },
  };
}

function shapeDrifts(expected, actual) {
  const drifts = [];
  for (const key of Object.keys(expected)) {
    const expectedValue = expected[key];
    const actualValue = actual?.[key];
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
      for (const nested of shapeDrifts(expectedValue, actualValue || {})) {
        drifts.push({ ...nested, field: `${key}.${nested.field}` });
      }
    } else if (stableJson(expectedValue) !== stableJson(actualValue)) {
      drifts.push({ field: key, expected: expectedValue, actual: actualValue });
    }
  }
  return drifts;
}

function sortedNames(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function internalLifecycleCallsites(writerInventory) {
  const grouped = new Map();
  for (const method of writerInventory?.projectDatabase?.methods || []) {
    for (const call of method.calledProjectDatabaseMethodCalls || []) {
      if (!LIFECYCLE_MEMBER_NAME_SET.has(call.name)) continue;
      const key = stableJson([method.name, call.name]);
      const current = grouped.get(key) || { caller: method.name, callee: call.name, count: 0 };
      current.count += 1;
      grouped.set(key, current);
    }
  }
  return [...grouped.values()].sort((left, right) => (
    left.caller.localeCompare(right.caller) || left.callee.localeCompare(right.callee)
  ));
}

function evaluateLifecyclePolicy(writerInventory, productionCallsites, root = DEFAULT_ROOT) {
  const issues = [];
  if (!writerInventory) {
    issues.push({ code: 'writer-inventory-unavailable' });
  } else {
    if (writerInventory.classificationComplete !== true) {
      issues.push({ code: 'writer-classification-incomplete' });
    }
    if (writerInventory.classificationGatePassed !== true) {
      issues.push({ code: 'writer-classification-gate-failed' });
    }
  }

  const sourceMethods = writerInventory?.projectDatabase?.methods || [];
  const methodsByName = new Map(sourceMethods.map((method) => [method.name, method]));
  const observedShapes = [];
  for (const contract of LIFECYCLE_METHOD_CONTRACTS) {
    const method = methodsByName.get(contract.name);
    if (!method) {
      issues.push({ code: 'lifecycle-method-missing', name: contract.name });
      continue;
    }
    const actual = normalizeLifecycleMethodShape(method);
    observedShapes.push(actual);
    const drifts = shapeDrifts(contract, actual);
    if (drifts.length > 0) {
      issues.push({
        code: 'lifecycle-method-contract-drift',
        name: contract.name,
        driftCount: drifts.length,
        drifts,
      });
    }
  }

  const expectedNoncompliant = sortedNames(LIFECYCLE_METHOD_CONTRACTS
    .filter((contract) => contract.mainWriterPolicyCompliant === false)
    .map((contract) => contract.name));
  const actualNoncompliant = sortedNames(sourceMethods
    .filter((method) => method.policyApplicable === true && method.policyCompliant === false)
    .map((method) => method.name));
  if (stableJson(expectedNoncompliant) !== stableJson(actualNoncompliant)) {
    issues.push({
      code: 'main-writer-noncompliant-set-drift',
      expected: expectedNoncompliant,
      actual: actualNoncompliant,
      missing: expectedNoncompliant.filter((name) => !actualNoncompliant.includes(name)),
      unexpected: actualNoncompliant.filter((name) => !expectedNoncompliant.includes(name)),
    });
  }

  const expectedUnresolved = sortedNames(LIFECYCLE_METHOD_CONTRACTS
    .filter((contract) => contract.mainWriterPolicyCompliant == null)
    .map((contract) => contract.name));
  const actualUnresolved = sortedNames(sourceMethods
    .filter((method) => method.policyApplicable === true
      && method.policyCompliant == null
      && LIFECYCLE_METHOD_NAME_SET.has(method.name))
    .map((method) => method.name));
  if (stableJson(expectedUnresolved) !== stableJson(actualUnresolved)) {
    issues.push({
      code: 'main-writer-unresolved-set-drift',
      expected: expectedUnresolved,
      actual: actualUnresolved,
      missing: expectedUnresolved.filter((name) => !actualUnresolved.includes(name)),
      unexpected: actualUnresolved.filter((name) => !expectedUnresolved.includes(name)),
    });
  }

  const actualInternalCallsites = internalLifecycleCallsites(writerInventory);
  if (stableJson(EXPECTED_INTERNAL_LIFECYCLE_CALLS) !== stableJson(actualInternalCallsites)) {
    issues.push({
      code: 'lifecycle-internal-callsite-drift',
      expected: EXPECTED_INTERNAL_LIFECYCLE_CALLS,
      actual: actualInternalCallsites,
    });
  }

  for (const issue of productionCallsites?.scanIssues || []) issues.push(issue);
  for (const entry of productionCallsites?.entries || []) {
    issues.push({
      code: entry.method == null
        ? 'lifecycle-dynamic-production-callsite'
        : 'lifecycle-production-callsite-exposed',
      ...entry,
    });
  }

  const lifecycleCompliant = issues.length === 0;
  return {
    reportVersion: REPORT_VERSION,
    status: lifecycleCompliant ? 'lifecycle-policy-complete' : 'lifecycle-policy-incomplete',
    evidenceLevel: 'static-source-lifecycle-policy-gate',
    root: path.resolve(root),
    lifecycleCompliant,
    issueCount: issues.length,
    disclaimer: [
      'This is an independent lifecycle-only policy gate.',
      'It does not change the main writer inventory or make writerPolicy.policyCompliant true.',
      'Accepted public methods remain main-writer noncompliant; accepted internal helpers remain unresolved.',
      'All accepted lifecycle boundaries are constrained here by exact method-shape and callsite contracts.',
      'Static callsite evidence is fail-closed but is not runtime capability isolation proof.',
    ],
    writerInventory: writerInventory ? {
      classificationComplete: writerInventory.classificationComplete,
      classificationGatePassed: writerInventory.classificationGatePassed,
      mainWriterPolicyCompliant: writerInventory.policyCompliant,
      mainWriterPolicyCounts: writerInventory.writerPolicy?.methodCounts || null,
    } : null,
    lifecycle: {
      allowlistCount: LIFECYCLE_METHOD_CONTRACTS.length,
      allowlist: [...LIFECYCLE_METHOD_NAMES],
      contractFingerprint: CONTRACT_FINGERPRINT,
      observedCount: observedShapes.length,
      observedMethods: observedShapes,
      expectedMainWriterNoncompliant: expectedNoncompliant,
      actualMainWriterNoncompliant: actualNoncompliant,
      expectedMainWriterUnresolved: expectedUnresolved,
      actualMainWriterUnresolved: actualUnresolved,
      expectedInternalCallsites: EXPECTED_INTERNAL_LIFECYCLE_CALLS,
      actualInternalCallsites,
    },
    productionCallsites,
    issues,
  };
}

function buildProjectDatabaseLifecyclePolicy(root = DEFAULT_ROOT, options = {}) {
  const resolvedRoot = path.resolve(root);
  let writerInventory = null;
  let writerInventoryError = null;
  try {
    writerInventory = options.writerInventory || buildWriterInventory(resolvedRoot);
  } catch (error) {
    writerInventoryError = String(error?.stack || error);
  }
  let productionCallsites;
  try {
    productionCallsites = options.productionCallsites
      || scanProductionLifecycleCallsites(resolvedRoot, options.callsiteOptions);
  } catch (error) {
    productionCallsites = {
      scannedRoots: [...PRODUCTION_SOURCE_ROOTS],
      excludedDefinitionFile: PROJECT_DATABASE_SOURCE_FILE,
      scannedFileCount: 0,
      entryCount: 0,
      fileCount: 0,
      entries: [],
      scanIssues: [{
        code: 'production-callsite-scan-failed',
        error: String(error?.stack || error),
      }],
    };
  }
  const report = evaluateLifecyclePolicy(writerInventory, productionCallsites, resolvedRoot);
  if (writerInventoryError) {
    report.issues.unshift({ code: 'writer-inventory-failed', error: writerInventoryError });
    report.issueCount = report.issues.length;
    report.lifecycleCompliant = false;
    report.status = 'lifecycle-policy-incomplete';
  }
  return report;
}

function parseArguments(argv) {
  const options = { root: DEFAULT_ROOT, compact: false, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root requires a path');
      options.root = path.resolve(value);
      index += 1;
    } else if (argument === '--compact') {
      options.compact = true;
    } else if (argument === '--check') {
      options.check = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function helpText() {
  return [
    'Usage: node scripts/project-database-lifecycle-policy.cjs [--root <repo>] [--compact] [--check]',
    '',
    'Emits an independent static lifecycle policy report.',
    '--check fails only when lifecycleCompliant is false.',
    'A passing lifecycle gate does not complete the main writer policy.',
  ].join('\n');
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }
  const report = buildProjectDatabaseLifecyclePolicy(options.root);
  process.stdout.write(`${JSON.stringify(report, null, options.compact ? 0 : 2)}\n`);
  if (options.check && !report.lifecycleCompliant) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[project-db-lifecycle-policy] ${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONTRACT_FINGERPRINT,
  EXPECTED_INTERNAL_LIFECYCLE_CALLS,
  LIFECYCLE_METHOD_CONTRACTS,
  LIFECYCLE_METHOD_NAMES,
  PRODUCTION_SOURCE_ROOTS,
  PROJECT_DATABASE_SOURCE_FILE,
  REPORT_VERSION,
  buildProjectDatabaseLifecyclePolicy,
  evaluateLifecyclePolicy,
  normalizeLifecycleMethodShape,
  scanProductionLifecycleCallsites,
};
