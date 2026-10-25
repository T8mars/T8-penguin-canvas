import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PromptTextarea from '../../components/PromptTextarea';
import { MOTION_VIDEO_CONTRACT as contract, motionVersions } from '../../utils/motionVideo';
export const motionControl = { border: '1px solid var(--border-primary)', borderRadius: 8, padding: '7px 10px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', minWidth: 0, fontSize: 12 };
export interface MotionFormProps { data: Record<string, any>; onPatch: (patch: Record<string, unknown>) => void; readOnly: boolean; upstream?: boolean; expanded?: boolean; }
export default function MotionForm({ data, onPatch, readOnly, upstream, expanded }: MotionFormProps) {
  const { t } = useTranslation('motionVideo');
  const [example, setExample] = useState('');
  const revise = data.motionOperation === 'revise';
  const base = motionVersions(data.motionVersions).find(v => v.id === data.motionBaseVersionId);
  const advancedValue = (key: string) => {
    if (!revise || !base) return data[key] || '';
    const m = base.request.motion || {};
    const values: Record<string, unknown> = { motionTitle: m.title, motionSubtitle: m.subtitle, motionSignature: m.signature, motionLanguage: m.language,
      motionKeywords: m.keywords?.join('\n'), motionTemplate: m.template_id, motionMusic: m.music };
    return values[key] || '';
  };
  const advanced = <div style={{ display: 'grid', gap: 8 }}>
    {(['motionTitle', 'motionSubtitle', 'motionSignature', 'motionLanguage'] as const).map((key, index) => <label key={key} style={{ display: 'grid', gap: 4 }}>
      {t(['titleField', 'subtitleField', 'signature', 'language'][index])}
      <input style={motionControl} value={String(advancedValue(key))} onChange={e => { const value = e.currentTarget.value; onPatch({ [key]: value }); }} disabled={readOnly || revise} />
    </label>)}
    <small>{t('signatureHint')}</small>
    <label style={{ display: 'grid', gap: 4 }}>{t('keywords')}<textarea rows={3} style={motionControl} value={String(advancedValue('motionKeywords'))}
      onChange={e => { const value = e.currentTarget.value; onPatch({ motionKeywords: value }); }} disabled={readOnly || revise} /></label>
    <label style={{ display: 'grid', gap: 4 }}>{t('music')}<select style={motionControl} value={String(advancedValue('motionMusic')) || 'api_default'} disabled={readOnly || revise}
      onChange={e => { const value = e.currentTarget.value; onPatch({ motionMusic: value }); }}>
      <option value="api_default">{t('automatic')}</option><option value="auto">{t('musicAuto')}</option>
    </select></label>
  </div>;
  return <div className="nodrag nopan nowheel" style={{ display: 'grid', gap: 10, fontSize: 12 }}>
    <label style={{ display: 'grid', gap: 4 }}>{t('model')}<select style={motionControl} aria-label={t('model')}
      value={revise && base ? base.request.model : data.model || contract.defaults.model} disabled={readOnly || revise}
      onChange={e => { const model = e.currentTarget.value; onPatch({ model }); }}>
      {contract.models.map((model, index) => <option key={model} value={model}>{t(index ? 'pro' : 'standard')}</option>)}
    </select></label>
    {revise && <><strong>{base ? t('base', { version: `V${motionVersions(data.motionVersions).findIndex(v => v.id === base.id) + 1}` }) : t('missingBase')}</strong>
      <small>{t('revisionNotice')}</small></>}
    <PromptTextarea value={revise ? base?.request.prompt || '' : String(data.prompt || '')} onValueChange={prompt => onPatch({ prompt })}
      title={t('prompt')} aria-label={t('prompt')} readOnly={readOnly || revise} rows={expanded ? 7 : 3} style={{ ...motionControl, width: '100%', resize: 'vertical' }} />
    {!revise && upstream && <small>{t('upstream')}</small>}
    {revise && <PromptTextarea value={String(data.motionRevisionInstruction || '')} onValueChange={motionRevisionInstruction => onPatch({ motionRevisionInstruction })}
      title={t('instruction')} aria-label={t('instruction')} placeholder={t('instructionHint')} readOnly={readOnly} rows={4} style={{ ...motionControl, width: '100%' }} />}
    {!revise && <>
      <select aria-label={t('examples')} style={motionControl} value="" disabled={readOnly} onChange={e => {
        const key = e.currentTarget.value;
        if (!key) return;
        const value = t(`exampleTexts.${key}`);
        if (!String(data.prompt || '').trim()) onPatch({ prompt: value }); else setExample(value);
      }}><option value="">{t('examples')}</option>{['intro', 'product', 'data'].map((key, i) => <option key={key} value={key}>{t(['exampleIntro', 'exampleProduct', 'exampleData'][i])}</option>)}</select>
      {example && <div><p style={{ whiteSpace: 'pre-wrap' }}>{example}</p><button style={motionControl} type="button" disabled={readOnly} onClick={() => { onPatch({ prompt: `${data.prompt || ''}\n\n${example}`.trim() }); setExample(''); }}>{t('append')}</button>
        <button type="button" style={motionControl} onClick={() => { void navigator.clipboard?.writeText(example).catch(() => undefined); }}>{t('copy')}</button></div>}
    </>}
    <label style={{ display: 'grid', gap: 4 }}>{t('style')}<select style={motionControl} value={String(advancedValue('motionTemplate')) || 'api_default'} disabled={readOnly || revise}
      onChange={e => { const value = e.currentTarget.value; onPatch({ motionTemplate: value }); }}>
      <option value="api_default">{t('automatic')}</option>{['brand', 'technology', 'illustration'].map(group => <optgroup key={group} label={t(group)}>
        {contract.templates.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{t(`styles.${item.id}`)}</option>)}</optgroup>)}
    </select></label>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
      {(['duration', 'ratio', 'resolution'] as const).map((field, i) => <label key={field} style={{ display: 'grid', gap: 4 }}>{t(field)}
        <select aria-label={t(field)} style={{ ...motionControl, width: '100%', padding: 5 }} value={revise && base ? base.request[field] : data[field] || contract.defaults[field]} disabled={readOnly || revise}
          onChange={e => { const value = e.currentTarget.value; onPatch({ [field]: field === 'duration' ? Number(value) : value }); }}>
          {[contract.durations, contract.ratios, contract.resolutions][i].map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>)}
    </div>
    <details open={expanded || undefined}><summary style={{ cursor: 'pointer', paddingBottom: 8 }}>{t('more')}</summary>{advanced}</details>
  </div>;
}
