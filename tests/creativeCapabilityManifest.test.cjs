'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  publicCreativeCapabilities,
  publicCreativeCapabilityGraph,
  readCreativeCapabilityManifest,
  readCreativeCapabilityGraph,
  validateCreativeCapabilityManifest,
  validateCreativeCapabilityGraph,
} = require('../backend/src/services/agentControlCapabilities.js');
const {
  publicCreativeCapabilityBindings,
  resolveCreativeCapabilityHandler,
} = require('../backend/src/services/agentControlCapabilityHandlers.js');
const {
  publicVersionedCapabilityToolCatalog,
} = require('../backend/src/services/agentControlCapabilityTools.js');
const {
  readManifest,
  validateCapabilityGraphContracts,
} = require('../tools/zcanvas-cli/src/manifest.cjs');
const {
  COMMAND_CATALOG_SOURCE,
  COMMAND_CATALOG_TARGET,
  JSON_TARGET,
  MARKDOWN_TARGET,
  SURFACES_BACKEND_TARGET,
  SURFACES_CLI_TARGET,
  SURFACES_UI_TARGET,
  SURFACES_SKILL_TARGET,
  buildCommandCatalog,
  buildCapabilitySurfaces,
  capabilitySurfacesArtifact,
  commandCatalogArtifact,
  jsonArtifact,
  markdownArtifact,
  readManifest: readGeneratorManifest,
} = require('../tools/zcanvas-cli/scripts/generateCreativeCapabilityArtifacts.cjs');
const {
  BACKEND_TARGET: GRAPH_BACKEND_TARGET,
  CLI_TARGET: GRAPH_CLI_TARGET,
  MARKDOWN_TARGET: GRAPH_MARKDOWN_TARGET,
  buildCapabilityGraph,
  coverageMarkdownArtifact,
  graphArtifact,
} = require('../tools/zcanvas-cli/scripts/creativeCapabilityGraphArtifacts.cjs');
const {
  buildRuntimeCatalog,
} = require('../tools/zcanvas-cli/scripts/generateCreativeRuntimeCatalog.cjs');
const { operationCapabilities } = require('../tools/zcanvas-cli/src/cli.cjs');
const {
  assertCapabilityCoverageReceipt,
  buildCapabilityCoverageReceipt,
} = require('../tools/zcanvas-cli/src/capabilityCoverage.cjs');
const {
  canonicalTextBytes,
  sha256CanonicalText,
} = require('../tools/zcanvas-cli/src/canonicalTextDigest.cjs');


const ROOT = path.resolve(__dirname, '..');

test('creative capability text digests are stable across Windows and Unix line endings', () => {
  const lf = '{"schema":"example"}\nline two\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const cr = lf.replace(/\n/g, '\r');
  assert.equal(canonicalTextBytes(crlf).toString('utf8'), lf);
  assert.equal(canonicalTextBytes(cr).toString('utf8'), lf);
  assert.equal(sha256CanonicalText(lf), sha256CanonicalText(crlf));
  assert.equal(sha256CanonicalText(lf), sha256CanonicalText(cr));
});

