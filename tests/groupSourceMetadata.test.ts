import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {fileNameFromUrl} from '../src/utils/mediaCollection.ts';
import {shouldCollectNodeTextOutput} from '../src/utils/imageNodeOutputMode.ts';
import {collectUpstreamMaterials} from '../src/components/nodes/useUpstreamMaterials.ts';

function collectGroup(allNodes:any[]) {
  const source=readFileSync(new URL('../src/components/nodes/GroupBoxNode.tsx',import.meta.url),'utf8');
  const start=source.indexOf('  const collected = useMemo<Collected>('),end=source.indexOf('\n  const aggregateText',start);
  assert.ok(start>=0&&end>start);
  const code=transformSync(source.slice(start,end)+'\nreturn collected;',{loader:'ts'}).code;
  return new Function('useMemo','allNodes','liveMemberIds','shouldCollectNodeTextOutput','fileNameFromUrl','isVideoUrl','isAudioUrl',code)(
    (callback:()=>any)=>callback(),allNodes,allNodes.map(n=>n.id),shouldCollectNodeTextOutput,fileNameFromUrl,
    (url:string)=>/\.(mp4|webm)(\?|$)/i.test(url),(url:string)=>/\.(mp3|wav)(\?|$)/i.test(url),
  );
}
test('actual group collector retains text segment counts, repeated slots, and human image names',()=>{
  const group=collectGroup([
    {id:'split',type:'text-split',data:{textSegments:['same','same'],prompt:'same\n\nsame',text:'same\n\nsame'}},
    {id:'text',type:'text',data:{prompt:'last',text:'last'}},
    {id:'images',type:'upload',data:{uploadType:'image',imageUrl:'/api/resources/file/a',imageUrls:['/api/resources/file/a','/api/resources/file/b'],fileName:'张三.png',fileNames:['张三.png','客厅.png']}},
  ]);
  assert.deepEqual(group.texts,['same','same','last']);
  assert.deepEqual(group.images,['/api/resources/file/a','/api/resources/file/b']);
  const data={textSegments:group.texts,imageUrls:group.images,fileNames:group.images.map((url:string)=>group.imageNames.get(url))};
  const downstream=collectUpstreamMaterials([{id:'group',type:'groupBox',data}],new Map([['group',new Set([null])]]),new Map(),[]);
  assert.deepEqual(downstream.texts.map(item=>item.url),['same','same','last']);
  assert.deepEqual(downstream.images.map(item=>item.label),['张三.png','客厅.png']);
});

test('material-set source occurrence IDs remain stable when the first slot is removed or reordered',()=>{
  const a={id:'slot-a',kind:'image',url:'/same.png'},b={id:'slot-b',kind:'image',url:'/same.png'};
  const collect=(items:any[])=>collectUpstreamMaterials([{id:'set',type:'material-set',data:{materialSetKind:'image',materialSetItems:items}}],new Map([['set',new Set([null])]]),new Map(),[]).images;
  const original=collect([a,b]);assert.equal(original.length,2);
  assert.equal(collect([b])[0].id,original[1].id);
  assert.deepEqual(collect([b,a]).map(item=>item.id),[original[1].id,original[0].id]);
  assert.equal(collect([{kind:'image',url:'/same.png'},{kind:'image',url:'/same.png'}]).length,2);
});
