import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localizeLegacyRuntimeText } from '../src/i18n/legacyRuntimeText';

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Story runtime notices translate for display without changing persisted source text', () => {
  const sourceText = '小鸭人设 正在生成，请等待完成或先停止当前流程';
  assert.equal(
    localizeLegacyRuntimeText('story', 'en-US', sourceText),
    '小鸭人设 is generating. Wait for completion or stop the current process first.',
  );
  assert.equal(localizeLegacyRuntimeText('story', 'zh-CN', sourceText), sourceText);
  assert.equal(
    localizeLegacyRuntimeText('story', 'en-US', '生成缺失视频请求正在提交…'),
    'Submitting Generate missing videos request…',
  );
  const node = source('src/components/nodes/StoryNode.tsx');
  assert.match(node, /storyRuntimeText\(state\.message\)/);
  assert.match(node, /storyRuntimeText\(localMessage \|\| project\.lastError\)/);
});

test('Script Master runtime notices translate exact and dynamic messages at both surfaces', () => {
  assert.equal(
    localizeLegacyRuntimeText('scriptMaster', 'en-US', '已复制 4 个时间线片段'),
    'Duplicated 4 timeline clips.',
  );
  assert.equal(
    localizeLegacyRuntimeText('scriptMaster', 'en-US', '确定性解析完成：3 场 · 12 镜 · 未调用模型'),
    'Deterministic parsing completed: 3 scenes · 12 shots · no model called.',
  );
  const node = source('src/components/nodes/ScriptMasterNode.tsx');
  assert.equal((node.match(/scriptMasterRuntimeText\(message\)/g) || []).length, 2);
});

test('MV Music Master runtime safeguards translate without rewriting unknown provider errors', () => {
  assert.equal(
    localizeLegacyRuntimeText('mvMusicMaster', 'en-US', '人工确认 BPM 必须在 30–300 之间。'),
    'The manually confirmed BPM must be between 30 and 300.',
  );
  assert.equal(
    localizeLegacyRuntimeText('mvMusicMaster', 'en-US', '已保存的 LLM 渠道 old-provider 无效；请重新选择。'),
    'The saved LLM channel old-provider is invalid. Select it again.',
  );
  const providerError = 'Provider returned custom diagnostic text';
  assert.equal(localizeLegacyRuntimeText('mvMusicMaster', 'en-US', providerError), providerError);
  const node = source('src/components/nodes/MvMusicMasterNode.tsx');
  assert.match(node, /mvRuntimeText\(configurationDriftMessage\)/);
  assert.equal((node.match(/mvRuntimeText\(localError \|\|/g) || []).length, 2);
});