test('creative capability manifest is one validated source for backend and zcanvas', () => {
  const backend = readCreativeCapabilityManifest({ disableCache: true });
  const graph = readCreativeCapabilityGraph({ manifest: backend, disableCache: true });
  const cli = readManifest();
  assert.equal(backend.schema, 't8-creative-capability-manifest-v1');
  assert.match(backend.digest, /^[a-f0-9]{64}$/);
  assert.equal(cli.creativeCapabilityManifestDigest, backend.digest);
  assert.equal(cli.creativeCapabilities.length, backend.capabilities.length);
  assert.deepEqual(
    cli.creativeCapabilities.map((item) => item.id),
    backend.capabilities.map((item) => item.id),
  );
  assert.equal(cli.creativeCapabilityGraphDigest, graph.aggregateDigest);
  assert.equal(graph.counts.unknownNodeReferences, 0);
  assert.equal(graph.nodes.some((node) => node.type === 'director-storyboard'), true);
  assert.equal(graph.nodes.some((node) => node.type === 'director-board'), false);
  assert.equal(
    cli.creativeCapabilityCoverage.counts.operations,
    graph.capabilities.reduce((sum, capability) => sum + capability.operations.length, 0),
  );
  assert.equal(cli.creativeCapabilityCoverage.counts.missingOperationRisk, 0);
  assert.deepEqual(cli.creativeCapabilityCoverage.staticRuntime, {
    known: graph.counts.runtimeEntries,
    executable: 0,
    requiresLiveReadiness: graph.counts.runtimeEntries,
  });
  assert.equal(cli.creativeCapabilities.every((item) => item.operations.length === item.supports.length), true);
});
test('creative capability manifest covers the one-sentence production spine', () => {
  const payload = publicCreativeCapabilities();
  const ids = new Set(payload.capabilities.map((capability) => capability.id));
  for (const required of [
    'create.image',
    'create.video',
    'create.audio',
    'create.script',
    'create.story',
    'canvas.node-add',
    'video.extract-frames',
    'image.remove-solid-background',
    'image.resample-upscale',
    'story.analyze',
    'story.bind-asset',
    'story.compile',
    'director.materialize',
    'video-edit.compose',
    'run.start',
    'asset.place',
    'asset.import',
    'delivery.package',
  ]) {
    assert.equal(ids.has(required), true, `missing capability ${required}`);
  }
  assert.equal(payload.principles.oneSentenceStart, true);
  assert.equal(payload.principles.directCanvasMutation, false);
  assert.equal(payload.principles.explicitApprovalForWrites, true);
  const nodeAdd = payload.capabilities.find((capability) => capability.id === 'canvas.node-add');
  assert.equal(nodeAdd.nodeTypeSelector, 'creator-visible');
  assert.equal(nodeAdd.nodeTypes.length, 69);
  assert.equal(nodeAdd.nodeTypes.includes('loop'), true);
  assert.equal(nodeAdd.nodeTypes.includes('remove-bg'), false);
});

test('creative capability manifest rejects duplicate ids, duplicate handlers, unsafe L0 writes, and unbound handlers', () => {
  const source = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'tools', 'zcanvas-cli', 'creativeCapabilityManifest.json'),
    'utf8',
  ));
  assert.throws(
    () => validateCreativeCapabilityManifest({
      ...source,
      capabilities: [...source.capabilities, source.capabilities[0]],
    }),
    /duplicate id/,
  );
  assert.throws(
    () => validateCreativeCapabilityManifest({
      ...source,
      capabilities: [{
        ...source.capabilities[0],
        id: 'unsafe.write',
        approval: 'L0',
      }],
    }),
    /cannot declare L0/,
  );
  assert.throws(
    () => validateCreativeCapabilityManifest({
      ...source,
      capabilities: [
        source.capabilities[0],
        {
          ...source.capabilities[1],
          handler: source.capabilities[0].handler,
        },
      ],
    }),
    /duplicates handler binding/,
  );
  assert.throws(
    () => validateCreativeCapabilityManifest({
      ...source,
      capabilities: [{
        ...source.capabilities[0],
        handler: 'creative-action:not-implemented',
      }],
    }),
    /uses an unbound handler/,
  );
  const nodeAdd = source.capabilities.find((capability) => capability.id === 'canvas.node-add');
  assert.deepEqual(nodeAdd.nodeTypes, []);
  assert.throws(
    () => validateCreativeCapabilityManifest({
      ...source,
      capabilities: [{
        ...nodeAdd,
        nodeTypeSelector: 'all-including-hidden',
      }],
    }),
    /invalid nodeTypeSelector/,
  );
});

