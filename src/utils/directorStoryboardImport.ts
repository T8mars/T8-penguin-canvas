import {
  DIRECTOR_STORYBOARD_DEFAULT_DURATION_SEC,
  DIRECTOR_STORYBOARD_MIN_DURATION_SEC,
  DIRECTOR_STORYBOARD_MAX_DURATION_SEC,
  sanitizeDirectorStoryboardShots,
  type DirectorStoryboardShot,
} from './directorStoryboard.ts';
import { splitText } from './textSplit.ts';
import { sha256Hex } from './incrementalSha256.ts';
import { materialMentionKey, type MediaMention } from '../components/nodes/mediaMentions';
import type { Material } from '../components/nodes/useUpstreamMaterials';

function imageAliases(material: Material) {
  let file = material.url.split(/[?#]/)[0].split('/').pop() || '';
  try { file = decodeURIComponent(file); } catch { /* Keep undecodable names literal. */ }
  return [...new Set([material.label || '', file].map(name => name.replace(/\.(?:png|jpe?g|webp|gif|bmp|avif)$/i,'').trim()))]
    .filter(name => name.length >= 2 && !/^(?:图片|图像|image|参考图)[\s_-]*\d*$/i.test(name));
}

/** Names and explicit @imageN tokens only. No visual/semantic guessing. */
export function assignDirectorShotImages(shot: DirectorStoryboardShot, images: Material[]) {
  const references = [...shot.localRefImages];
  const bindings = [...(shot.automaticImageBindings || [])];
  const mentions = [...(shot.promptMentions || [])];
  const issues: string[] = [];
  const aliases = new Map<string, Material[]>();
  for (const image of images) for (const alias of imageAliases(image)) {
    const key = alias.toLocaleLowerCase();
    const list = aliases.get(key) || [];
    if (!list.some(item => item.url === image.url)) list.push(image);
    aliases.set(key,list);
  }
  const matched: Array<{at:number;end:number;label:string;material:Material}> = [];
  const ambiguousRanges: Array<{start:number;end:number}> = [];
  const lower = shot.prompt.toLocaleLowerCase();
  for (const [alias,candidates] of aliases) {
    let at = lower.indexOf(alias);
    while (at >= 0) {
      const end = at + alias.length;
      // Avoid matching "cat" in "catalog" or a short role name inside a longer alias.
      const ascii = /^[\x00-\x7f]+$/.test(alias);
      if (!ascii || (!/[\w]/.test(lower[at-1] || '') && !/[\w]/.test(lower[end] || ''))) {
        if (candidates.length === 1) matched.push({at,end,label:shot.prompt.slice(at,end),material:candidates[0]});
        else { issues.push(alias); ambiguousRanges.push({start:at,end}); }
      }
      at = lower.indexOf(alias,at+alias.length);
    }
  }
  const ranges: Array<{start:number;end:number}> = [];
  matched.sort((a,b)=>(b.end-b.at)-(a.end-a.at)).filter(match=>{
    if(ambiguousRanges.some(range=>match.at<range.end&&match.end>range.start))return false;
    if(ranges.some(range=>match.at<range.end&&match.end>range.start))return false;
    ranges.push({start:match.at,end:match.end});return true;
  }).sort((a,b)=>a.at-b.at).forEach(({material,label})=>{
    if(!references.includes(material.url))references.push(material.url);
    if(!bindings.some(item=>item.url===material.url&&item.label===label))bindings.push({url:material.url,label});
  });
  for(const match of shot.prompt.matchAll(/@(?:image|img)(\d+)\b/g)) {
    const start=match.index!,end=start+match[0].length;
    // Existing bound tokens retain their asset identity when input order changes.
    if(mentions.some(mention=>mention.start===start&&mention.end===end&&mention.token===match[0]))continue;
    const image=images[Number(match[1])-1];
    if(!image){issues.push(match[0]);continue;}
    if(!references.includes(image.url))references.push(image.url);
    mentions.push({id:`${shot.id}:image:${start}`,kind:'image',materialKey:materialMentionKey(image),url:image.url,label:image.label,token:match[0],start,end} satisfies MediaMention);
  }
  const localRefOrder=[...shot.localRefOrder];
  references.forEach(url=>{if(!localRefOrder.some(ref=>ref.kind==='image'&&ref.url===url))localRefOrder.push({kind:'image',url});});
  return {shot:{...shot,localRefImages:references,localRefOrder,promptMentions:mentions,...(bindings.length?{automaticImageBindings:bindings}:{})},issues:[...new Set(issues)]};
}

function scriptDuration(prompt:string) {
  const clock=prompt.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—~至]\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
  const numeric=prompt.match(/(?:^|[\s[（(])([0-9]+(?:\.[0-9]+)?)\s*(?:s|秒)?\s*[-–—~至]\s*([0-9]+(?:\.[0-9]+)?)\s*(?:s|秒)/i);
  const single=prompt.match(/(?:时长|duration)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/i);
  const seconds=(value:string)=>value.split(':').reduce((total,part)=>total*60+Number(part),0);
  return clock ? seconds(clock[2])-seconds(clock[1]) : numeric ? Number(numeric[2])-Number(numeric[1]) : single ? Number(single[1]) : DIRECTOR_STORYBOARD_DEFAULT_DURATION_SEC;
}

export function importDirectorUpstreamScripts(existing: DirectorStoryboardShot[], texts: Material[], images: Material[]) {
  const drafts: DirectorStoryboardShot[]=[];
  const issues:string[]=[];
  const invalidDurations:Array<{title:string;duration:number}>=[];
  for(const material of texts) {
    const scripts=splitText(material.url,{mode:'storyboard',trim:true,removeEmpty:true});
    scripts.forEach((prompt,index)=>{
      const duration=scriptDuration(prompt);
      const title=prompt.split(/\r?\n/)[0].replace(/^#+\s*/,'').slice(0,64)||`S${drafts.length+1}`;
      if(!Number.isInteger(duration)||duration<DIRECTOR_STORYBOARD_MIN_DURATION_SEC||duration>DIRECTOR_STORYBOARD_MAX_DURATION_SEC)invalidDurations.push({title,duration});
      const digest=sha256Hex(new TextEncoder().encode(JSON.stringify([material.sourceNodeId,material.id,index,prompt])));
      const base=sanitizeDirectorStoryboardShots([{id:`shot-import-${digest}`,title,prompt,durationSec:duration,useUpstreamPrompt:false}])[0];
      const assigned=assignDirectorShotImages(base,images);drafts.push(assigned.shot);issues.push(...assigned.issues);
    });
  }
  const keep=existing.filter(shot=>shot.prompt||shot.localRefImages.length||shot.localRefVideos.length||shot.localRefAudios.length||shot.taskId||shot.videoUrl||shot.status||shot.title!=='S1'||shot.durationSec!==5||shot.frameMode!=='auto'||shot.seed!==undefined||shot.modelOverride||shot.ratioOverride||shot.resolutionOverride);
  const ids=new Set(keep.map(shot=>shot.id));
  const added=drafts.filter(shot=>{if(ids.has(shot.id))return false;ids.add(shot.id);return true;});
  return {shots:[...keep,...added],added,issues:[...new Set(issues)],invalidDurations};
}
