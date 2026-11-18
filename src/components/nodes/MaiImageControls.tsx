import {NOV19} from '../../utils/nov19Models';
import { useTranslation } from 'react-i18next';
import { MAI_IMAGE_CONTRACT, maiImageSettings } from '../../utils/maiImage';

export default function MaiImageControls({ model, data, referenceCount, update }: {
  model?:string; data: Record<string, any>; referenceCount: number; update: (patch: Record<string, any>) => void;
}) {
  const { t } = useTranslation();
  const modern=NOV19.isMai(model || ''),settings = maiImageSettings(data,model),automatic=!modern&&settings.maiAutoAspectRatio;
  const field = 'w-full min-w-0 rounded border px-2 py-1 text-xs outline-none';
  const style = { background: 'var(--t8-bg-panel)', color: 'var(--t8-text-main)', borderColor: 'var(--t8-border)' };
  return <div className="nodrag nowheel space-y-2 rounded border p-2" style={{ color: 'var(--t8-text-main)', borderColor: 'var(--t8-border)' }}>
    <div className="text-[10px] leading-4">{t(modern?'nov19:maiHint':'nodes:generation.mai.description')}</div>
    {referenceCount > 0 ? <div className="text-[10px] leading-4">{t('nodes:generation.mai.referenceSizing')}</div> : <>
      {!modern&&<label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={settings.maiAutoAspectRatio}
          onChange={(event) => { const value = event.currentTarget.checked; update({ maiAutoAspectRatio: value }); }} />
        {t('nodes:generation.mai.autoAspect')}
      </label>}
      {!automatic && <label className="block text-xs">{t('nodes:generation.aspectRatio')}
        <select className={field} style={style} value={settings.maiSize}
          onChange={(event) => { const value = event.currentTarget.value; update({ maiSize: value }); }}>
          {MAI_IMAGE_CONTRACT.sizes.filter(value=>!modern||value!=='auto').map((value) => <option key={value} value={value} style={style}>
            {value === 'custom_ratio' ? t('nodes:generation.mai.customRatio')
              : value === 'custom_pixels' ? t('nodes:generation.mai.customPixels') : value}
          </option>)}
        </select>
      </label>}
      {!automatic && settings.maiSize === 'custom_ratio' && <input className={field} style={style}
        aria-label={t('nodes:generation.mai.customRatio')} value={settings.maiCustomRatio} placeholder="16:9"
        onChange={(event) => { const value = event.currentTarget.value; update({ maiCustomRatio: value }); }} />}
      {!automatic && settings.maiSize === 'custom_pixels' ? <>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">{t('nodes:generation.width')}
            <input className={field} style={style} type="number" min={768} max={modern?5461:3072} step={32} value={settings.maiWidth}
              onChange={(event) => { const value = Number(event.currentTarget.value); update({ maiWidth: value }); }} />
          </label>
          <label className="text-xs">{t('nodes:generation.height')}
            <input className={field} style={style} type="number" min={768} max={modern?5461:3072} step={32} value={settings.maiHeight}
              onChange={(event) => { const value = Number(event.currentTarget.value); update({ maiHeight: value }); }} />
          </label>
        </div>
        <div className="text-[10px] leading-4">{t(modern?'nov19:maiHint':'nodes:generation.mai.pixelLimits')}</div>
      </> : <label className="block text-xs">{t('nodes:generation.resolution')}
        <select className={field} style={style} value={settings.maiResolution}
          onChange={(event) => { const value = event.currentTarget.value; update({ maiResolution: value }); }}>
          {MAI_IMAGE_CONTRACT.resolutions.map((value) => <option key={value} value={value} style={style}>{value.toUpperCase()}</option>)}
        </select>
      </label>}
    </>}
    {!modern&&<label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={settings.maiWebGrounding}
        onChange={(event) => { const value = event.currentTarget.checked; update({ maiWebGrounding: value }); }} />
      {t('nodes:generation.mai.webGrounding')}
    </label>}
    {modern&&<><label className="block text-xs">{t('nov19:background')}<select className={field} style={style} value={settings.maiBackground} onChange={e=>{const v=e.currentTarget.value;update({maiBackground:v});}}>{['auto','opaque'].map(v=><option key={v} value={v}>{t(v==='auto'?'nov19:auto':'nov19:opaque')}</option>)}</select></label><label className="flex gap-2 text-xs"><input type="checkbox" checked={settings.maiNsfw} onChange={e=>{const v=e.currentTarget.checked;update({maiNsfw:v});}}/>{t('nov19:nsfw')}</label></>}
  </div>;
}