test('capability graph validates real node types and fails closed on drift', () => {
  const { manifest, digest } = readGeneratorManifest();
  const runtimeCatalog = buildRuntimeCatalog();
  const graph = buildCapabilityGraph({ manifest, manifestDigest: digest, runtimeCatalog });
  assert.equal(graph.counts.nodes, 81);
  assert.equal(graph.counts.runtimeEntries, 269);
  assert.equal(
    graph.counts.operations,
    graph.capabilities.reduce((sum, capability) => sum + capability.operations.length, 0),
  );
  assert.equal(graph.counts.missingOperationRisk, 0);
  assert.equal(graph.counts.unknownNodeReferences, 0);
  assert.match(graph.aggregateDigest, /^[a-f0-9]{64}$/);
  assert.match(graph.sourceDigests.i18nNodeCatalog, /^[a-f0-9]{64}$/);
  assert.match(graph.sourceDigests.i18nRendererResources, /^[a-f0-9]{64}$/);
  assert.match(graph.sourceDigests.i18nElectronCatalog, /^[a-f0-9]{64}$/);
  assert.equal(graph.generatedFrom.i18nNodeCatalog, 'src/i18n/nodeCatalog.ts');
  assert.equal(graph.generatedFrom.i18nRendererResources, 'src/i18n/resources.ts');
  assert.equal(graph.generatedFrom.i18nElectronCatalog, 'electron/i18n-catalog.json');
  assert.deepEqual(
    graph.capabilities.find((capability) => capability.id === 'director.materialize').nodeTypes,
    ['story', 'director-storyboard'],
  );
  const nodeAdd = graph.capabilities.find((capability) => capability.id === 'canvas.node-add');
  assert.ok(nodeAdd);
  assert.equal(nodeAdd.nodeTypes.length, 69);
  assert.deepEqual(nodeAdd.nodeTypes, graph.nodes.filter((node) => !node.hidden).map((node) => node.type));
  assert.equal(graph.counts.referencedNodes, 72);
  assert.equal(graph.counts.unreferencedNodes, 9);
  assert.equal(graph.counts.directCapabilityNodes, 72);
  assert.equal(graph.counts.internalCompatNodes, 1);
  assert.equal(graph.counts.semanticSupersededNodes, 8);
  assert.equal(graph.counts.publicCapabilityGapNodes, 0);
  assert.equal(graph.counts.accountedNodes, 81);
  assert.equal(graph.counts.unexplainedNodes, 0);
  assert.equal(graph.counts.fullyOperableNodes, 19);
  assert.equal(graph.nodes.find((node) => node.type === 'minimax-h3-prompt-enhancer').coverage.run, true);
  assert.equal(graph.nodes.find((node) => node.type === 'loop').coverage.apply, true);
  assert.equal(graph.nodes.find((node) => node.type === 'loop').coverage.run, false);
  assert.equal(graph.nodes.find((node) => node.type === 'remove-bg').coverage.apply, true);
  assert.equal(graph.nodes.find((node) => node.type === 'remove-bg').coverage.run, true);
  assert.deepEqual(graph.gaps.unexplainedNodeTypes, []);
  assert.deepEqual(graph.gaps.internalCompatNodes.map((item) => item.nodeType), ['rh-config']);
  assert.deepEqual(
    graph.gaps.semanticSupersededNodes.map((item) => item.nodeType),
    [
      'multi-angle-3d',
      'panorama-720',
      'penguin-portrait',
      'portrait-metadata',
      'storyboard-grid',
      'browser',
      'edit',
      'video-output',
    ],
  );
  assert.deepEqual(graph.gaps.publicCapabilityGaps, []);
  const nodeAddRisks = Object.fromEntries(nodeAdd.operations.map((item) => [item.operation, item.riskLevel]));
  assert.deepEqual(nodeAddRisks, { plan: 'L0', preview: 'L0', apply: 'L1', verify: 'L0', rollback: 'L1' });
  assert.equal(nodeAdd.handler, 'creative-action:graph.node-add');
  const createImage = graph.capabilities.find((capability) => capability.id === 'create.image');
  const createImageRisks = Object.fromEntries(createImage.operations.map((item) => [item.operation, item.riskLevel]));
  assert.deepEqual(
    { plan: createImageRisks.plan, preview: createImageRisks.preview, apply: createImageRisks.apply, run: createImageRisks.run },
    { plan: 'L0', preview: 'L0', apply: 'L1', run: 'L2' },
  );
  const assetPlace = graph.capabilities.find((capability) => capability.id === 'asset.place');
  assert.equal(assetPlace.operations.find((item) => item.operation === 'preview').riskLevel, 'L0');
  assert.equal(assetPlace.operations.find((item) => item.operation === 'apply').riskLevel, 'L1');
  assert.equal(assetPlace.operations.find((item) => item.operation === 'rollback').riskLevel, 'L1');
  assert.equal(assetPlace.handler, 'asset:place');
  const assetImport = graph.capabilities.find((capability) => capability.id === 'asset.import');
  assert.equal(assetImport.operations.find((item) => item.operation === 'apply').riskLevel, 'L2');
  const runStart = graph.capabilities.find((capability) => capability.id === 'run.start');
  assert.equal(runStart.operations.find((item) => item.operation === 'cancel').riskLevel, 'L1');
  for (const capabilityId of [
    'video.extract-frames',
    'image.remove-solid-background',
    'image.resample-upscale',
  ]) {
    const capability = graph.capabilities.find((item) => item.id === capabilityId);
    assert.ok(capability, `missing local utility capability ${capabilityId}`);
    const run = capability.operations.find((item) => item.operation === 'run');
    assert.equal(run.riskLevel, 'L1');
    assert.equal(run.boundary, 'local-compute');
    assert.equal(run.approvalRequired, true);
  }
  for (const entry of graph.runtime.entries) {
    assert.equal(entry.compatibility.known, true);
    assert.equal(entry.compatibility.executable, false);
  }
  const publicGraph = publicCreativeCapabilityGraph({ disableCache: true });
  assert.equal(publicGraph.aggregateDigest, graph.aggregateDigest);
  const brokenManifest = JSON.parse(JSON.stringify(manifest));
  brokenManifest.capabilities[0].nodeTypes = ['node-type-that-does-not-exist'];
  assert.throws(
    () => buildCapabilityGraph({
      manifest: brokenManifest,
      manifestDigest: digest,
      runtimeCatalog,
    }),
    /unknown canvas node types/,
  );
  assert.throws(
    () => validateCreativeCapabilityGraph({
      ...graph,
      counts: { ...graph.counts, unknownNodeReferences: 1 },
    }, { digest, capabilities: manifest.capabilities }),
    /unknown canvas node references/,
  );
  const brokenRisk = JSON.parse(JSON.stringify(graph));
  const brokenPlan = brokenRisk.capabilities
    .find((capability) => capability.id === 'create.image')
    .operations.find((operation) => operation.operation === 'plan');
  brokenPlan.riskLevel = 'L1';
  brokenPlan.approvalRequired = true;
  assert.throws(
    () => validateCreativeCapabilityGraph(brokenRisk, { digest, capabilities: manifest.capabilities }),
    /invalid operation risk contract/,
  );
  assert.throws(
    () => validateCapabilityGraphContracts(brokenRisk),
    /invalid operation risk contract/,
  );

  const brokenAccounting = JSON.parse(JSON.stringify(graph));
  const removeBg = brokenAccounting.nodes.find((node) => node.type === 'remove-bg');
  removeBg.accounting.reasonCode = '';
  removeBg.coverageReason = '';
  assert.throws(
    () => validateCreativeCapabilityGraph(brokenAccounting, { digest, capabilities: manifest.capabilities }),
    /node coverage is incomplete/,
  );
  assert.throws(
    () => validateCapabilityGraphContracts(brokenAccounting),
    /node coverage is incomplete/,
  );
  const wrongCategory = JSON.parse(JSON.stringify(graph));
  wrongCategory.gaps.internalCompatNodes[0].nodeType = 'browser';
  assert.throws(
    () => validateCreativeCapabilityGraph(wrongCategory, { digest, capabilities: manifest.capabilities }),
    /node coverage is incomplete/,
  );
  assert.throws(
    () => validateCapabilityGraphContracts(wrongCategory),
    /node coverage is incomplete/,
  );
  const missingVisibleCoverage = JSON.parse(JSON.stringify(manifest));
  missingVisibleCoverage.capabilities
    .find((capability) => capability.id === 'canvas.node-add').nodeTypeSelector = '';
  assert.throws(
    () => buildCapabilityGraph({ manifest: missingVisibleCoverage, manifestDigest: digest, runtimeCatalog }),
    /unexplained canvas nodes/,
  );
  const coverageMarkdown = coverageMarkdownArtifact(graph);
  assert.equal(
    coverageMarkdown.includes('Accounted / unexplained nodes: **81 / 0**'),
    true,
  );
  assert.equal(coverageMarkdown.includes('- Public capability gaps: none'), true);

  const brokenRuntime = JSON.parse(JSON.stringify(graph));
  brokenRuntime.runtime.entries[0].compatibility.executable = true;
  assert.throws(
    () => validateCreativeCapabilityGraph(brokenRuntime, { digest, capabilities: manifest.capabilities }),
    /invalid runtime compatibility/,
  );
  assert.throws(
    () => validateCapabilityGraphContracts(brokenRuntime),
    /invalid runtime compatibility/,
  );
  const brokenSelection = JSON.parse(JSON.stringify(graph));
  brokenSelection.capabilities.find((capability) => capability.id === 'canvas.node-add').nodeTypes.pop();
  assert.throws(
    () => validateCreativeCapabilityGraph(brokenSelection, { digest, capabilities: manifest.capabilities }),
    /node type selection drifted/,
  );
});

