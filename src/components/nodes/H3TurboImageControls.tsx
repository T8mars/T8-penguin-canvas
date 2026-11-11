import { useTranslation } from 'react-i18next';
import { H3_TURBO } from '../../utils/h3Turbo';
export default function H3TurboImageControls({ model, data, referenceCount, update }: { model: string; data: Record<string, any>; referenceCount: number; update: (patch: Record<string, any>) => void }) {
  const { t } = useTranslation(), spec = H3_TURBO.profile(model);
  return <div className="nodrag nowheel space-y-2 rounded border p-2 text-xs" style={{ background: 'var(--t8-bg-panel)', color: 'var(--t8-text-main)', borderColor: 'var(--t8-border)' }}>
    <div>{t('h3Turbo:imageHint', { count: spec.maxImages })}</div>
    <label className="block">{t('h3Turbo:ratio')}<select aria-label={t('h3Turbo:ratio')} className="w-full bg-transparent p-1" value={data.aspectRatio ?? spec.ratios[0]} onChange={event => { const value = event.currentTarget.value; update({ aspectRatio: value }); }}>{spec.ratios.map((value: string) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label className="block">{t('h3Turbo:resolution')}<select aria-label={t('h3Turbo:resolution')} className="w-full bg-transparent p-1" value={data.sizeLevel ?? spec.defaultResolution} onChange={event => { const value = event.currentTarget.value; update({ sizeLevel: value }); }}>{spec.resolutions.map((value: string) => <option key={value} value={value} disabled={value === '720p' && !referenceCount}>{value}</option>)}</select></label>
    {model === H3_TURBO.contract.qwen.model && <div>{t('h3Turbo:qwenHint')}</div>}
    <label className="block">{t('h3Turbo:seed')}<input aria-label={t('h3Turbo:seed')} className="w-full bg-transparent p-1" type="number" min={-1} max={2147483647} value={data.h3TurboSeed ?? -1} onChange={event => { const value = Number(event.currentTarget.value); update({ h3TurboSeed: value }); }} /></label>
    {spec.formats && <label className="block">{t('h3Turbo:format')}<select aria-label={t('h3Turbo:format')} className="w-full bg-transparent p-1" value={data.h3TurboFormat ?? 'jpeg'} onChange={event => { const value = event.currentTarget.value; update({ h3TurboFormat: value }); }}>{spec.formats.map((value: string) => <option key={value} value={value}>{value}</option>)}</select></label>}
  </div>;
}
