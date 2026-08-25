import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(rel: string) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
}

for (const [label, file] of [
  ['upload node', 'src/components/nodes/UploadNode.tsx'],
  ['output node', 'src/components/nodes/OutputNode.tsx'],
] as const) {
  test(`${label} can snapshot the visible current video frame`, () => {
    const source = read(file);

    assert.match(source, /snapshotVideoFrameAsync/);
    assert.match(source, /onTimeUpdate=\{\(event\) => rememberVideoFrameTime/);
    assert.match(source, /onSeeked=\{\(event\) => rememberVideoFrameTime/);
    assert.match(source, /data-video-current-frame/);
    assert.match(source, /type:\s*'video-frame-extract'/);
    if (label === 'output node') {
      assert.match(source, /label:\s*t\('nodes:output\.currentFrameSnapshot'\)/);
      assert.match(source, /t\('nodes:output\.logs\.frameCaptured'/);
    } else {
      assert.match(source, /label:\s*'当前帧截图'/);
      assert.match(source, /图片已保存并输出/);
    }
  });
}

test('video current-frame action uses the durable backend snapshot route', () => {
  const service = read('src/services/videoOps.ts');
  const route = read('backend/src/routes/videoOps.js');

  assert.match(service, /postVideoOp<VideoSnapshotResult>\('snapshot'/);
  assert.match(route, /router\.post\('\/snapshot'/);
  assert.match(route, /snapshotVideoFrame/);
  assert.match(route, /config\.OUTPUT_DIR/);
});