test('dynamic coverage receipt proves node, runtime, handler, risk, verification, and compatibility completeness', () => {
  const { manifest, digest } = readGeneratorManifest();
  const graph = buildCapabilityGraph({
    manifest,
    manifestDigest: digest,
    runtimeCatalog: buildRuntimeCatalog(),
  });
  const receipt = buildCapabilityCoverageReceipt(graph);
  assert.deepEqual(receipt, graph.coverageReceipt);
  assert.equal(receipt.schema, 't8-creative-capability-coverage-receipt-v1');
  assert.deepEqual(receipt.sourceDigests, {
    capabilityManifest: graph.sourceDigests.creativeCapabilityManifest,
    nodeSchema: graph.sourceDigests.canvasNodeSchema,
    runtimeCatalog: graph.sourceDigests.runtimeCatalogSources,
    handlerBindings: graph.sourceDigests.handlerBindings,
    receiptCompiler: graph.sourceDigests.coverageReceiptCompiler,
  });
  assert.deepEqual(receipt.inventory.nodes, {
    total: graph.nodes.length,
    executable: graph.nodes.filter((node) => node.executable).length,
    generatable: graph.nodes.filter((node) => node.generatable).length,
  });
  assert.deepEqual(receipt.inventory.nodes, { total: 81, executable: 62, generatable: 12 });
  assert.deepEqual(receipt.inventory.runtime, {
    llm: 34,
    image: 45,
    video: 115,
    audio: 17,
    actions: 58,
  });
  assert.equal(receipt.inventory.capabilities, graph.capabilities.length);
  assert.equal(receipt.inventory.handlers, graph.bindings.length);
  assert.equal(receipt.inventory.operations, graph.counts.operations);
  assert.deepEqual(receipt.gaps, {
    unknownNodeReferences: [],
    missingHandlers: [],
    missingOperationRisk: [],
    missingVerification: [],
    missingCompatibilityEdges: [],
  });
  assert.equal(receipt.complete, true);
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertCapabilityCoverageReceipt(graph));
  const markdown = coverageMarkdownArtifact(graph);
  assert.equal(
    markdown.includes('Dynamic node inventory (total / executable / generatable): **81 / 62 / 12**'),
    true,
  );
  assert.equal(
    markdown.includes('Dynamic runtime inventory (LLM / image / video / audio / actions): **34 / 45 / 115 / 17 / 58**'),
    true,
  );

  const rejectAcrossConsumers = (broken) => {
    assert.throws(
      () => validateCreativeCapabilityGraph(broken, { digest, capabilities: manifest.capabilities }),
      /coverage receipt is incomplete or drifted/,
    );
    assert.throws(
      () => validateCapabilityGraphContracts(broken),
      /coverage receipt is incomplete or drifted/,
    );
  };

  const missingHandler = JSON.parse(JSON.stringify(graph));
  missingHandler.bindings.pop();
  rejectAcrossConsumers(missingHandler);

  const missingRisk = JSON.parse(JSON.stringify(graph));
  missingRisk.capabilities[0].operations[0].boundary = '';
  rejectAcrossConsumers(missingRisk);

  const missingVerification = JSON.parse(JSON.stringify(graph));
  const nodeAdd = missingVerification.capabilities
    .find((capability) => capability.id === 'canvas.node-add');
  nodeAdd.supports = nodeAdd.supports.filter((operation) => operation !== 'verify');
  nodeAdd.operations = nodeAdd.operations.filter((operation) => operation.operation !== 'verify');
  missingVerification.counts.operations -= 1;
  rejectAcrossConsumers(missingVerification);

  const missingCompatibilityEdge = JSON.parse(JSON.stringify(graph));
  delete missingCompatibilityEdge.runtime.entries[0].catalogSection;
  rejectAcrossConsumers(missingCompatibilityEdge);

  const unknownNode = JSON.parse(JSON.stringify(graph));
  unknownNode.capabilities[0].nodeTypes.push('unknown-generated-node');
  rejectAcrossConsumers(unknownNode);

  const driftedReceipt = JSON.parse(JSON.stringify(graph));
  driftedReceipt.coverageReceipt.inventory.nodes.total += 1;
  rejectAcrossConsumers(driftedReceipt);

  const staleDuplicateCount = JSON.parse(JSON.stringify(graph));
  staleDuplicateCount.counts.executableNodes += 1;
  rejectAcrossConsumers(staleDuplicateCount);
});
test('every advertised creative capability resolves to a real runtime service contract', () => {
  const source = readCreativeCapabilityManifest({ disableCache: true });
  const bindings = publicCreativeCapabilityBindings(source);
  assert.equal(bindings.length, source.capabilities.length);
  assert.equal(new Set(bindings.map((item) => item.handler)).size, bindings.length);
  for (const capability of source.capabilities) {
    const resolved = resolveCreativeCapabilityHandler(capability.handler);
    assert.ok(resolved, `unbound handler ${capability.handler}`);
    assert.match(resolved.service, /^agentControl[A-Z]/);
    assert.match(resolved.method, /^[a-z][A-Za-z0-9]+$/);
  }
  assert.equal(resolveCreativeCapabilityHandler('asset:import').method, 'inspectImport');
  assert.equal(resolveCreativeCapabilityHandler('delivery:package').method, 'inspectPackage');
});

