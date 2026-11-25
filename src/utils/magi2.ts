import contract from '../../backend/src/shared/magi2Contract.json';
import { buildMagi2Payload, type Magi2Request } from '../../backend/src/shared/magi2Contract.mjs';

export const MAGI2 = contract;

export interface Magi2Settings {
  magi2Mode?: string;
  magi2GenerateAudio?: boolean;
  magi2Seed?: number;
}

export function createMagi2Request(
  model: string, prompt: string, duration: number, ratio: string,
  settings: Magi2Settings, references: Pick<Magi2Request, 'images' | 'videos' | 'audios'>,
): Magi2Request {
  const request = {
    model, prompt, duration, ratio, ...references,
    mode: settings.magi2Mode ?? 'auto',
    generateAudio: settings.magi2GenerateAudio ?? true,
    seed: settings.magi2Seed ?? -1,
  };
  buildMagi2Payload(MAGI2, request);
  return request;
}
