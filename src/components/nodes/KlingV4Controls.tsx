import { useTranslation } from 'react-i18next';
import { KLING_V4, isKlingV4Aux } from '../../utils/klingV4';
const style = { width: '100%', minWidth: 0, boxSizing: 'border-box' as const, border: '1px solid var(--t8-border)', borderRadius: 6, padding: 6, background: 'var(--t8-bg-input)', color: 'var(--t8-text-main)' };
export default function KlingV4Controls({ data, model, update, linkedCount }: { data: Record<string, any>; model: string; update: (value: Record<string, unknown>) => void; linkedCount: number }) {
  const { t } = useTranslation('klingV4');
  const field = (key: string, label: string, multiline = false, maxLength?: number) => <label style={{ display: 'grid', gap: 4 }}>{t(label)}{multiline
    ? <textarea style={style} rows={3} value={data[key] || ''} onChange={e => { const value = e.currentTarget.value; update({ [key]: value }); }} />
    : <input style={style} maxLength={maxLength} value={data[key] || ''} onChange={e => { const value = e.currentTarget.value; update({ [key]: value }); }} />}</label>;
  const select = (key: string, label: string, values: string[], fallback: string, labels?: string[]) => <label style={{ display: 'grid', gap: 4 }}>{t(label)}<select aria-label={t(label)} style={style} value={data[key] || fallback} onChange={e => { const value = e.currentTarget.value; update({ [key]: value }); }}>{values.map((v,i) => <option key={v} value={v}>{labels ? t(labels[i]) : v}</option>)}</select></label>;
  const result = data.klingV4Result;
  return <section className="nodrag nopan nowheel" data-kling-v4-controls style={{ display: 'grid', gap: 8, padding: 8, border: '1px solid var(--t8-border)', borderRadius: 8, background: 'var(--t8-bg-node)', color: 'var(--t8-text-main)', fontSize: 11 }}>
    <strong>{t('title')}</strong>
    {!isKlingV4Aux(model) && <>
      <label>{t('duration')}<input style={style} type="number" min={3} max={30} step={1} value={data.klingV4Duration ?? 3} onChange={e => { const value = e.currentTarget.value; update({ klingV4Duration: value === '' ? '' : Number(value) }); }} /></label>
      {select('klingV4Resolution', 'resolution', KLING_V4.resolutions, '720p')}
      {model !== 'kling-v4-i2v' && select('klingV4Ratio', 'ratio', [...KLING_V4.ratios, ...(model === 'kling-v4-omni' ? ['adaptive'] : [])], '16:9')}
      {select('klingV4Watermark', 'watermark', KLING_V4.watermarks, 'api_default', ['apiDefault','disabled','enabled'])}
    </>}
    {model === 'kling-v4-i2v' && <small>{t('i2vHint')}</small>}
    {model === 'kling-v4-omni' && <><small>{t('omniHint')}</small>{field('klingV4VideoUrls','videoUrls',true)}{field('klingV4ImageElementIds','imageIds',true)}{field('klingV4VideoElementIds','videoIds',true)}{field('klingV4VoiceIds','voiceIds',true)}</>}
    {model === 'kling-v4-custom-element' && <>{field('klingV4ElementName','elementName',false,20)}{select('klingV4ReferenceType','referenceType',KLING_V4.referenceTypes,'image_refer',['imageReference','videoReference'])}
      <small>{t(data.klingV4ReferenceType === 'video_refer' ? 'videoHint' : 'imageHint')}</small>
      {data.klingV4ReferenceType === 'video_refer' && field('klingV4ElementVideoUrl','elementVideoUrl')}{field('klingV4ElementVoiceId','elementVoice')}{field('klingV4Tags','tags',true)}</>}
    {model === 'kling-v4-custom-voice' && <>{field('klingV4VoiceName','voiceName',false,20)}{select('klingV4VoiceSource','voiceSource',['audio','video_id'],'audio',['audioSource','videoIdSource'])}
      {data.klingV4VoiceSource === 'video_id' ? field('klingV4VideoId','videoId') : field('klingV4AudioUrl','audioUrl')}<small>{t('voiceHint')}</small></>}
    {isKlingV4Aux(model) && <small>{t('idsHint')}</small>}
    {linkedCount > 0 && <small>{t('linked',{count:linkedCount})}</small>}
    {data.klingV4Pending && <small>{t('pending')}</small>}
    {data.klingV4AcceptanceUnknown && <><small role="alert">{t('unknown')}</small><button type="button" style={style} onClick={() => update({ klingV4AcceptanceUnknown: false })}>{t('acknowledge')}</button></>}
    {result && isKlingV4Aux(result.model) && <div><strong>{t('result')}</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result.elementId ? `element_id: ${result.elementId}\n` : ''}{result.voiceId ? `voice_id: ${result.voiceId}` : ''}</pre>
      <button type="button" style={style} onClick={() => { void navigator.clipboard?.writeText(data.outputText || '').catch(() => {}); }}>{t('copy')}</button>
      {result.audioUrl ? <audio aria-label={t('trial')} controls preload="none" src={result.audioUrl} style={{ width: '100%' }} /> : result.model.endsWith('voice') && <small>{t('noTrial')}</small>}
    </div>}
  </section>;
}
