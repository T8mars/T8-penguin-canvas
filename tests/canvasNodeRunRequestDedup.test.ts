import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const canvas = () => readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');

test('canvas coalesces duplicate node run requests before creating persisted Runs', () => {
  const source = canvas();
  assert.match(source, /pendingCanvasNodeRunRequestsRef = useRef\(new Set<string>\(\)\)/);
  assert.match(source, /canvasNodeRunRetryAfterRef = useRef\(new Map<string, number>\(\)\)/);
  assert.match(source, /pendingCanvasNodeRunRequestsRef\.current\.has\(requestKey\)/);
  assert.match(source, /pendingCanvasNodeRunRequestsRef\.current\.add\(requestKey\)/);
  assert.match(source, /pendingCanvasNodeRunRequestsRef\.current\.delete\(requestKey\)/);
  assert.match(source, /相同节点的运行请求正在处理，请勿重复提交/);
});
