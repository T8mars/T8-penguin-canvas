import { useTranslation } from 'react-i18next';
export default function Seedance25DraftControls({ data, enhance, upstreamId, update }: { data: Record<string, any>; enhance: boolean; upstreamId: string; update: (patch: Record<string, any>) => void }) {
  const { t } = useTranslation();
  return <div className="nodrag nowheel space-y-2 rounded border p-2 text-xs" style={{ background: 'var(--t8-bg-panel)', color: 'var(--t8-text-main)', borderColor: 'var(--t8-border)' }}>
    {enhance ? <>
      <div>{t('seedream55:draftHint')}</div>
      <label className="block">{t('seedream55:draftId')}<input aria-label={t('seedream55:draftId')} value={data.seedance25DraftTaskId || ''} placeholder={upstreamId || t('seedream55:draftPlaceholder')} onChange={event => { const value = event.currentTarget.value; update({ seedance25DraftTaskId: value }); }} className="w-full rounded border bg-transparent p-1" /></label>
      <label className="block">{t('seedream55:videoFormat')}<select aria-label={t('seedream55:videoFormat')} value={data.seedance25OutputFormat || 'mp4'} onChange={event => { const value = event.currentTarget.value; update({ seedance25OutputFormat: value }); }} className="w-full rounded border bg-transparent p-1">{['mp4', 'mov'].map(value => <option key={value} className="bg-zinc-900 text-white">{value}</option>)}</select></label>
      <label className="flex gap-2"><input type="checkbox" checked={data.returnLastFrame ?? false} onChange={event => { const value = event.currentTarget.checked; update({ returnLastFrame: value }); }} />{t('seedream55:lastFrame')}</label>
      {data.lastFrameUrl && <a href={data.lastFrameUrl} download className="block underline">{t('seedream55:lastFrame')}</a>}
    </> : <>
      <label className="flex gap-2"><input type="checkbox" checked={data.seedance25Draft ?? false} onChange={event => { const value = event.currentTarget.checked; update({ seedance25Draft: value, ...(value ? { resolution: '480p' } : {}) }); }} />{t('seedream55:createDraft')}</label>
      {data.seedance25Draft && <div>{t('seedream55:sourceHint')}</div>}
      {data.seedance25DraftTaskIdResult && <input aria-label={t('seedream55:draftResult')} readOnly value={data.seedance25DraftTaskIdResult} className="w-full rounded border bg-transparent p-1" />}
    </>}
  </div>;
}
