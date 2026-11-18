import {useTranslation} from 'react-i18next';
import {NOV19,qwenAudio31Settings} from '../../utils/nov19Models';
export default function QwenAudio31Controls({model,data,referenceCount,update}:{model:string;data:Record<string,any>;referenceCount:number;update:(p:Record<string,any>)=>void}){
 const {t}=useTranslation(),spec=NOV19.audioProfile(model),s=qwenAudio31Settings(model,data),style={background:'var(--t8-bg-panel)',color:'var(--t8-text-main)',borderColor:'var(--t8-border)'},cls='w-full min-w-0 rounded border px-2 py-1 text-xs';
 const labelText=(key:string)=>t(`nov19:${key}`);
 const put=(k:string,v:any)=>update({qwenAudio31Params:{...s,[k]:v}});
 const select=(key:string,label:string,values:string[])=> <label className="block text-xs">{labelText(label)}<select aria-label={labelText(label)} style={style} className={cls} value={s[key]} onChange={e=>{const v=e.currentTarget.value;if(key==='format'&&v==='opus'&&['22050','44100'].includes(s.sample_rate))update({qwenAudio31Params:{...s,format:v,sample_rate:'24000'}});else put(key,v);}}>{values.map(v=><option key={v} value={v}>{v==='auto'?t('nov19:auto'):v}</option>)}</select></label>;
 const numeric=(key:string,label:string,min:number,max:number,step:number)=> <label className="block text-xs">{labelText(label)}<input aria-label={labelText(label)} className={cls} style={style} type="number" min={min} max={max} step={step} value={s[key]} onChange={e=>{const v=Number(e.currentTarget.value);put(key,v);}}/></label>;
 const check=(key:string,label:string)=> <label className="flex gap-2 text-xs"><input type="checkbox" checked={s[key]===true} onChange={e=>{const v=e.currentTarget.checked;put(key,v);}}/>{labelText(label)}</label>;
 return <div data-qwen-audio31={model} className="nodrag nowheel space-y-2" style={{color:'var(--t8-text-main)'}}>
  <div className="text-[10px]">{labelText(spec.next?'nextHint':'systemHint')}</div><div className="text-[10px]">{t('nov19:referenceCount',{count:referenceCount})}</div>
  {!spec.next&&<><label className="block text-xs">{t('nov19:voice')}<select aria-label={t('nov19:voice')} className={cls} style={style} value={s.voice} onChange={e=>{const v=e.currentTarget.value;put('voice',v);}}>{spec.voices.map((v:any)=><option key={v.id} value={v.id}>{v.name} · {v.id}</option>)}</select></label>{select('language_hint','language',['auto',...spec.languages])}<label className="block text-xs">{t('nov19:instruction')}<textarea aria-label={t('nov19:instruction')} className={cls} style={style} value={s.instruction} onChange={e=>{const v=e.currentTarget.value;put('instruction',v);}}/></label>{numeric('pitch','pitch',.5,2,.1)}{check('enable_ssml','ssml')}</>}
  {select('format','format',spec.formats)}{select('sample_rate','sampleRate',spec.rates.filter((r:string)=>s.format!=='opus'||!['22050','44100'].includes(r)))}
  {spec.next&&select('channels','channels',['1','2'])}{spec.next&&s.format==='mp3'&&check('enable_cbr','cbr')}
  {numeric('rate','rate',.5,2,.1)}{numeric('volume','volume',0,100,1)}{numeric('seed','seed',-1,spec.maxSeed,1)}{check('enable_aigc_tag','aigc')}
  {s.format==='pcm'&&<div className="text-[10px]">{t('nov19:pcmHint')}</div>}
 </div>;
}
