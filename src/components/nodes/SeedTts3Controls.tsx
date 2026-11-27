import { useTranslation } from 'react-i18next';
import spec from '../../../backend/src/shared/seedTts3Contract.json';
import type { SeedanceNzAudioSubmitRequest } from '../../services/generation';

type Settings = { seedTts3Voice?: string; seedTts3Instructions?: string; seedTts3Speed?: number };
type Props = { data: Settings; disabled: boolean; update: (settings: Settings) => void };

export function seedTts3Request(prompt: string, data: Settings): SeedanceNzAudioSubmitRequest {
  return {
    model: 'bytedance-seed/seed-tts-3-0',
    prompt,
    voice: data.seedTts3Voice,
    instructions: data.seedTts3Instructions,
    speed: data.seedTts3Speed,
    outputFormat: 'wav',
  };
}

export function SeedTts3Controls({ data, disabled, update }: Props) {
  const { t } = useTranslation();
  const field = 'mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white';
  return <fieldset disabled={disabled} className="nodrag nowheel space-y-2 rounded border border-cyan-300/20 p-2">
    <legend className="px-1 text-[10px] text-white/70">Seed-TTS 3.0</legend>
    <p className="text-[10px] text-white/70">{t('nodes:audio.seedTts3.hint')}</p>
    <label className="block text-[10px] text-white/70">
      {t('nodes:audio.seedTts3.voice')}
      <input className={field} placeholder={spec.defaultVoice} value={data.seedTts3Voice ?? ''}
        onChange={event => { const value = event.currentTarget.value; update({ seedTts3Voice: value }); }} />
    </label>
    <label className="block text-[10px] text-white/70">
      {t('nodes:audio.seedTts3.instructions')}
      <textarea className={field} rows={2} value={data.seedTts3Instructions ?? ''}
        onChange={event => { const value = event.currentTarget.value; update({ seedTts3Instructions: value }); }} />
    </label>
    <label className="block text-[10px] text-white/70">
      {t('nodes:audio.seedTts3.speed')}
      <input className={field} type="number" min={spec.speed.min} max={spec.speed.max} step="any"
        placeholder={spec.speed.default.toFixed(1)} value={data.seedTts3Speed ?? ''}
        onChange={event => {
          const value = event.currentTarget.value;
          update({ seedTts3Speed: value === '' ? undefined : Number(value) });
        }} />
    </label>
  </fieldset>;
}
