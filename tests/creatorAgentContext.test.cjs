'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('creator canvas context stays bounded and excludes raw prompts and media references', () => {
  const helper = source('src/utils/creatorAgentContext.ts');
  assert.match(helper, /slice\(0, 24\)/);
  assert.match(helper, /offscreenSummary/);
  assert.match(helper, /upstreamCount/);
  assert.match(helper, /downstreamCount/);
  assert.match(helper, /accepted/);
  assert.match(helper, /lockKeys/);
  assert.doesNotMatch(helper, /prompt:\s*data\./);
  assert.doesNotMatch(helper, /url:\s*data\./i);
});

test('creator panel receives object summaries and shows a lightweight context receipt', () => {
  const canvas = source('src/components/Canvas.tsx');
  const entry = source('src/components/CreatorAgentEntry.tsx');
  if (/CreatorAgentPanelV2/.test(entry)) {
    const panel = source('src/components/CreatorAgentPanelV2.tsx');
    const routes = source('backend/src/routes/creatorAgentV2.js');
    assert.match(canvas, /selectedNodes=\{nodes\.filter\(\(node\) => node\.selected\)/);
    assert.match(canvas, /label: placementShelfNodeTitle\(node\)/);
    assert.match(panel, /selectedNodes\?: Array<\{ id: string; type: string; label: string \}>/);
    assert.match(panel, /selectedNodeIds: boundSelectionIds/);
    assert.match(panel, /linkedSelectionText/);
    assert.match(routes, /resolveTurnContext\(scope, req\.body \|\| \{\}\)/);
    assert.match(routes, /turnSelectedNodes/);
    return;
  }
  const panel = source('src/components/CreatorAgentPanel.tsx');
  const service = source('src/services/creatorAgent.ts');
  const css = source('src/styles/index.css');
  assert.match(canvas, /buildCreatorCanvasContext/);
  assert.match(canvas, /canvasObjects=\{creatorCanvasContext\.objects\}/);
  assert.match(panel, /canvasObjects: props\.canvasObjects/);
  assert.match(panel, /recentActions:/);
  assert.match(panel, /assetLineage,/);
  assert.match(panel, /listProjectAssetLineage\(assetId, \{ limit: 12/);
  assert.match(panel, /t8-creator-agent-context-receipt/);
  assert.match(panel, /t8-creator-agent-filmstrip/);
  assert.match(service, /canvasObjects\?: (?:Array<CreatorAgentCanvasObject>|CreatorAgentCanvasObject\[\])/);
  assert.match(css, /\.t8-creator-agent-context-receipt/);
  assert.match(css, /\.t8-creator-agent-filmstrip/);
});