test('generated CLI and Skill capability indexes have no drift from the single manifest', () => {
  const { manifest, digest } = readGeneratorManifest();
  const runtimeCatalog = buildRuntimeCatalog();
  const graph = buildCapabilityGraph({ manifest, manifestDigest: digest, runtimeCatalog });
  const expectedGraph = graphArtifact(graph);
  assert.deepEqual(canonicalTextBytes(fs.readFileSync(JSON_TARGET)), canonicalTextBytes(jsonArtifact(manifest, digest, graph)));
  assert.deepEqual(canonicalTextBytes(fs.readFileSync(MARKDOWN_TARGET)), canonicalTextBytes(markdownArtifact(manifest, digest)));
  assert.deepEqual(canonicalTextBytes(fs.readFileSync(GRAPH_BACKEND_TARGET)), canonicalTextBytes(expectedGraph));
  assert.deepEqual(canonicalTextBytes(fs.readFileSync(GRAPH_CLI_TARGET)), canonicalTextBytes(expectedGraph));
  assert.deepEqual(canonicalTextBytes(fs.readFileSync(GRAPH_MARKDOWN_TARGET)), canonicalTextBytes(coverageMarkdownArtifact(graph)));
  assert.equal(publicCreativeCapabilities().capabilityGraph.aggregateDigest, graph.aggregateDigest);
});

