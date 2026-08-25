import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localizeWorkbenchVisibleString } from '../src/i18n/LocalizedVisibleTree';
import { localizeNodeDynamicText, NODE_VISIBLE_CATALOG } from '../src/i18n/nodeVisibleCatalog';

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('legacy node presentation boundary translates nested chrome but excludes user and provider content', () => {
  const boundary = read('../src/i18n/NodeDomLanguageBoundary.tsx');
  const audit = read('../src/i18n/visibleAudit.ts');
  const canvas = read('../src/components/Canvas.tsx');

  assert.match(canvas, /<NodeDomLanguageBoundary \/>/);
  assert.match(boundary, /new MutationObserver/);
  assert.match(boundary, /\.t8-canvas-shell/);
  assert.match(boundary, /\[data-user-content\]/);
  assert.match(boundary, /\[data-provider-content\]/);
  assert.match(boundary, /FORM_CONTENT_SELECTOR = 'textarea, input, \[contenteditable="true"\]'/);
  assert.match(audit, /isFormValue/);

  const localize = (value: string) => localizeWorkbenchVisibleString(
    value,
    'nodes',
    NODE_VISIBLE_CATALOG,
    localizeNodeDynamicText,
  );
  assert.equal(localize('RH工具箱'), 'RH Toolbox');
  assert.equal(localize('输出 图像'), 'Output image');
  assert.equal(localize('删除素材 3'), 'Remove material 3');
  assert.equal(localize('画布 · clip.mp4 Drag onto the canvas'), 'Canvas · clip.mp4 Drag onto the canvas');
  assert.equal(localize('用户自己的中文提示词'), '用户自己的中文提示词');
});

test('secondary canvas controls are unique menu items instead of a permanently stacked icon column', () => {
  const canvas = read('../src/components/Canvas.tsx');
  const css = read('../src/styles/index.css');
  const soccer = read('../src/styles/theme-soccer.css');
  const ids = [
    'workflow-doctor-toggle',
    'model-help-toggle',
    'placement-shelf-toggle',
    'creative-desk-toggle',
    'radial-settings-toggle',
  ];

  assert.match(canvas, /const \[controlToolsOpen, setControlToolsOpen\] = useState\(false\)/);
  assert.match(canvas, /data-canvas-floating-ui="control-tools-toggle"/);
  assert.match(canvas, /data-canvas-floating-ui="control-tools-menu"/);
  const rail = canvas.slice(
    canvas.indexOf('const floatingControlRail ='),
    canvas.indexOf('<RadialMenuSettingsModal', canvas.indexOf('const floatingControlRail =')),
  );
  for (const id of ids) {
    assert.equal(rail.match(new RegExp(`data-canvas-floating-ui="${id}"`, 'g'))?.length, 1, id);
  }
  assert.match(css, /\.t8-control-tools-menu\s*\{/);
  assert.match(css, /\.t8-control-tools-menu button\s*\{/);
  assert.match(soccer, /\.t8-control-tools-menu\s*\{/);
});
