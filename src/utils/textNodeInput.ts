import type { MediaMention } from '../components/nodes/mediaMentions';

export { hasUpstreamFeedbackCycle as textInputHasCycle } from './upstreamFeedback.ts';

export function resolveTextNodeInput(data: Record<string, any>, upstream: Array<{url: string}>, allowFollow = true) {
  const current = typeof data.prompt === 'string' ? data.prompt : typeof data.text === 'string' ? data.text : '';
  const local = typeof data.textLocalPrompt === 'string' ? data.textLocalPrompt : current;
  const localMentions: MediaMention[] = Array.isArray(data.textLocalMentions) ? data.textLocalMentions : Array.isArray(data.promptMentions) ? data.promptMentions : [];
  const incoming = upstream.map(item => item.url).filter(value => typeof value === 'string' && value.trim()).join('\n\n');
  const following = allowFollow && data.textUseUpstream !== false && !!incoming;
  const text = following ? incoming : local;
  const mentions = following ? [] : localMentions;
  const patch: Record<string, any> = {};
  if (following && typeof data.textLocalPrompt !== 'string') Object.assign(patch, {textLocalPrompt:local,textLocalMentions:localMentions});
  if (data.prompt !== text) patch.prompt = text;
  if (data.text !== text) patch.text = text;
  if (JSON.stringify(data.promptMentions || []) !== JSON.stringify(mentions)) patch.promptMentions = mentions;
  return {text,mentions,following,patch};
}
