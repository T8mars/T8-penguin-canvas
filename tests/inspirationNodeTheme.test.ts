import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const promptNodes = [
  'src/components/nodes/MiniMaxH3PromptEnhancerNode.tsx',
  'src/components/nodes/MiniMaxMusic3PromptEnhancerNode.tsx',
  'src/components/nodes/MinimaxH3OfficialPromptEnhancerNode.tsx',
  'src/components/nodes/Seedance20PromptEnhancerNode.tsx',
] as const;

test('inspiration prompt nodes use shared day/night surfaces instead of permanent dark shells', () => {
  for (const file of promptNodes) {
    const node = source(file);
    assert.match(node, /t8-inspiration-node-shell/);
    assert.match(node, /t8-node t8-inspiration-node/);
    assert.match(node, /t8-node-header t8-inspiration-node__header/);
    assert.doesNotMatch(node, /style=\{\{ background: 'rgba\((?:18,18,24|17,20,22|16,19,25),\.9[67]\)' \}\}/);
    assert.doesNotMatch(node, /bg-\[#111117\]\/95/);
  }
});

test('all six requested inspiration nodes expose an explicit themed root contract', () => {
  const artist = source('src/components/nodes/ArtistStyleMasterNode.tsx');
  const anime = source('src/components/nodes/AnimeTagMasterNode.tsx');
  const css = source('src/styles/index.css');

  assert.match(artist, /data-artist-style-master-root/);
  assert.match(anime, /data-anime-tag-master-root/);
  assert.match(css, /\.t8-inspiration-node\s*\{[\s\S]*background: var\(--t8-bg-node\) !important/);
  assert.match(css, /html\[data-theme-mode="light"\] \.t8-inspiration-node/);
  assert.match(css, /html\[data-theme-template\] \.artist-style-master-node/);
  assert.match(css, /html\[data-theme-template\] \.anime-tag-master-node/);
});
