export interface Magi2Request {
  model: string;
  prompt: string;
  mode?: string;
  ratio?: string;
  duration?: number;
  generateAudio?: boolean;
  seed?: number;
  images?: readonly string[];
  videos?: readonly string[];
  audios?: readonly string[];
}

import type contract from './magi2Contract.json';

export function buildMagi2Payload(spec: typeof contract, input: Magi2Request): {
  payload: {
    model: string;
    prompt: string;
    seconds: string;
    metadata: { resolution: string; generate_audio: boolean; generation_type?: string; ratio?: string; seed?: number };
  };
  references: { images: readonly string[]; videos: readonly string[]; audios: readonly string[] };
  taskType: string;
};
