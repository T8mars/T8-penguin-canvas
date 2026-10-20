const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { NODE_SCHEMA_DIGEST } = require('./canvasAgentTools');
const {
  readCreativeCapabilityGraph,
  readCreativeCapabilityManifest,
} = require('./agentControlCapabilities');

const SOURCE_ROOT = path.resolve(__dirname, '..', '..', '..');

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function existingFile(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Agent Control compatibility manifest is unavailable');
}

function compatibilityPaths(options = {}) {
  const resourcesPath = String(options.resourcesPath || process.resourcesPath || '').trim();
  const manifestPath = existingFile([
    options.manifestPath,
    resourcesPath ? path.join(resourcesPath, 'tools', 'zcanvas-cli', 'manifest.json') : '',
    path.join(SOURCE_ROOT, 'tools', 'zcanvas-cli', 'manifest.json'),
  ]);
  const commandCatalogPath = existingFile([
    options.commandCatalogPath,
    path.join(path.dirname(manifestPath), 'commandCatalog.json'),
    resourcesPath ? path.join(resourcesPath, 'tools', 'zcanvas-cli', 'commandCatalog.json') : '',
    path.join(SOURCE_ROOT, 'tools', 'zcanvas-cli', 'commandCatalog.json'),
  ]);
  const providerCatalogPath = existingFile([
    options.providerCatalogPath,
    resourcesPath ? path.join(resourcesPath, 'backend', 'shared', 'creativeModelCatalog.json') : '',
    resourcesPath ? path.join(resourcesPath, 'backend-enc', 'shared', 'creativeModelCatalog.json') : '',
    path.join(SOURCE_ROOT, 'backend', 'src', 'shared', 'creativeModelCatalog.json'),
  ]);
  const capabilityManifestPath = existingFile([
    options.capabilityManifestPath,
    path.join(path.dirname(manifestPath), 'creativeCapabilityManifest.json'),
    resourcesPath ? path.join(resourcesPath, 'tools', 'zcanvas-cli', 'creativeCapabilityManifest.json') : '',
    path.join(SOURCE_ROOT, 'tools', 'zcanvas-cli', 'creativeCapabilityManifest.json'),
  ]);
  const capabilityGraphPath = existingFile([
    options.capabilityGraphPath,
    path.join(path.dirname(manifestPath), 'generated', 'creative-capability-graph.json'),
    resourcesPath ? path.join(resourcesPath, 'backend', 'shared', 'creativeCapabilityGraph.json') : '',
    path.join(SOURCE_ROOT, 'backend', 'src', 'shared', 'creativeCapabilityGraph.json'),
    path.join(SOURCE_ROOT, 'tools', 'zcanvas-cli', 'generated', 'creative-capability-graph.json'),
  ]);
  const capabilitySurfacesPath = existingFile([
    options.capabilitySurfacesPath,
    path.join(path.dirname(manifestPath), 'generated', 'creative-capability-surfaces.json'),
    resourcesPath ? path.join(resourcesPath, 'tools', 'zcanvas-cli', 'generated', 'creative-capability-surfaces.json') : '',
    path.join(SOURCE_ROOT, 'tools', 'zcanvas-cli', 'generated', 'creative-capability-surfaces.json'),
  ]);
  return {
    capabilityManifestPath,
    capabilityGraphPath,
    capabilitySurfacesPath,
    commandCatalogPath,
    manifestPath,
    providerCatalogPath,
  };
}

function compatibilitySnapshot(options = {}) {
  const {
    capabilityManifestPath,
    capabilityGraphPath,
    capabilitySurfacesPath,
    commandCatalogPath,
    manifestPath,
    providerCatalogPath,
  } = compatibilityPaths(options);
  const manifestBuffer = fs.readFileSync(manifestPath);
  const commandCatalogBuffer = fs.readFileSync(commandCatalogPath);
  const capabilityManifestBuffer = fs.readFileSync(capabilityManifestPath);
  const capabilityGraphBuffer = fs.readFileSync(capabilityGraphPath);
  const capabilitySurfacesBuffer = fs.readFileSync(capabilitySurfacesPath);
  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  const commandCatalog = JSON.parse(commandCatalogBuffer.toString('utf8'));
  const capabilitySurfaces = JSON.parse(capabilitySurfacesBuffer.toString('utf8'));
  if (manifest?.schema !== 't8-zcanvas-manifest-v1'
    || manifest.commandCatalog !== 'commandCatalog.json'
    || manifest.creativeCapabilityManifest !== 'creativeCapabilityManifest.json'
    || manifest.creativeCapabilityGraph !== 'generated/creative-capability-graph.json'
    || manifest.creativeCapabilitySurfaces !== 'generated/creative-capability-surfaces.json'
    || commandCatalog?.schema !== 't8-zcanvas-command-catalog-v1'
    || !Array.isArray(commandCatalog.commands)
    || capabilitySurfaces?.schema !== 't8-creative-capability-surfaces-v1'
    || !Array.isArray(capabilitySurfaces.capabilities)) {
    throw new Error('Agent Control compatibility manifest schema is invalid');
  }
  const providerCatalogDigest = sha256Buffer(fs.readFileSync(providerCatalogPath));
  const capabilities = readCreativeCapabilityManifest({
    manifestPath: capabilityManifestPath,
    disableCache: true,
  });
  const capabilityGraph = readCreativeCapabilityGraph({
    graphPath: capabilityGraphPath,
    manifest: capabilities,
    disableCache: true,
  });
  return Object.freeze({
    skillVersion: String(manifest.skillVersion || ''),
    cliVersion: String(manifest.cliVersion || ''),
    controlProtocol: String(manifest.controlProtocol || ''),
    canvasPatchProtocol: String(manifest.canvasPatchProtocol || ''),
    nodeSchemaDigest: String(NODE_SCHEMA_DIGEST || ''),
    providerCatalogDigest,
    creativeCapabilityManifestDigest: capabilities.digest,
    creativeCapabilityGraphDigest: capabilityGraph.aggregateDigest,
    manifestDigest: crypto.createHash('sha256')
      .update(manifestBuffer)
      .update(commandCatalogBuffer)
      .update(capabilityManifestBuffer)
      .update(capabilityGraphBuffer)
      .update(capabilitySurfacesBuffer)
      .digest('hex'),
  });
}

module.exports = {
  compatibilityPaths,
  compatibilitySnapshot,
  sha256Buffer,
};
