'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  sha256CanonicalText,
} = require('./canonicalTextDigest.cjs');
const {
  COMMAND_CATALOG_PATH,
  CREATIVE_CAPABILITY_GRAPH_PATH,
  CREATIVE_CAPABILITY_SURFACES_PATH,
  CREATIVE_CAPABILITY_MANIFEST_PATH,
  MANIFEST_PATH,
} = require('./constants.cjs');
const {
  assertCapabilityCoverageReceipt,
} = require('./capabilityCoverage.cjs');

let cached = null;
const APPROVAL_LEVELS = new Set(['L0', 'L1', 'L2', 'L3']);
const READ_ONLY_OPERATIONS = new Set(['inspect', 'plan', 'preview', 'compare', 'verify']);

function validateNodeCoverage(capabilityGraph) {
  const nodes = Array.isArray(capabilityGraph.nodes) ? capabilityGraph.nodes : [];
  const referenced = nodes.filter((node) => (node.capabilityIds || []).length > 0);
  const direct = nodes.filter((node) => node.accounting?.status === 'direct-capability');
  const internal = nodes.filter((node) => node.accounting?.status === 'internal-compat');
  const superseded = nodes.filter((node) => node.accounting?.status === 'semantic-superseded');
  const publicGaps = nodes.filter((node) => node.accounting?.status === 'public-capability-gap');
  const unexplained = nodes.filter((node) => node.accounting?.status === 'unexplained');
  const accountingStatuses = new Set([
    'direct-capability',
    'internal-compat',
    'semantic-superseded',
    'public-capability-gap',
    'unexplained',
  ]);
  const nodeMetadataValid = nodes.every((node) => {
    const referencedNode = (node.capabilityIds || []).length > 0;
    const accounting = node.accounting;
    if (!accounting || !accountingStatuses.has(String(accounting.status))
      || node.agentExposure !== accounting.status
      || node.coverageReason !== accounting.reasonCode
      || !String(accounting.reasonCode || '')
      || !Array.isArray(accounting.semanticCapabilityIds)
      || !Array.isArray(accounting.evidence)
      || accounting.evidence.length === 0) return false;
    if (referencedNode !== (accounting.status === 'direct-capability')) return false;
    if (referencedNode
      && JSON.stringify(accounting.semanticCapabilityIds) !== JSON.stringify(node.capabilityIds)) return false;
    if (!referencedNode && node.hidden !== true) return false;
    if (accounting.status === 'public-capability-gap') {
      return node.executable === true && Boolean(String(accounting.proposedCapabilityId || ''));
    }
    return accounting.status !== 'unexplained';
  });
  const listMatches = (items, expected, property = 'nodeType') => (
    Array.isArray(items)
    && items.length === expected.length
    && new Set(items.map((item) => String(property ? item?.[property] : item || ''))).size === items.length
    && expected.every((node) => items.some((item) => (
      String(property ? item?.[property] : item || '') === String(node.type)
    )))
  );
  if (Number(capabilityGraph.counts?.nodes) !== nodes.length
    || Number(capabilityGraph.counts?.referencedNodes) !== referenced.length
    || Number(capabilityGraph.counts?.unreferencedNodes) !== nodes.length - referenced.length
    || Number(capabilityGraph.counts?.directCapabilityNodes) !== direct.length
    || Number(capabilityGraph.counts?.internalCompatNodes) !== internal.length
    || Number(capabilityGraph.counts?.semanticSupersededNodes) !== superseded.length
    || Number(capabilityGraph.counts?.publicCapabilityGapNodes) !== publicGaps.length
    || Number(capabilityGraph.counts?.accountedNodes) !== (
      direct.length + internal.length + superseded.length + publicGaps.length
    )
    || Number(capabilityGraph.counts?.accountedNodes) !== nodes.length
    || Number(capabilityGraph.counts?.unexplainedNodes) !== unexplained.length
    || unexplained.length !== 0
    || !listMatches(capabilityGraph.gaps?.unreferencedNodeTypes, nodes.filter((node) => (
      (node.capabilityIds || []).length === 0
    )), null)
    || !listMatches(capabilityGraph.gaps?.internalCompatNodes, internal)
    || !listMatches(capabilityGraph.gaps?.semanticSupersededNodes, superseded)
    || !listMatches(capabilityGraph.gaps?.publicCapabilityGaps, publicGaps)
    || (capabilityGraph.gaps?.unexplainedNodeTypes || []).length !== 0
    || !nodeMetadataValid
    || direct.length !== referenced.length) {
    throw new Error('zcanvas creative capability graph node coverage is incomplete');
  }
}

