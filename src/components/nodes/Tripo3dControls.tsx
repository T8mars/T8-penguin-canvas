import { useTranslation } from 'react-i18next';
import { TRIPO, tripoValues } from '../../utils/tripo3d';

export default function Tripo3dControls({ model, data, update, imageCount }: { model: string; data: Record<string, any>; update: (patch: Record<string, any>) => void; imageCount: number }) {
  const { t } = useTranslation();
  const values = tripoValues(data), fields = TRIPO.activeFields(model, values, imageCount);
  const change = (field: string, value: string | number) => update({ [field === 'prompt' ? 'prompt' : `tripo_${field}`]: value });
  const inputClass = 'mt-1 w-full rounded border border-white/15 bg-zinc-900 px-2 py-1.5 text-xs text-white';
  return <div className="space-y-2">
    <div className="text-[11px] text-white/60">{t('tripo:references', { count: imageCount })} · {t('tripo:viewOrder')}</div>
    {fields.includes('model_url') && <div className="text-[10px] text-white/50">{t('tripo:modelSourceHelp')}</div>}
    {fields.includes('tripo_segment_task_id') && <div className="text-[10px] text-white/50">{t('tripo:segmentHelp')}</div>}
    {fields.map(field => {
      const spec = TRIPO.fields[field], current = values[field];
      return <label key={field} className="block text-[11px] text-white/65">{t(`tripo:fields.${field}`)}
        {spec.type === 'enum' ? <select aria-label={t(`tripo:fields.${field}`)} value={String(current)} onChange={event => { const next = event.currentTarget.value; change(field, next); }} className={inputClass}>
          {spec.options!.map(option => <option key={option} value={option}>{option === 'api_default' ? t('tripo:apiDefault') : option === 'true' ? t('tripo:enabled') : option === 'false' ? t('tripo:disabled') : option}</option>)}
        </select> : spec.multiline ? <textarea aria-label={t(`tripo:fields.${field}`)} value={String(current)} rows={field === 'prompt' || field === 'texture_prompt_text' ? 3 : 2} onChange={event => { const next = event.currentTarget.value; change(field, next); }} className={inputClass} />
          : <input aria-label={t(`tripo:fields.${field}`)} type={spec.type === 'text' ? 'text' : 'number'} min={spec.min} max={field === 'face_limit' ? TRIPO.faceRange(model, values)[1] : spec.max} step={spec.type === 'number' ? 'any' : 1} value={current} placeholder={field === 'model_url' ? t('tripo:modelSourcePlaceholder') : undefined} onChange={event => { const next = event.currentTarget.value; change(field, spec.type === 'text' ? next : next === '' ? Number(spec.default) : Number(next)); }} className={inputClass} />}
        {field === 'face_limit' && <span className="mt-1 block text-[10px] text-white/40">{t('tripo:faceHelp', { range: TRIPO.faceRange(model, values).join('–') })}</span>}
        {field === 'part_names' && <span className="mt-1 block text-[10px] text-white/40">{t('tripo:partsHelp')}</span>}
        {field === 'compress' && <span className="mt-1 block text-[10px] text-white/40">{t('tripo:compressHelp')}</span>}
      </label>;
    })}
  </div>;
}
