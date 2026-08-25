'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  sha256CanonicalText,
} = require('../src/canonicalTextDigest.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const NODE_SCHEMA_SOURCE = path.join(ROOT, 'backend', 'src', 'shared', 'canvasNodeSchema.json');
const I18N_NODE_CATALOG_SOURCE = path.join(ROOT, 'src', 'i18n', 'nodeCatalog.ts');
const I18N_RENDERER_RESOURCES_SOURCE = path.join(ROOT, 'src', 'i18n', 'resources.ts');
const I18N_ELECTRON_CATALOG_SOURCE = path.join(ROOT, 'electron', 'i18n-catalog.json');
const BACKEND_TARGET = path.join(ROOT, 'backend', 'src', 'shared', 'creativeCapabilityGraph.json');
const CLI_TARGET = path.join(ROOT, 'tools', 'zcanvas-cli', 'generated', 'creative-capability-graph.json');
const COVERAGE_RECEIPT_SOURCE = path.join(ROOT, 'tools', 'zcanvas-cli', 'src', 'capabilityCoverage.cjs');
const CANONICAL_TEXT_DIGEST_SOURCE = path.join(
  ROOT,
  'tools',
  'zcanvas-cli',
  'src',
  'canonicalTextDigest.cjs',
);
const MARKDOWN_TARGET = path.join(
  ROOT,
  '.agents',
  'skills',
  'zhenzhen-canvas',
  'references',
  'generated-capability-coverage.md',
);

const {
  publicCreativeCapabilityBindings,
} = require(path.join(ROOT, 'backend', 'src', 'services', 'agentControlCapabilityHandlers.js'));

const {
  digestAgentResult,
} = require(path.join(ROOT, 'backend', 'src', 'services', 'canvasAgentPublicView.js'));
const {
  assertCapabilityCoverageReceipt,
  buildCapabilityCoverageReceipt,
} = require('../src/capabilityCoverage.cjs');
const COVERAGE_OPERATIONS = Object.freeze([
  'plan',
  'preview',
  'apply',
  'run',
  'verify',
  'resume',
  'rollback',
]);
const READ_ONLY_OPERATIONS = new Set(['inspect', 'plan', 'preview', 'compare', 'verify']);
const EXTERNAL_APPLY_CAPABILITIES = new Set(['asset.import', 'delivery.package']);
const LOCAL_RUN_CAPABILITIES = new Set([
  'video.extract-frames',
  'image.remove-solid-background',
  'image.resample-upscale',
]);
const NODE_ACCOUNTING_DISPOSITIONS = Object.freeze({
  'rh-config': Object.freeze({
    status: 'internal-compat',
    reasonCode: 'deprecated-runtime-config-compatibility',
    semanticCapabilityIds: [],
    evidence: [
      'backend/src/shared/canvasNodeSchema.json',
      'SKILL.md',
    ],
  }),
  'multi-angle-3d': Object.freeze({
    status: 'semantic-superseded',
    reasonCode: 'legacy-image-preset-replaced-by-create-image',
    semanticCapabilityIds: ['create.image'],
    evidence: ['src/components/nodes/PresetImageNode.tsx'],
  }),
  'panorama-720': Object.freeze({
    status: 'semantic-superseded',
    reasonCode: 'legacy-image-preset-replaced-by-create-image',
    semanticCapabilityIds: ['create.image'],
    evidence: ['src/components/nodes/PresetImageNode.tsx'],
  }),
  'penguin-portrait': Object.freeze({
    status: 'semantic-superseded',
    reasonCode: 'legacy-portrait-preset-replaced-by-image-and-story-capabilities',
    semanticCapabilityIds: ['create.image', 'create.story'],
    evidence: ['src/components/nodes/PresetImageNode.tsx'],
  }),
  'portrait-metadata': Object.freeze({
    status: 'semantic-superseded',
    reasonCode: 'legacy-parameter-card-replaced-by-story-character-bible',
    semanticCapabilityIds: ['create.story'],
    evidence: ['src/components/nodes/PortraitMetadataNode.tsx'],
  }),
  'storyboard-grid': Object.freeze({
    status: 'semantic-superseded',
    reasonCode: 'legacy-grid-replaced-by-story-and-director-workbench',
    semanticCapabilityIds: ['create.story', 'director.materialize'],
    evidence: ['src/components/nodes/StoryboardGridNode.tsx'],
  }),
  browser: Object.freeze({
    status: 'semantic-superseded',
    reasonCode: 'unsafe-generic-iframe-isolated-behind-browser-handoff',
    semanticCapabilityIds: ['browser.handoff'],
    evidence: [
      'src/components/nodes/BrowserNode.tsx',
      'backend/src/services/agentControlBrowser.js',
    ],
  }),
  edit: Object.freeze({
    status: 'semantic-superseded',
    reasonCode: 'legacy-image-renderer-alias-replaced-by-edit-image',
    semanticCapabilityIds: ['edit.image'],
    evidence: ['src/components/Canvas.tsx'],
  }),
  'video-output': Object.freeze({
    status: 'semantic-superseded',
    reasonCode: 'legacy-video-sink-replaced-by-output-and-delivery',
    semanticCapabilityIds: ['video-edit.compose', 'delivery.package'],
    evidence: ['src/components/nodes/VideoOutputNode.tsx'],
  }),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function operationPolicy(capability, operation) {
  const name = String(operation || '').trim();
  let riskLevel = String(capability?.approval || 'L2');
  let boundary = 'provider-or-external';
  if (READ_ONLY_OPERATIONS.has(name)) {
    riskLevel = 'L0';
    boundary = 'local-read';
  } else if (name === 'apply') {
    if (EXTERNAL_APPLY_CAPABILITIES.has(String(capability?.id || ''))) {
      riskLevel = 'L2';
      boundary = 'external-read-or-transfer';
    } else {
      riskLevel = 'L1';
      boundary = 'reversible-canvas-write';
    }
  } else if (name === 'rollback' || name === 'cancel') {
    riskLevel = 'L1';
    boundary = 'recovery-write';
  } else if (name === 'run' || name === 'resume') {
    const localRun = LOCAL_RUN_CAPABILITIES.has(String(capability?.id || ''));
    riskLevel = localRun ? 'L1' : capability?.approval === 'L3' ? 'L3' : 'L2';
    boundary = localRun ? 'local-compute' : 'provider-or-external';
  }
  const retainSensitivePreviewScope = name === 'preview'
    && ['asset.import', 'delivery.package', 'browser.handoff'].includes(String(capability?.id || ''));
  const requiredScopes = (capability?.requiredScopes || []).filter((scope) => (
    riskLevel !== 'L0' || String(scope).endsWith(':read') || retainSensitivePreviewScope
  ));
  return {
    operation: name,
    riskLevel,
    approvalRequired: riskLevel !== 'L0',
    boundary,
    requiredScopes,
  };
}

function staticRuntimeCompatibility(provider, available = true) {
  const privateRuntime = String(provider || '') === 'grok-oauth';
  return {
    known: true,
    installed: privateRuntime ? null : true,
    credentialReady: null,
    regionReady: privateRuntime ? null : true,
    executable: false,
    available: available !== false,
    requiresRuntimeCheck: true,
  };
}

function readCanvasNodeSchema(filename = NODE_SCHEMA_SOURCE) {
  const raw = fs.readFileSync(filename);
  const schema = JSON.parse(raw.toString('utf8'));
  if (schema?.schema !== 't8-canvas-node-schema-v1' || !Array.isArray(schema.types)) {
    throw new Error('Canvas node schema is invalid');
  }
  const seen = new Set();
  for (const node of schema.types) {
    const type = String(node?.type || '').trim();
    if (!type || seen.has(type)) {
      throw new Error(`Canvas node schema contains invalid or duplicate type: ${type || '(empty)'}`);
    }
    seen.add(type);
  }
  return {
    raw,
    schema,
    digest: sha256CanonicalText(raw),
    protocolDigest: digestAgentResult(schema),
  };
}

function runtimeEntries(runtimeCatalog) {
  const entries = [];
  for (const kind of ['llm', 'image', 'video', 'audio']) {
    for (const item of runtimeCatalog?.[kind] || []) {
      entries.push({
        id: item.id,
        kind,
        provider: item.provider,
        platformLabel: item.platformLabel,
        model: item.model,
        label: item.label,
        family: item.family,
        available: item.available !== false,
        catalogSection: kind,
        compatibility: staticRuntimeCompatibility(item.provider, item.available),
      });
    }
  }
  for (const item of runtimeCatalog?.actions || []) {
    entries.push({
      id: item.id,
      kind: item.kind,
      provider: item.provider,
      platformLabel: item.platformLabel,
      action: item.action,
      label: item.label,
      family: item.family,
      resultKind: item.resultKind,
      available: true,
      catalogSection: 'actions',
      compatibility: staticRuntimeCompatibility(item.provider, true),
    });
  }
  return entries.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function resolveCapabilityNodeTypes(capability, nodeSchema) {
  const explicitList = (capability?.nodeTypes || []).map((value) => String(value || '').trim());
  const explicit = new Set(explicitList);
  const selector = String(capability?.nodeTypeSelector || '').trim();
  const known = new Set(nodeSchema.types.map((node) => String(node.type)));
  const unknown = [...explicit].filter((type) => !known.has(type));
  const nodeTypes = explicitList.filter((type) => known.has(type));
  if (selector === 'creator-visible') {
    for (const node of nodeSchema.types) {
      const type = String(node.type);
      if (node.hidden !== true && !explicit.has(type)) {
        nodeTypes.push(type);
      }
    }
  }
  return {
    nodeTypes,
    unknown,
  };
}

function buildCapabilityGraph(options = {}) {
  const manifest = options.manifest;
  const manifestDigest = String(options.manifestDigest || '').trim();
  const runtimeCatalog = options.runtimeCatalog;
  if (!manifest || !manifestDigest || !runtimeCatalog) {
    throw new Error('Capability graph requires manifest, manifestDigest, and runtimeCatalog');
  }
  const nodeSchemaRecord = options.nodeSchemaRecord || readCanvasNodeSchema();
  const nodeTypes = new Map(nodeSchemaRecord.schema.types.map((node) => [String(node.type), node]));
  const capabilityByNode = new Map();
  const unknownNodeReferences = [];
  const resolvedCapabilities = manifest.capabilities.map((capability) => {
    const resolved = resolveCapabilityNodeTypes(capability, nodeSchemaRecord.schema);
    for (const nodeType of resolved.unknown) {
      unknownNodeReferences.push({ capabilityId: capability.id, nodeType });
    }
    return {
      ...capability,
      nodeTypes: resolved.nodeTypes,
    };
  });

  for (const capability of resolvedCapabilities) {
    for (const rawType of capability.nodeTypes) {
      const type = String(rawType || '').trim();
      if (!nodeTypes.has(type)) {
        unknownNodeReferences.push({ capabilityId: capability.id, nodeType: type });
        continue;
      }
      if (!capabilityByNode.has(type)) capabilityByNode.set(type, []);
      capabilityByNode.get(type).push(capability);
    }
  }
  if (unknownNodeReferences.length) {
    const summary = unknownNodeReferences
      .map((item) => `${item.capabilityId} -> ${item.nodeType || '(empty)'}`)
      .join(', ');
    throw new Error(`Creative capability manifest references unknown canvas node types: ${summary}`);
  }

  const bindings = publicCreativeCapabilityBindings(manifest)
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const capabilityIds = new Set(resolvedCapabilities.map((capability) => String(capability.id)));
  const declaredAccountingTypes = new Set(Object.keys(NODE_ACCOUNTING_DISPOSITIONS));
  const usedAccountingTypes = new Set();
  const nodes = nodeSchemaRecord.schema.types.map((node) => {
    const references = (capabilityByNode.get(node.type) || [])
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id));
    const supports = new Set(references.flatMap((capability) => capability.supports || []));
    const operations = Object.fromEntries(
      COVERAGE_OPERATIONS.map((operation) => [operation, supports.has(operation)]),
    );
    const disposition = references.length
      ? null
      : NODE_ACCOUNTING_DISPOSITIONS[String(node.type)] || null;
    if (disposition) usedAccountingTypes.add(String(node.type));
    const accounting = references.length
      ? {
          status: 'direct-capability',
          reasonCode: 'registered-capability-reference',
          semanticCapabilityIds: references.map((capability) => capability.id),
          evidence: ['tools/zcanvas-cli/creativeCapabilityManifest.json'],
        }
      : disposition
        ? {
            ...disposition,
            semanticCapabilityIds: [...disposition.semanticCapabilityIds],
            evidence: [...disposition.evidence],
          }
        : {
            status: 'unexplained',
            reasonCode: 'missing-node-accounting-disposition',
            semanticCapabilityIds: [],
            evidence: [],
          };
    const invalidSemanticIds = accounting.semanticCapabilityIds
      .filter((capabilityId) => !capabilityIds.has(String(capabilityId)));
    if (invalidSemanticIds.length) {
      throw new Error(
        `Creative capability graph node ${node.type} references unknown semantic capabilities: `
        + invalidSemanticIds.join(', '),
      );
    }
    return {
      type: node.type,
      label: node.label,
      description: node.description,
      category: node.category,
      hidden: node.hidden === true,
      executable: node.executable === true,
      generatable: node.generatable === true,
      agentExposure: accounting.status,
      coverageReason: accounting.reasonCode,
      accounting,
      inputs: [...(node.ports?.inputs || [])],
      outputs: [...(node.ports?.outputs || [])],
      capabilityIds: references.map((capability) => capability.id),
      handlerIds: references.map((capability) => capability.handler),
      coverage: {
        understand: true,
        ...operations,
        recover: operations.resume || operations.rollback,
      },
    };
  });

  const runtime = runtimeEntries(runtimeCatalog);
  const providerCounts = {};
  for (const entry of runtime) {
    providerCounts[entry.provider] = (providerCounts[entry.provider] || 0) + 1;
  }
  const referencedNodes = nodes.filter((node) => node.capabilityIds.length > 0);
  const staleAccountingTypes = [...declaredAccountingTypes]
    .filter((nodeType) => !usedAccountingTypes.has(nodeType));
  if (staleAccountingTypes.length) {
    throw new Error(
      'Creative capability graph has stale node accounting declarations: '
      + staleAccountingTypes.join(', '),
    );
  }
  const internalCompatNodes = nodes.filter((node) => node.accounting.status === 'internal-compat');
  const semanticSupersededNodes = nodes.filter((node) => node.accounting.status === 'semantic-superseded');
  const publicCapabilityGaps = nodes.filter((node) => node.accounting.status === 'public-capability-gap');
  const unexplainedNodes = nodes.filter((node) => node.accounting.status === 'unexplained');
  if (unexplainedNodes.length) {
    throw new Error(
      'Creative capability graph has unexplained canvas nodes: '
      + unexplainedNodes.map((node) => node.type).join(', '),
    );
  }
  const accountedNodes = referencedNodes.length
    + internalCompatNodes.length
    + semanticSupersededNodes.length
    + publicCapabilityGaps.length;
  const fullyOperableNodes = nodes.filter((node) => (
    node.coverage.plan
    && node.coverage.preview
    && node.coverage.apply
    && node.coverage.run
    && node.coverage.verify
  ));
  const capabilityOperations = resolvedCapabilities.flatMap((capability) => (
    capability.supports.map((operation) => ({
      capabilityId: capability.id,
      ...operationPolicy(capability, operation),
    }))
  ));
  const operationRiskByLevel = Object.fromEntries(
    ['L0', 'L1', 'L2', 'L3'].map((level) => [
      level,
      capabilityOperations.filter((operation) => operation.riskLevel === level).length,
    ]),
  );
  const bindingDigest = sha256(JSON.stringify(bindings));
  const runtimeArtifactDigest = sha256(`${JSON.stringify(runtimeCatalog, null, 2)}\n`);
  const sourceDigests = {
    creativeCapabilityManifest: manifestDigest,
    canvasNodeSchema: nodeSchemaRecord.protocolDigest,
    canvasNodeSchemaFile: nodeSchemaRecord.digest,
    i18nNodeCatalog: sha256CanonicalText(fs.readFileSync(I18N_NODE_CATALOG_SOURCE)),
    i18nRendererResources: sha256CanonicalText(fs.readFileSync(I18N_RENDERER_RESOURCES_SOURCE)),
    i18nElectronCatalog: sha256CanonicalText(fs.readFileSync(I18N_ELECTRON_CATALOG_SOURCE)),
    runtimeCatalogSources: String(runtimeCatalog.sourceDigest || ''),
    runtimeCatalogArtifact: runtimeArtifactDigest,
    handlerBindings: bindingDigest,
    capabilityGraphCompiler: sha256CanonicalText(fs.readFileSync(__filename)),
    coverageReceiptCompiler: sha256CanonicalText(fs.readFileSync(COVERAGE_RECEIPT_SOURCE)),
    canonicalTextDigestCompiler: sha256CanonicalText(fs.readFileSync(CANONICAL_TEXT_DIGEST_SOURCE)),
  };
  const aggregateDigest = sha256(JSON.stringify(sourceDigests));

  const graph = {
    schema: 't8-creative-capability-graph-v1',
    generatedFrom: {
      capabilityManifest: 'tools/zcanvas-cli/creativeCapabilityManifest.json',
      canvasNodeSchema: 'backend/src/shared/canvasNodeSchema.json',
      i18nNodeCatalog: 'src/i18n/nodeCatalog.ts',
      i18nRendererResources: 'src/i18n/resources.ts',
      i18nElectronCatalog: 'electron/i18n-catalog.json',
      runtimeCatalog: runtimeCatalog.generatedFrom || [],
      handlerRegistry: 'backend/src/services/agentControlCapabilityHandlers.js',
      coverageReceiptCompiler: 'tools/zcanvas-cli/src/capabilityCoverage.cjs',
    },
    sourceDigests,
    aggregateDigest,
    principles: manifest.principles,
    counts: {
      capabilities: manifest.capabilities.length,
      handlers: bindings.length,
      nodes: nodes.length,
      executableNodes: nodes.filter((node) => node.executable).length,
      generatableNodes: nodes.filter((node) => node.generatable).length,
      referencedNodes: referencedNodes.length,
      unreferencedNodes: nodes.length - referencedNodes.length,
      directCapabilityNodes: referencedNodes.length,
      internalCompatNodes: internalCompatNodes.length,
      semanticSupersededNodes: semanticSupersededNodes.length,
      publicCapabilityGapNodes: publicCapabilityGaps.length,
      accountedNodes,
      unexplainedNodes: unexplainedNodes.length,
      fullyOperableNodes: fullyOperableNodes.length,
      runtimeEntries: runtime.length,
      runtimeByKind: { ...runtimeCatalog.counts },
      runtimeByProvider: providerCounts,
      operations: capabilityOperations.length,
      operationRiskByLevel,
      missingOperationRisk: 0,
      unknownNodeReferences: 0,
    },
    capabilities: resolvedCapabilities.map((capability) => ({
      id: capability.id,
      creatorLabel: capability.creatorLabel,
      category: capability.category,
      approval: capability.approval,
      handler: capability.handler,
      cli: { ...capability.cli },
      uiAction: capability.id,
      nodeTypes: [...capability.nodeTypes],
      supports: [...capability.supports],
      operations: capability.supports.map((operation) => operationPolicy(capability, operation)),
      evidence: [...capability.evidence],
    })),
    bindings,
    nodes,
    runtime: {
      schema: runtimeCatalog.schema,
      sourceDigest: runtimeCatalog.sourceDigest,
      platforms: runtimeCatalog.platforms || [],
      entries: runtime,
    },
    gaps: {
      unknownNodeReferences: [],
      unreferencedNodeTypes: nodes
        .filter((node) => node.capabilityIds.length === 0)
        .map((node) => node.type),
      unexplainedNodeTypes: unexplainedNodes.map((node) => node.type),
      internalCompatNodes: internalCompatNodes.map((node) => ({
        nodeType: node.type,
        label: node.label,
        accounting: node.accounting,
      })),
      semanticSupersededNodes: semanticSupersededNodes.map((node) => ({
        nodeType: node.type,
        label: node.label,
        accounting: node.accounting,
      })),
      publicCapabilityGaps: publicCapabilityGaps.map((node) => ({
        nodeType: node.type,
        label: node.label,
        executable: node.executable,
        proposedCapabilityId: node.accounting.proposedCapabilityId,
        accounting: node.accounting,
      })),
      referencedWithoutRun: referencedNodes
        .filter((node) => !node.coverage.run)
        .map((node) => node.type),
      missingOperationRisk: [],
      missingHandlers: [],
      missingVerification: [],
      missingCompatibilityEdges: [],
      runtimeRequiringReadinessCheck: runtime.map((entry) => entry.id),
    },
  };
  graph.coverageReceipt = buildCapabilityCoverageReceipt(graph);
  graph.counts.missingHandlers = graph.coverageReceipt.gaps.missingHandlers.length;
  graph.counts.missingVerification = graph.coverageReceipt.gaps.missingVerification.length;
  graph.counts.missingCompatibilityEdges = graph.coverageReceipt.gaps.missingCompatibilityEdges.length;
  graph.gaps.missingHandlers = [...graph.coverageReceipt.gaps.missingHandlers];
  graph.gaps.missingVerification = [...graph.coverageReceipt.gaps.missingVerification];
  graph.gaps.missingCompatibilityEdges = [...graph.coverageReceipt.gaps.missingCompatibilityEdges];
  assertCapabilityCoverageReceipt(graph);
  return graph;
}

function graphArtifact(graph) {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

function coverageMarkdownArtifact(graph) {
  const lines = [
    '# Generated Creator Agent capability coverage',
    '',
    '> Machine-generated from the real Canvas Node Schema, creative capability manifest,',
    '> runtime model/action catalog, and handler bindings. Do not edit by hand.',
    '',
    `- Aggregate SHA-256: \`${graph.aggregateDigest}\``,
    `- Capabilities / handlers: **${graph.counts.capabilities} / ${graph.counts.handlers}**`,
    `- Canvas nodes: **${graph.counts.nodes}**`,
    `- Referenced / unreferenced nodes: **${graph.counts.referencedNodes} / ${graph.counts.unreferencedNodes}**`,
    `- Accounted / unexplained nodes: **${graph.counts.accountedNodes} / ${graph.counts.unexplainedNodes}**`,
    `- Direct capability nodes: **${graph.counts.directCapabilityNodes}**`,
    `- Internal compatibility nodes: **${graph.counts.internalCompatNodes}**`,
    `- Semantically superseded nodes: **${graph.counts.semanticSupersededNodes}**`,
    `- Public capability gaps: **${graph.counts.publicCapabilityGapNodes}**`,
    `- Fully operable nodes: **${graph.counts.fullyOperableNodes}**`,
    `- Runtime model/action entries: **${graph.counts.runtimeEntries}**`,
    `- Dynamic node inventory (total / executable / generatable): **${graph.coverageReceipt.inventory.nodes.total} / ${graph.coverageReceipt.inventory.nodes.executable} / ${graph.coverageReceipt.inventory.nodes.generatable}**`,
    `- Dynamic runtime inventory (LLM / image / video / audio / actions): **${graph.coverageReceipt.inventory.runtime.llm} / ${graph.coverageReceipt.inventory.runtime.image} / ${graph.coverageReceipt.inventory.runtime.video} / ${graph.coverageReceipt.inventory.runtime.audio} / ${graph.coverageReceipt.inventory.runtime.actions}**`,
    `- Operation risk contracts: **${graph.counts.operations}** `
      + `(L0 ${graph.counts.operationRiskByLevel.L0}, L1 ${graph.counts.operationRiskByLevel.L1}, `
      + `L2 ${graph.counts.operationRiskByLevel.L2}, L3 ${graph.counts.operationRiskByLevel.L3})`,
    `- Unknown node references: **${graph.counts.unknownNodeReferences}**`,
    `- Coverage receipt: \`${graph.coverageReceipt.schema}\` / \`${graph.coverageReceipt.digest}\``,
    '',
    '“Understand” means the node exists in the authoritative schema. Other columns are true only',
    'when at least one registered high-level capability explicitly advertises that operation.',
    '',
    '| Node | Category | Agent exposure | Exec | Gen | Capabilities | Plan | Preview | Apply | Run | Verify | Recover |',
    '| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const node of graph.nodes) {
    const yes = (value) => (value ? 'yes' : '—');
    lines.push(
      `| \`${node.type}\` ${node.label || ''} | ${node.category || ''} | ${node.agentExposure} | `
      + `${yes(node.executable)} | `
      + `${yes(node.generatable)} | ${node.capabilityIds.map((id) => `\`${id}\``).join(', ') || '—'} | `
      + `${yes(node.coverage.plan)} | ${yes(node.coverage.preview)} | ${yes(node.coverage.apply)} | `
      + `${yes(node.coverage.run)} | ${yes(node.coverage.verify)} | ${yes(node.coverage.recover)} |`,
    );
  }
  lines.push(
    '',
    '## Runtime catalog',
    '',
    'Catalog presence only means “known”. Every runtime entry is generated fail-closed and must',
    'receive installed / credential / region readiness at request time before it is executable.',
    '',
    ...Object.entries(graph.counts.runtimeByKind || {})
      .map(([kind, count]) => `- ${kind}: **${count}**`),
    '',
    '## Coverage audit',
    '',
    `- Nodes without direct capability binding: ${graph.gaps.unreferencedNodeTypes.map((type) => `\`${type}\``).join(', ') || 'none'}`,
    `- Unexplained node types: ${graph.gaps.unexplainedNodeTypes.map((type) => `\`${type}\``).join(', ') || 'none'}`,
    `- Internal compatibility: ${graph.gaps.internalCompatNodes.map((item) => `\`${item.nodeType}\``).join(', ') || 'none'}`,
    `- Semantically superseded: ${graph.gaps.semanticSupersededNodes.map((item) => `\`${item.nodeType}\``).join(', ') || 'none'}`,
    `- Public capability gaps: ${graph.gaps.publicCapabilityGaps
      .map((item) => `\`${item.nodeType}\` → \`${item.proposedCapabilityId}\``).join(', ') || 'none'}`,
    `- Referenced without run coverage: ${graph.gaps.referencedWithoutRun.map((type) => `\`${type}\``).join(', ') || 'none'}`,
    `- Operations without risk contracts: ${graph.gaps.missingOperationRisk.length || 'none'}`,
    `- Capabilities without handlers: ${graph.gaps.missingHandlers.length || 'none'}`,
    `- Capabilities without verification contracts: ${graph.gaps.missingVerification.length || 'none'}`,
    `- Runtime entries without compatibility edges: ${graph.gaps.missingCompatibilityEdges.length || 'none'}`,
    '',
    'Accounting is separate from operation coverage. `semantic-superseded` records the modern high-level',
    'capability that replaces a legacy renderer without inheriting its plan/run/verify flags.',
    '`public-capability-gap` is deliberately visible debt: the Canvas has a real execution boundary, but',
    'the Agent still needs a dedicated truthful handler before it may claim direct run/verify coverage.',
    'A new or changed node fails the compiler until it has either a real capability or an explicit audited',
    'disposition. Stale dispositions also fail once a direct capability is added.',
    '',
  );
  return lines.join('\n');
}

module.exports = {
  BACKEND_TARGET,
  CLI_TARGET,
  COVERAGE_OPERATIONS,
  MARKDOWN_TARGET,
  NODE_ACCOUNTING_DISPOSITIONS,
  NODE_SCHEMA_SOURCE,
  buildCapabilityGraph,
  coverageMarkdownArtifact,
  graphArtifact,
  readCanvasNodeSchema,
  resolveCapabilityNodeTypes,
  runtimeEntries,
  sha256,
  operationPolicy,
  staticRuntimeCompatibility,
};
