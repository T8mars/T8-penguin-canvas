import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function cssRuleBody(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

test('global UI font rendering does not force grayscale smoothing', () => {
  const css = read('../src/styles/index.css');
  const userFontRule = cssRuleBody(css, 'html[data-ui-font]:not([data-ui-font="theme"])');
  const rootRule = cssRuleBody(css, ':root');

  for (const body of [userFontRule, rootRule]) {
    assert.match(body, /text-rendering:\s*optimizeLegibility/);
    assert.match(body, /-webkit-font-smoothing:\s*subpixel-antialiased/);
    assert.match(body, /-moz-osx-font-smoothing:\s*auto/);
    assert.doesNotMatch(body, /-webkit-font-smoothing:\s*antialiased/);
    assert.doesNotMatch(body, /-moz-osx-font-smoothing:\s*grayscale/);
    assert.doesNotMatch(body, /text-rendering:\s*geometricPrecision/);
  }
});

test('canvas nodes strip decorative text blur across themes', () => {
  const css = read('../src/styles/index.css');

  assert.match(css, /Canvas node crisp text contract/);
  assert.match(
    css,
    /#root \.t8-canvas-shell \.react-flow__node,\s*#root \.t8-canvas-shell \.react-flow__node \* \{[\s\S]*-webkit-font-smoothing:\s*subpixel-antialiased !important;[\s\S]*-moz-osx-font-smoothing:\s*auto !important;[\s\S]*text-rendering:\s*optimizeLegibility !important;[\s\S]*\}/,
  );
  assert.match(
    css,
    /#root \.t8-canvas-shell \.react-flow__node,\s*#root \.t8-canvas-shell \.react-flow__node :where\([\s\S]*button,[\s\S]*span,[\s\S]*textarea,[\s\S]*th[\s\S]*\) \{[\s\S]*-webkit-text-stroke:\s*0 !important;[\s\S]*text-shadow:\s*none !important;[\s\S]*\}/,
  );
});

test('node UI disables compositor filters at every zoom, theme and pan/drag state', () => {
  const css = read('../src/styles/index.css');
  const canvas = read('../src/components/Canvas.tsx');

  const backdrop = cssRuleBody(css, '#root .t8-canvas-shell .react-flow__node,\n#root .t8-canvas-shell .react-flow__node *');
  assert.match(backdrop, /-webkit-backdrop-filter:\s*none !important;/);
  assert.match(backdrop, /backdrop-filter:\s*none !important;/);
  const filter = cssRuleBody(css, '#root .t8-canvas-shell .react-flow__node,\n#root .t8-canvas-shell .react-flow__node :where(\n  div, section, article, header, footer, main, form, fieldset,\n  a, b, button, code, em, h1, h2, h3, h4, h5, h6,\n  input, label, legend, li, mark, option, p, pre, select,\n  small, span, strong, summary, td, textarea, th\n)');
  assert.match(filter, /filter:\s*none !important;/);
  assert.doesNotMatch(filter, /zoom-readability|viewport-moving|node-dragging|selected/);
  const crispRules = css.slice(css.indexOf('/* Canvas node crisp text contract'), css.indexOf('/* G19'));
  assert.doesNotMatch(crispRules, /text-rendering:\s*geometricPrecision !important;/);
  assert.match(canvas, /data-canvas-zoom-readability=\{canvasZoomReadability\}/);
  assert.match(canvas, /onMove=\{handleViewportMove\}/);
});
