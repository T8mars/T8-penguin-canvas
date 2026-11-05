import {useTranslation} from 'react-i18next';
import {NEW_3D_CONTRACT as c} from '../../utils/new3dModels';
export default function New3dControls({model,data,update}:{model:string;data:Record<string,any>;update:(p:Record<string,any>)=>void}){
 const {t}=useTranslation('g26Krea3d'),hitem=c.hitem.models.includes(model),portrait=model.includes('portrait'),text=model===c.meshy.textModel;
 const style={background:'var(--t8-bg-panel)',color:'var(--t8-text-main)',borderColor:'var(--t8-border)'};
 const select=(key:string,label:string,values:readonly string[],fallback:string)=><label className="block text-xs">{t(label)}<select style={style} aria-label={t(label)} className="mt-1 w-full rounded border border-white/15 bg-zinc-900 p-1.5" value={data[key]??fallback} onChange={e=>{const value=e.currentTarget.value;update({[key]:value});}}>{values.map(v=><option key={v} value={v}>{v==='api_default'?t('apiDefault'):v==='true'?t('enabled'):v==='false'?t('disabled'):['mesh','both','realistic','sculpture'].includes(v)?t(v):v}</option>)}</select></label>;
 const number=(key:string,label:string,min:number,max:number,fallback:number)=><label className="block text-xs">{t(label)}<input style={style} aria-label={t(label)} className="mt-1 w-full rounded border border-white/15 bg-zinc-900 p-1.5" type="number" min={min} max={max} value={data[key]??fallback} onChange={e=>{const value=e.currentTarget.valueAsNumber;update({[key]:Number.isFinite(value)?value:min});}}/></label>;
 return <div className="nodrag nowheel min-w-0 space-y-2" style={style}>
  {hitem?<>{select('hitemRequestType','requestType',c.hitem.requestTypes,'both')}{!portrait&&select('hitemResolution','resolution',c.hitem.resolutions,'1536')}{portrait&&<div className="text-xs">1536pro</div>}{number('hitemFace','faces',100000,2000000,1000000)}</>:<>
   {text&&<><label className="block text-xs">{t('meshyPrompt')}<textarea style={style} aria-label={t('meshyPrompt')} value={data.prompt??''} onChange={e=>{const value=e.currentTarget.value;update({prompt:value});}} className="mt-1 h-24 w-full resize-none rounded border p-1.5"/></label><div className="text-[11px] opacity-70">{[...String(data.prompt??'').trim()].length}/{c.meshy.maxPromptCharacters}</div>{select('meshyArtStyle','artStyle',c.meshy.artStyles,'api_default')}{select('meshyPromptExpansion','promptExpansion',c.meshy.booleanChoices,'api_default')}</>}
   {select('meshyTopology','topology',c.meshy.topologies,'api_default')}{select('meshySymmetry','symmetry',c.meshy.symmetries,'api_default')}{number('meshyPolycount','targetPolycount',0,300000,0)}
   {c.meshy.booleans.filter(field=>!text||field!=='should_texture').map(field=><div key={field}>{select('meshy_'+field,field,c.meshy.booleanChoices,'api_default')}</div>)}
  </>}
  <div className="text-[11px] opacity-70">{t(text?'meshyTextReferences':model.includes('multi-image')?'frontBackViews':'singleView')}</div>
 </div>;
}
