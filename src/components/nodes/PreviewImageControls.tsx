import { useTranslation } from 'react-i18next';
import { PREVIEW_MUSE_FLUX, previewImageSettings, fluxVariantSettings } from '../../utils/previewMuseFlux';
export default function PreviewImageControls({model,ratio,data,update}: {model:string;ratio:string;data:Record<string,any>;update:(patch:Record<string,any>)=>void}) {
  const {t}=useTranslation('previewMuseFlux');
  const hy=model===PREVIEW_MUSE_FLUX.hy.model, klein=model.includes('-klein-');
  const values=hy?previewImageSettings(data):fluxVariantSettings(data);
  const style={background:'var(--t8-bg-panel)',color:'var(--t8-text-main)',borderColor:'var(--t8-border)'};
  const number=(key:string,label:string,min:number,max:number)=><label className="block min-w-0 text-xs" key={key}>{t(label)}<input className="w-full min-w-0 rounded border px-2 py-1" style={style} aria-label={t(label)} type="number" min={min} max={max} value={(values as Record<string,any>)[key]} onChange={event=>{const value=Number(event.currentTarget.value);update({[key]:value});}}/></label>;
  return <div className="nodrag nowheel min-w-0 space-y-2" data-preview-image-controls>
    {hy&&ratio==='custom'&&<div className="grid grid-cols-2 gap-2">{number('hyWidth','width',256,8192)}{number('hyHeight','height',256,8192)}</div>}
    {(hy||klein)&&number(hy?'hySeed':'fluxImageSeed','seed',0,hy?Number.MAX_SAFE_INTEGER:2147483647)}
    {hy&&<label className="block text-xs">{t('negative')}<textarea className="w-full min-w-0 rounded border px-2 py-1" style={style} aria-label={t('negative')} value={data.hyNegativePrompt??''} onChange={event=>{const value=event.currentTarget.value;update({hyNegativePrompt:value});}}/></label>}
    {klein&&<>{number('fluxImageSteps','steps',0,16)}<label className="block text-xs">{t('format')}<select className="w-full rounded border px-2 py-1" style={style} aria-label={t('format')} value={data.fluxImageOutputFormat??'api_default'} onChange={event=>{const value=event.currentTarget.value;update({fluxImageOutputFormat:value});}}>{['api_default','png','jpeg'].map(v=><option key={v} value={v} style={style}>{v==='api_default'?t('apiDefault'):v}</option>)}</select></label></>}
  </div>;
}
