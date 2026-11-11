import { useTranslation } from 'react-i18next';
export default function Seedream55Controls({ data, layer, update }: { data: Record<string, any>; layer: boolean; update: (patch: Record<string, any>) => void }) {
  const { t } = useTranslation();
  return <div className="nodrag nowheel space-y-2 rounded border p-2 text-xs" style={{ background: 'var(--t8-bg-panel)', color: 'var(--t8-text-main)', borderColor: 'var(--t8-border)' }}>
    {layer ? <>
      <label className="block">{t('seedream55:maxImages')}<input aria-label={t('seedream55:maxImages')} type="number" min={2} max={100} value={data.seedream55MaxImages ?? 30} onChange={event => { const value = Number(event.currentTarget.value); update({ seedream55MaxImages: value }); }} className="w-full rounded border bg-transparent p-1" /></label>
      <label className="flex gap-2"><input type="checkbox" checked={data.seedream55TextRecognition ?? false} onChange={event => { const value = event.currentTarget.checked; update({ seedream55TextRecognition: value }); }} />{t('seedream55:textRecognition')}</label>
      <div className="text-[10px] opacity-70">{t('seedream55:layerHint')}</div>
    </> : <label className="block">{t('seedream55:background')}<select aria-label={t('seedream55:background')} value={data.seedream55Background ?? 'auto'} onChange={event => { const value = event.currentTarget.value; update({ seedream55Background: value }); }} className="w-full rounded border bg-transparent p-1">{['auto', 'transparent', 'opaque'].map(value => <option key={value} value={value} className="bg-zinc-900 text-white">{t(`seedream55:${value}`)}</option>)}</select></label>}
    <label className="flex gap-2"><input type="checkbox" checked={data.seedream55Watermark ?? false} onChange={event => { const value = event.currentTarget.checked; update({ seedream55Watermark: value }); }} />{t('seedream55:watermark')}</label>
    <label className="block">{t('seedream55:identifier')}<input aria-label={t('seedream55:identifier')} value={data.seedream55SafetyIdentifier ?? ''} maxLength={64} onChange={event => { const value = event.currentTarget.value; update({ seedream55SafetyIdentifier: value }); }} className="w-full rounded border bg-transparent p-1" /></label>
  </div>;
}
