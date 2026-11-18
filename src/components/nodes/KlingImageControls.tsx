import {useTranslation} from 'react-i18next';
import {NOV19,klingImageSettings} from '../../utils/nov19Models';
export default function KlingImageControls({data,update}:{data:Record<string,any>;update:(p:Record<string,any>)=>void}){
 const {t}=useTranslation(),s=klingImageSettings(data),style={background:'var(--t8-bg-panel)',color:'var(--t8-text-main)',borderColor:'var(--t8-border)'},cls='w-full min-w-0 rounded border px-2 py-1 text-xs';
 const labelText=(key:string)=>t(`nov19:${key}`);
 const select=(key:keyof typeof s,label:string,values:string[])=> <label className="block text-xs">{labelText(label)}<select aria-label={labelText(label)} style={style} className={cls} value={s[key]} onChange={e=>{const v=e.currentTarget.value;update({[key]:v});}}>{values.map(v=><option key={v} value={v}>{key==='klingImageMode'?labelText(v==='auto'?'group':'normal'):v}</option>)}</select></label>;
 return <div className="nodrag nowheel space-y-2 rounded border p-2" style={style}>
  <div className="text-[10px]">{t('nov19:klingHint')}</div>
  {select('klingImageSize','size',NOV19.contract.kling.sizes)}{select('klingImageResolution','resolution',NOV19.contract.kling.resolutions)}{select('klingImageMode','mode',['disabled','auto'])}
  <label className="block text-xs">{labelText(s.klingImageMode==='auto'?'groupCount':'count')}<input aria-label={labelText(s.klingImageMode==='auto'?'groupCount':'count')} className={cls} style={style} type="number" min={s.klingImageMode==='auto'?2:1} max={s.klingImageMode==='auto'?4:9} value={s.klingImageMode==='auto'?s.klingImageMaxImages:s.klingImageCount} onChange={e=>{const v=Number(e.currentTarget.value);update({[s.klingImageMode==='auto'?'klingImageMaxImages':'klingImageCount']:v});}}/></label>
  <label className="flex gap-2 text-xs"><input type="checkbox" checked={s.klingImageNsfw} onChange={e=>{const v=e.currentTarget.checked;update({klingImageNsfw:v});}}/>{t('nov19:nsfw')}</label>
 </div>;
}