function validateCapabilityGraphContracts(capabilityGraph) {
  let operationCount = 0;
  const cliSurfaces = new Set();
  for (const capability of capabilityGraph.capabilities) {
    const cliCommand = String(capability?.cli?.command || '');
    const cliSubcommand = String(capability?.cli?.subcommand || '');
    const cliSurface = `${cliCommand}.${cliSubcommand}`;
    if (String(capability?.uiAction || '') !== String(capability?.id || '')
      || !/^[a-z][a-z0-9-]*$/.test(cliCommand)
      || !/^[a-z][a-z0-9-]*$/.test(cliSubcommand)
      || cliSurfaces.has(cliSurface)) {
      throw new Error(`zcanvas creative capability graph has invalid action surfaces for ${capability?.id || '(unknown)'}`);
    }
    cliSurfaces.add(cliSurface);
    const supports = Array.isArray(capability.supports) ? capability.supports : [];
    const operations = Array.isArray(capability.operations) ? capability.operations : [];
    if (operations.length !== supports.length) {
      throw new Error(`zcanvas creative capability graph is missing operation risk contracts for ${capability.id}`);
    }
    supports.forEach((operation, index) => {
      const policy = operations[index];
      if (policy?.operation !== operation
        || !APPROVAL_LEVELS.has(String(policy?.riskLevel || ''))
        || !Array.isArray(policy?.requiredScopes)
        || typeof policy?.approvalRequired !== 'boolean'
        || policy.approvalRequired !== (policy.riskLevel !== 'L0')
        || (READ_ONLY_OPERATIONS.has(operation) && policy.riskLevel !== 'L0')) {
        throw new Error(`zcanvas creative capability graph has invalid operation risk contract for ${capability.id}.${operation}`);
      }
    });
    operationCount += operations.length;
  }
  if (Number(capabilityGraph.counts?.operations) !== operationCount
    || Number(capabilityGraph.counts?.missingOperationRisk) !== 0
    || (capabilityGraph.gaps?.missingOperationRisk || []).length !== 0) {
    throw new Error('zcanvas creative capability graph operation risk coverage is incomplete');
  }
  validateNodeCoverage(capabilityGraph);
  for (const entry of capabilityGraph.runtime.entries) {
    const compatibility = entry?.compatibility;
    if (!compatibility || compatibility.known !== true
      || compatibility.executable !== false
      || compatibility.requiresRuntimeCheck !== true
      || typeof compatibility.available !== 'boolean'
      || ![true, false, null].includes(compatibility.installed)
      || ![true, false, null].includes(compatibility.credentialReady)
      || ![true, false, null].includes(compatibility.regionReady)) {
      throw new Error(`zcanvas creative capability graph has invalid runtime compatibility for ${entry?.id || '(unknown)'}`);
    }
  }
  assertCapabilityCoverageReceipt(capabilityGraph);
  return capabilityGraph;
}

