import { useTranslation } from 'react-i18next';
import { useRef } from 'react';
import contract from '../../../backend/src/shared/nbLowpriceDoubaoContract.json';
import { createDoubaoParameterEditor } from '../../utils/doubaoVoiceParameters';

type Rule = { kind: string; default?: string | number; min?: number; max?: number; integer?: boolean; options?: string[]; advanced?: boolean };
type Params = Record<string, string | number | boolean>;

export default function DoubaoVoiceControls({ clone, params, onChange, speaker, onSpeakerChange }: {
  clone: boolean; params: Params; onChange: (value: Params) => void;
  speaker: string; onSpeakerChange: (value: string) => void;
}) {
  const { t } = useTranslation('nodes');
  const editor = useRef(createDoubaoParameterEditor(params));
  editor.current.sync(params);
  const fields: Record<string, Rule> = clone ? contract.audio.cloneFields : contract.audio.iclFields;
  const edit = (key: string, value: string | number) => {
    const next = editor.current.change(key, value);
    if (next.changed) onChange(next.value);
  };
  const field = ([key, rule]: [string, Rule]) => {
    if (key === 'context_texts' && (params.voice_model ?? 'seed-tts-2.0-standard') !== 'api_default') return null;
    let value = params[key] ?? rule.default ?? (rule.kind === 'text' || rule.kind === 'textarea' || rule.kind === 'number' ? '' : 'api_default');
    if (typeof value === 'boolean') value = value ? 'enabled' : 'disabled';
    const cls = 'nodrag nowheel mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none';
    const options = rule.kind === 'boolean' ? ['api_default', 'enabled', 'disabled'] : rule.options;
    return <label key={key} className="block text-[10px] text-white/60">
      {t(`audio.doubaoVoice.fields.${key}`)} <span className="text-white/35">({key})</span>
      {options ? <select name={key} className={cls} value={String(value)} onChange={event => { const next = event.currentTarget.value; edit(key, next); }}>
        {options.map(option => <option key={option} value={option} className="bg-zinc-900">{['api_default', 'enabled', 'disabled'].includes(option) ? t(`audio.doubaoVoice.${option}`) : option}</option>)}
      </select> : rule.kind === 'textarea'
        ? <textarea name={key} className={`${cls} h-16 resize-y`} value={String(value)} onChange={event => { const next = event.currentTarget.value; edit(key, next); }} />
        : <input name={key} autoComplete="off" className={cls} type={rule.kind === 'number' ? 'number' : 'text'} min={rule.min} max={rule.max} step={rule.integer ? 1 : 'any'} value={String(value)} onChange={event => {
          const next = event.currentTarget.value;
          edit(key, rule.kind === 'number' && next !== '' ? Number(next) : next);
        }} />}
    </label>;
  };
  return <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] p-2 space-y-2" data-doubao-voice-controls={clone ? 'clone' : 'icl'}>
    <p className="text-[10px] leading-relaxed text-cyan-100/70">{t(`audio.doubaoVoice.${clone ? 'cloneHint' : 'iclHint'}`)}</p>
    {!clone && <label className="block text-[10px] text-white/60">{t('audio.doubaoVoice.speaker')}
      <input className="nodrag nowheel mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" value={speaker} onChange={event => { const next = event.currentTarget.value; onSpeakerChange(next); }} />
    </label>}
    {Object.entries(fields).filter(([, rule]) => !rule.advanced).map(field)}
    <details className="nodrag nowheel space-y-2"><summary className="cursor-pointer text-[10px] text-white/60">{t('audio.doubaoVoice.advanced')}</summary>
      {Object.entries(fields).filter(([, rule]) => rule.advanced).map(field)}
    </details>
  </div>;
}
