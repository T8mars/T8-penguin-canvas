import contract from '../../backend/src/shared/nbLowpriceDoubaoContract.json';
import type { SeedanceNzAudioSubmitRequest } from '../services/generation';
import type { Material } from '../components/nodes/useUpstreamMaterials';

export function buildDoubaoVoiceClientRequest(input: {
  model: string; prompt: string; params: Record<string, string | number | boolean>;
  speaker?: string; texts: Pick<Material, 'url' | 'targetHandles'>[]; audioUrls: string[];
}): SeedanceNzAudioSubmitRequest {
  const clone = input.model === contract.audio.cloneModel;
  if (!clone && input.model !== contract.audio.iclModel) throw new Error('未知 Doubao Voice 模型');
  const prompt = input.prompt.trim();
  const [min, max] = clone ? contract.audio.clonePrompt : contract.audio.iclPrompt;
  if ([...prompt].length < min || [...prompt].length > max) throw new Error(`${input.model}: ${min}–${max}`);
  if (clone) {
    if (input.audioUrls.length !== 1) throw new Error('Doubao Voice: audio reference count must be 1');
    return { model: 'doubao-voice-clone', prompt, audioUrls: input.audioUrls, doubaoVoice: input.params };
  }
  const connected = input.texts.filter(item => item.targetHandles?.includes('speaker')).map(item => item.url.trim()).filter(Boolean);
  if (connected.length > 1) throw new Error('Doubao ICL: speaker input count must not exceed 1');
  const manual = String(input.speaker || '').trim();
  if (manual && connected[0] && manual !== connected[0]) throw new Error('Doubao ICL: connected speaker conflicts with the entered ID');
  const speaker = connected[0] || manual;
  if (!speaker) throw new Error('Doubao ICL: speaker is required');
  return { model: 'doubao-seed-icl-2.0', prompt, speaker, doubaoVoice: input.params };
}

export const isSpeakerMaterial = (item: Pick<Material, 'targetHandles'>) => item.targetHandles?.includes('speaker') === true;