test('creative capability manifest owns unique CLI surfaces and graph UI actions', () => {
  const sourceManifest = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'tools', 'zcanvas-cli', 'creativeCapabilityManifest.json'),
    'utf8',
  ));
  const missingCli = JSON.parse(JSON.stringify(sourceManifest));
  delete missingCli.capabilities[0].cli;
  assert.throws(
    () => validateCreativeCapabilityManifest(missingCli),
    /invalid or duplicate CLI surface/,
  );
  const duplicateCli = JSON.parse(JSON.stringify(sourceManifest));
  duplicateCli.capabilities[1].cli = { ...duplicateCli.capabilities[0].cli };
  assert.throws(
    () => validateCreativeCapabilityManifest(duplicateCli),
    /invalid or duplicate CLI surface/,
  );

  const { manifest, digest } = readGeneratorManifest();
  const graph = buildCapabilityGraph({
    manifest,
    manifestDigest: digest,
    runtimeCatalog: buildRuntimeCatalog(),
  });
  const brokenUi = JSON.parse(JSON.stringify(graph));
  brokenUi.capabilities[0].uiAction = 'create.video';
  assert.throws(
    () => validateCreativeCapabilityGraph(brokenUi, { digest, capabilities: manifest.capabilities }),
    /action surfaces drifted/,
  );
  assert.throws(
    () => validateCapabilityGraphContracts(brokenUi),
    /invalid action surfaces/,
  );
  const brokenCli = JSON.parse(JSON.stringify(graph));
  brokenCli.capabilities[0].cli.subcommand = 'video';
  assert.throws(
    () => validateCreativeCapabilityGraph(brokenCli, { digest, capabilities: manifest.capabilities }),
    /action surfaces drifted/,
  );
  assert.throws(
    () => validateCapabilityGraphContracts(brokenCli),
    /invalid action surfaces/,
  );
});

