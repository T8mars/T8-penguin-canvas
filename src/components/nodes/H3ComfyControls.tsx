import { useTranslation } from 'react-i18next';
import { H3_TURBO } from '../../utils/h3Turbo';
export default function H3ComfyControls({model,data,update}: {model:string;data:any;update:(patch:any)=>void}) {
  const {t} = useTranslation(), spec = H3_TURBO.profile(model);
  if (!spec?.video) return null;
  const style = {background:'var(--t8-bg-panel)',borderColor:'var(--t8-border)',color:'var(--t8-text-main)'};
  return <div className="nodrag nowheel space-y-2 text-xs" style={{color:'var(--t8-text-main)'}}>
    <div>{t(`h3Turbo:${spec.frames?'charswapHint':spec.nativeSeed?'wuxiHint':spec.audioNeedsImage?'selfliftHint':'wfHint'}`)}</div>
    {spec.frames && <>
      <label className="block">{t('h3Turbo:durationMode')}<select aria-label={t('h3Turbo:durationMode')} style={style} className="block w-full rounded border p-1" value={data.h3ComfyDurationMode || 'seconds'} onChange={e=>update({h3ComfyDurationMode:e.target.value})}>
        <option value="seconds">{t('h3Turbo:seconds')}</option><option value="frames">{t('h3Turbo:frames')}</option>
      </select></label>
      {data.h3ComfyDurationMode === 'frames' && <label className="block">{t('h3Turbo:frames')}<select aria-label={t('h3Turbo:frames')} style={style} className="block w-full rounded border p-1" value={data.h3ComfyFrames ?? 124} onChange={e=>update({h3ComfyFrames:Number(e.target.value)})}>{H3_TURBO.frames.map(n=><option key={n} value={n}>{n}</option>)}</select></label>}
    </>}
    {spec.nativeSeed && <label className="block">{t('h3Turbo:seed')}<input aria-label={t('h3Turbo:seed')} type="number" min={-1} max={2147483647} style={style} className="block w-full rounded border p-1" value={data.h3ComfySeed ?? -1} onChange={e=>update({h3ComfySeed:e.target.value === '' ? -1 : Number(e.target.value)})}/></label>}
  </div>;
}
