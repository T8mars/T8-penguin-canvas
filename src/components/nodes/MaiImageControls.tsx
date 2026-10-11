import { useTranslation } from 'react-i18next';
import { MAI_IMAGE_CONTRACT, maiImageSettings } from '../../utils/maiImage';

export default function MaiImageControls({ data, referenceCount, update }: {
  data: Record<string, any>; referenceCount: number; update: (patch: Record<string, any>) => void;
}) {
  const { t } = useTranslation();
  const settings = maiImageSettings(data);
  const field = 'w-full min-w-0 rounded border px-2 py-1 text-xs outline-none';
  const style = { background: 'var(--t8-bg-panel)', color: 'var(--t8-text-main)', borderColor: 'var(--t8-border)' };
  return <div className="nodrag nowheel space-y-2 rounded border p-2" style={{ color: 'var(--t8-text-main)', borderColor: 'var(--t8-border)' }}>
    <div className="text-[10px] leading-4">{t('nodes:generation.mai.description')}</div>
    {referenceCount > 0 ? <div className="text-[10px] leading-4">{t('nodes:generation.mai.referenceSizing')}</div> : <>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={settings.maiAutoAspectRatio}
          onChange={(event) => { const value = event.currentTarget.checked; update({ maiAutoAspectRatio: value }); }} />
        {t('nodes:generation.mai.autoAspect')}
      </label>
      {!settings.maiAutoAspectRatio && <label className="block text-xs">{t('nodes:generation.aspectRatio')}
        <select className={field} style={style} value={settings.maiSize}
          onChange={(event) => { const value = event.currentTarget.value; update({ maiSize: value }); }}>
          {MAI_IMAGE_CONTRACT.sizes.map((value) => <option key={value} value={value} style={style}>
            {value === 'custom_ratio' ? t('nodes:generation.mai.customRatio')
              : value === 'custom_pixels' ? t('nodes:generation.mai.customPixels') : value}
          </option>)}
        </select>
      </label>}
      {!settings.maiAutoAspectRatio && settings.maiSize === 'custom_ratio' && <input className={field} style={style}
        aria-label={t('nodes:generation.mai.customRatio')} value={settings.maiCustomRatio} placeholder="16:9"
        onChange={(event) => { const value = event.currentTarget.value; update({ maiCustomRatio: value }); }} />}
      {!settings.maiAutoAspectRatio && settings.maiSize === 'custom_pixels' ? <>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">{t('nodes:generation.width')}
            <input className={field} style={style} type="number" min={768} max={3072} step={32} value={settings.maiWidth}
              onChange={(event) => { const value = Number(event.currentTarget.value); update({ maiWidth: value }); }} />
          </label>
          <label className="text-xs">{t('nodes:generation.height')}
            <input className={field} style={style} type="number" min={768} max={3072} step={32} value={settings.maiHeight}
              onChange={(event) => { const value = Number(event.currentTarget.value); update({ maiHeight: value }); }} />
          </label>
        </div>
        <div className="text-[10px] leading-4">{t('nodes:generation.mai.pixelLimits')}</div>
      </> : <label className="block text-xs">{t('nodes:generation.resolution')}
        <select className={field} style={style} value={settings.maiResolution}
          onChange={(event) => { const value = event.currentTarget.value; update({ maiResolution: value }); }}>
          {MAI_IMAGE_CONTRACT.resolutions.map((value) => <option key={value} value={value} style={style}>{value.toUpperCase()}</option>)}
        </select>
      </label>}
    </>}
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={settings.maiWebGrounding}
        onChange={(event) => { const value = event.currentTarget.checked; update({ maiWebGrounding: value }); }} />
      {t('nodes:generation.mai.webGrounding')}
    </label>
  </div>;
}