function readManifest(options = {}) {
  // The desktop repairs same-version exports. Never reuse metadata from a
  // different directory or a previous read of files that may have been replaced.
  const useCache = !options.rootDirectory && options.disableCache !== true;
  if (useCache && cached) return cached;
  const root = options.rootDirectory ? path.resolve(options.rootDirectory) : null;
  const buffer = fs.readFileSync(root ? path.join(root, 'manifest.json') : MANIFEST_PATH);
  const commandBuffer = fs.readFileSync(root ? path.join(root, 'commandCatalog.json') : COMMAND_CATALOG_PATH);
  const capabilityBuffer = fs.readFileSync(root ? path.join(root, 'creativeCapabilityManifest.json') : CREATIVE_CAPABILITY_MANIFEST_PATH);
  const capabilityGraphBuffer = fs.readFileSync(root ? path.join(root, 'generated', 'creative-capability-graph.json') : CREATIVE_CAPABILITY_GRAPH_PATH);
  const capabilitySurfacesBuffer = fs.readFileSync(root ? path.join(root, 'generated', 'creative-capability-surfaces.json') : CREATIVE_CAPABILITY_SURFACES_PATH);
  const parsed = JSON.parse(buffer.toString('utf8'));
  const catalog = JSON.parse(commandBuffer.toString('utf8'));
  const capabilityManifest = JSON.parse(capabilityBuffer.toString('utf8'));
  const capabilityGraph = JSON.parse(capabilityGraphBuffer.toString('utf8'));
  const capabilitySurfaces = JSON.parse(capabilitySurfacesBuffer.toString('utf8'));
  const capabilityDigest = sha256CanonicalText(capabilityBuffer);
  if (parsed?.schema !== 't8-zcanvas-manifest-v1') throw new Error('zcanvas manifest schema invalid');
  if (parsed.commandCatalog !== 'commandCatalog.json'
    || parsed.creativeCapabilityGraph !== 'generated/creative-capability-graph.json'
    || parsed.creativeCapabilitySurfaces !== 'generated/creative-capability-surfaces.json'
    || parsed.creativeCapabilityManifest !== 'creativeCapabilityManifest.json'
    || catalog?.schema !== 't8-zcanvas-command-catalog-v1'
    || !Array.isArray(catalog.commands)
    || capabilityManifest?.schema !== 't8-creative-capability-manifest-v1'
    || !Array.isArray(capabilityManifest.capabilities)
    || capabilityGraph?.schema !== 't8-creative-capability-graph-v1'
    || !Array.isArray(capabilityGraph.capabilities)
    || capabilitySurfaces?.schema !== 't8-creative-capability-surfaces-v1'
    || capabilitySurfaces.capabilityManifestVersion !== capabilityManifest.version
    || !Array.isArray(capabilitySurfaces.capabilities)
    || capabilitySurfaces.sourceDigest !== capabilityDigest
    || capabilitySurfaces.capabilityGraphDigest !== capabilityGraph.aggregateDigest
    || capabilityGraph.sourceDigests?.creativeCapabilityManifest !== capabilityDigest
    || Number(capabilityGraph.counts?.unknownNodeReferences) !== 0) {
    throw new Error('zcanvas command catalog invalid');
  }
  const commandNames = catalog.commands.map((command) => String(command?.name || ''));
  if (commandNames.some((name) => !/^[a-z][a-z0-9-]*$/.test(name))
    || new Set(commandNames).size !== commandNames.length) {
    throw new Error('zcanvas command catalog contains invalid or duplicate commands');
  }
  const capabilityIds = capabilityManifest.capabilities.map((capability) => String(capability?.id || ''));
  if (capabilityIds.some((id) => !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id))
    || new Set(capabilityIds).size !== capabilityIds.length
    || capabilityManifest.capabilities.some((capability) => (
      !String(capability?.creatorLabel || '').trim()
      || !String(capability?.handler || '').trim()
      || !['L0', 'L1', 'L2', 'L3'].includes(String(capability?.approval || ''))
      || !Array.isArray(capability?.requiredScopes)
      || !Array.isArray(capability?.supports)
      || !Array.isArray(capability?.evidence)
    ))) {
    throw new Error('zcanvas creative capability manifest contains invalid or duplicate capabilities');
  }
  const graphCapabilityIds = capabilityGraph.capabilities.map((capability) => String(capability?.id || ''));
  const surfaceCapabilityIds = capabilitySurfaces.capabilities.map((capability) => String(capability?.id || ''));
  if (graphCapabilityIds.length !== capabilityIds.length
    || graphCapabilityIds.some((id, index) => id !== capabilityIds[index])
    || surfaceCapabilityIds.length !== capabilityIds.length
    || surfaceCapabilityIds.some((id, index) => id !== capabilityIds[index])) {
    throw new Error('zcanvas creative capability graph drifted from the capability manifest');
  }
  for (let index = 0; index < capabilityManifest.capabilities.length; index += 1) {
    const capability = capabilityManifest.capabilities[index];
    const graphCapability = capabilityGraph.capabilities[index];
    const surface = capabilitySurfaces.capabilities[index];
    if (String(graphCapability?.uiAction || '') !== capability.id
      || String(graphCapability?.cli?.command || '') !== String(capability?.cli?.command || '')
      || String(graphCapability?.cli?.subcommand || '') !== String(capability?.cli?.subcommand || '')
      || String(surface?.ui?.action || '') !== capability.id
      || String(surface?.cli?.command || '') !== String(capability?.cli?.command || '')
      || String(surface?.cli?.subcommand || '') !== String(capability?.cli?.subcommand || '')
      || String(surface?.agentTool?.version || '') !== String(capabilityManifest.version || '')
      || surface?.agentTool?.protocol !== 't8-versioned-creative-tool-v1'
      || surface?.agentTool?.requestSchema !== 't8-versioned-creative-tool-request-v1'
      || surface?.agentTool?.resultSchema !== 't8-versioned-creative-tool-result-v1'
      || !Array.isArray(surface?.agentTool?.directOperations)
      || !surface.agentTool.directOperations.includes(surface.agentTool.defaultOperation)) {
      throw new Error(`zcanvas creative capability action surfaces drifted for ${capability.id}`);
    }
  }
  validateCapabilityGraphContracts(capabilityGraph);
  const graphCapabilityById = new Map(
    capabilityGraph.capabilities.map((capability) => [capability.id, capability]),
  );

  const result = Object.freeze({
    ...parsed,
    commands: Object.freeze(commandNames),
    creativeCapabilities: Object.freeze(capabilityManifest.capabilities.map((capability) => Object.freeze({
      ...capability,
      operations: Object.freeze((graphCapabilityById.get(capability.id)?.operations || []).map((operation) => Object.freeze({ ...operation }))),
    }))),
    commandCatalogDigest: crypto.createHash('sha256').update(commandBuffer).digest('hex'),
    creativeCapabilityManifestDigest: capabilityDigest,
    creativeCapabilityGraphDigest: capabilityGraph.aggregateDigest,
    creativeCapabilityGraphArtifactDigest: crypto.createHash('sha256').update(capabilityGraphBuffer).digest('hex'),
    creativeCapabilitySurfaces: Object.freeze(capabilitySurfaces.capabilities.map((capability) => Object.freeze({ ...capability }))),
    creativeCapabilitySurfacesDigest: crypto.createHash('sha256').update(capabilitySurfacesBuffer).digest('hex'),
    creativeCapabilityCoverage: Object.freeze({
      counts: Object.freeze({ ...capabilityGraph.counts }),
      gaps: Object.freeze({ ...capabilityGraph.gaps }),
      coverageReceipt: Object.freeze(JSON.parse(JSON.stringify(capabilityGraph.coverageReceipt))),
      staticRuntime: Object.freeze({
        known: capabilityGraph.runtime.entries.length,
        executable: 0,
        requiresLiveReadiness: capabilityGraph.runtime.entries.length,
      }),
    }),
    manifestDigest: crypto.createHash('sha256')
      .update(buffer)
      .update(commandBuffer)
      .update(capabilityBuffer)
      .update(capabilityGraphBuffer)
      .update(capabilitySurfacesBuffer)
      .digest('hex'),
  });
  if (useCache) cached = result;
  return result;
}

module.exports = {
  readManifest,
  validateCapabilityGraphContracts,
};