test('Agent tools, CLI schema, Skill reference and UI actions are generated from one capability manifest', () => {
  const { manifest, digest } = readGeneratorManifest();
  const graph = buildCapabilityGraph({
    manifest,
    manifestDigest: digest,
    runtimeCatalog: buildRuntimeCatalog(),
  });
  const catalog = buildCommandCatalog(manifest);
  const surfaces = buildCapabilitySurfaces(manifest, digest, graph);
  const surfaceArtifact = capabilitySurfacesArtifact(surfaces);
  assert.deepEqual(surfaces.counts, {
    capabilities: 31,
    agentTools: 31,
    cliOperations: 31,
    uiActions: 31,
  });
  assert.equal(surfaces.capabilityManifestVersion, manifest.version);
  assert.deepEqual(
    canonicalTextBytes(fs.readFileSync(COMMAND_CATALOG_TARGET)),
    canonicalTextBytes(commandCatalogArtifact(catalog)),
  );
  for (const target of [
    SURFACES_BACKEND_TARGET,
    SURFACES_CLI_TARGET,
    SURFACES_UI_TARGET,
    SURFACES_SKILL_TARGET,
  ]) {
    assert.deepEqual(
      canonicalTextBytes(fs.readFileSync(target)),
      canonicalTextBytes(surfaceArtifact),
      `surface drift at ${target}`,
    );
  }

  const sourceCatalog = JSON.parse(fs.readFileSync(COMMAND_CATALOG_SOURCE, 'utf8'));
  const sourceOperations = new Set(sourceCatalog.commands.flatMap((command) => (
    command.subcommands.map((subcommand) => `${command.name}.${subcommand}`)
  )));
  const generatedCatalogOperations = new Set(catalog.commands.flatMap((command) => (
    command.subcommands.map((subcommand) => `${command.name}.${subcommand}`)
  )));
  const graphById = new Map(graph.capabilities.map((capability) => [capability.id, capability]));
  const bindingsById = new Map(graph.bindings.map((binding) => [binding.capabilityId, binding]));
  const cliRuntime = new Map(operationCapabilities({}).map((entry) => [entry.operation, entry]));
  for (const surface of surfaces.capabilities) {
    const manifestCapability = manifest.capabilities.find((capability) => capability.id === surface.id);
    const graphCapability = graphById.get(surface.id);
    const binding = bindingsById.get(surface.id);
    assert.ok(manifestCapability);
    assert.ok(graphCapability);
    assert.ok(binding);
    assert.equal(sourceOperations.has(surface.cli.operation), false, `handwritten duplicate ${surface.cli.operation}`);
    assert.equal(generatedCatalogOperations.has(surface.cli.operation), true);
    assert.equal(surface.agentTool.handler, manifestCapability.handler);
    assert.equal(surface.agentTool.service, binding.service);
    assert.equal(surface.agentTool.method, binding.method);
    assert.equal(surface.agentTool.bindingOperation, binding.operation);
    assert.equal(surface.agentTool.version, manifest.version);
    assert.equal(surface.agentTool.protocol, 't8-versioned-creative-tool-v1');
    assert.equal(surface.agentTool.requestSchema, 't8-versioned-creative-tool-request-v1');
    assert.equal(surface.agentTool.resultSchema, 't8-versioned-creative-tool-result-v1');
    assert.ok(surface.agentTool.directOperations.length > 0);
    assert.equal(surface.agentTool.directOperations.includes(surface.agentTool.defaultOperation), true);
    for (const operation of surface.agentTool.directOperations) {
      const policy = graphCapability.operations.find((item) => item.operation === operation);
      assert.ok(policy, `missing direct operation policy ${surface.id}.${operation}`);
      assert.equal(policy.riskLevel, 'L0');
      assert.equal(policy.approvalRequired, false);
    }
    assert.equal(surface.ui.action, surface.id);
    assert.equal(surface.ui.requestAction, surface.agentTool.requestAction);
    assert.deepEqual(surface.ui.operations, graphCapability.operations);
    assert.deepEqual(graphCapability.cli, manifestCapability.cli);
    assert.equal(graphCapability.uiAction, surface.id);
    const cliOperation = cliRuntime.get(surface.cli.operation);
    assert.ok(cliOperation, `missing CLI operation ${surface.cli.operation}`);
    for (const requiredScope of surface.requiredScopes) {
      assert.equal(cliOperation.requires.includes(requiredScope), true);
    }
  }
  assert.equal(new Set(surfaces.capabilities.map((surface) => surface.agentTool.name)).size, 31);
  assert.equal(new Set(surfaces.capabilities.map((surface) => surface.cli.operation)).size, 31);
  assert.equal(new Set(surfaces.capabilities.map((surface) => surface.ui.action)).size, 31);
  const publicToolCatalog = publicVersionedCapabilityToolCatalog(surfaces);
  assert.equal(publicToolCatalog.tools.length, 31);
  assert.equal(JSON.stringify(publicToolCatalog).includes('"handler"'), false);
  assert.equal(JSON.stringify(publicToolCatalog).includes('"service"'), false);
  assert.equal(JSON.stringify(publicToolCatalog).includes('"method"'), false);

  const cliSource = fs.readFileSync(path.join(ROOT, 'tools', 'zcanvas-cli', 'src', 'cli.cjs'), 'utf8');
  const scopeBlock = cliSource.slice(
    cliSource.indexOf('  const scopeRequirements = {'),
    cliSource.indexOf('    ...CREATIVE_CLI_SCOPE_REQUIREMENTS,'),
  );
  const verifiedBlock = cliSource.slice(
    cliSource.indexOf('  const contractVerified = new Set(['),
    cliSource.indexOf('  ]);', cliSource.indexOf('  const contractVerified = new Set([')),
  );
  for (const surface of surfaces.capabilities) {
    assert.equal(scopeBlock.includes(`'${surface.cli.operation}':`), false);
    assert.equal(verifiedBlock.includes(`'${surface.cli.operation}'`), false);
  }
  assert.equal(scopeBlock.includes('CREATIVE_CLI_SCOPE_REQUIREMENTS'), false);
  assert.equal(verifiedBlock.includes('...CREATIVE_CLI_OPERATIONS'), true);
});
