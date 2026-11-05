import { useTranslation } from 'react-i18next';
import { NEW_IMAGE_CONTRACT as c,newImageSettings } from '../../utils/g26Krea';
export default function G26KreaControls({model,data,update}:{model:string;data:Record<string,any>;update:(patch:Record<string,any>)=>void}) {
  const {t}=useTranslation('g26Krea3d'),s=newImageSettings(model,data),g=c.g26.models.includes(model),low=model===c.g26.models[0],k=c.krea.models.includes(model);
  const style={background:'var(--t8-bg-panel)',color:'var(--t8-text-main)',borderColor:'var(--t8-border)'};
  const select=(key:string,label:string,values:readonly string[]) => <label className="block text-xs">{t(label)}<select style={style} aria-label={t(label)} className="mt-1 w-full rounded border border-white/15 bg-zinc-900 p-1.5 text-white" value={String(s[key])} onChange={e=>{const value=e.currentTarget.value;update({[key]:value});}}>{values.map(v=><option key={v} value={v}>{v==='api_default'?t('apiDefault'):v==='custom'?t('custom'):v}</option>)}</select></label>;
  const number=(key:string,label:string,min:number,max:number,step=1) => <label className="block text-xs">{t(label)}<input style={style} aria-label={t(label)} type="number" min={min} max={max} step={step} className="mt-1 w-full rounded border border-white/15 bg-zinc-900 p-1.5 text-white" value={Number(s[key])} onChange={e=>{const value=e.currentTarget.valueAsNumber;update({[key]:Number.isFinite(value)?value:min});}}/></label>;
  const text=(key:string,label:string) => <label className="block text-xs">{t(label)}<input style={style} aria-label={t(label)} className="mt-1 w-full rounded border border-white/15 bg-zinc-900 p-1.5 text-white" value={String(s[key])} onChange={e=>{const value=e.currentTarget.value;update({[key]:value});}}/></label>;
  return <div className="nodrag nowheel min-w-0 space-y-2 rounded border p-2" style={style} data-testid="g26-krea-controls">
    <div className="text-[11px] opacity-70">{t(g?low?'lowDescription':'officialDescription':k?'kreaDescription':'zDescription')}</div>
    {g?<>
      {select('g26Mode','outputMode',low?['image','gif']:['image','gif','svg'])}
      {!low&&s.g26Mode==='gif'?<>
        {select('g26GifSize','frameSize',c.g26.gifSizes)}
        {s.g26GifSize==='custom'&&<div className="grid grid-cols-2 gap-2">{number('g26GifWidth','width',16,3840,16)}{number('g26GifHeight','height',16,3840,16)}</div>}
        <div className="grid grid-cols-2 gap-2">{number('g26FrameCount','frameCount',2,16)}{number('g26FrameDuration','frameDuration',20,Number.MAX_SAFE_INTEGER,10)}</div>
      </>:<>
        {select('g26Size','size',c.g26.sizes.filter(v=>!low||v!=='custom'))}
        {s.g26Size==='custom'&&<div className="grid grid-cols-2 gap-2">{number('g26Width','width',16,3840,16)}{number('g26Height','height',16,3840,16)}</div>}
        {!low&&s.g26Mode==='image'&&<>
          <div className="grid grid-cols-2 gap-2">{select('g26Resolution','resolution',c.g26.resolutions)}{number('g26Count','count',1,4)}</div>
          <div className="grid grid-cols-2 gap-2">{select('g26Format','format',c.g26.formats)}{select('g26Quality','quality',c.g26.qualities)}</div>
          {select('g26Complexity','complexity',c.g26.complexities)}
          {['jpeg','webp'].includes(String(s.g26Format))&&number('g26Compression','compression',-1,100)}
          {text('g26MaskUrl','maskUrl')}{text('g26MarkupUrl','markupUrl')}
        </>}
      </>}
      {s.g26Mode==='gif'&&<div className="text-[11px] opacity-70">{t(low?'promptGif':'officialGif')}</div>}
      {s.g26Mode==='svg'&&<div className="text-[11px] opacity-70">{t('svgDescription')}</div>}
    </>:k?<>
      {select('kreaSize','size',[...Object.keys(c.krea.presets),'custom'])}
      {s.kreaSize==='custom'&&<div className="grid grid-cols-2 gap-2">{number('kreaWidth','width',256,4096)}{number('kreaHeight','height',256,4096)}</div>}
      <div className="grid grid-cols-2 gap-2">{select('kreaVariant','variant',c.krea.variants)}{select('kreaReasoning','reasoning',c.krea.reasoning)}</div>
      {select('kreaFormat','format',c.krea.formats)}{number('kreaSeed','seed',-1,2147483647)}{text('kreaNegative','negative')}
    </>:<>{select('zImageRatio','ratio',c.zimage.ratios)}{number('zImageSeed','seed',-1,Number.MAX_SAFE_INTEGER)}</>}
  </div>;
}
