import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

function publish(d:Record<string,any>,images:string[]=[]){
  const source=readFileSync(new URL('../src/components/nodes/OutputNode.tsx',import.meta.url),'utf8');
  const start=source.indexOf('  useEffect(() => {',source.indexOf('// === 下游透传:'));
  const end=source.indexOf('\n  // === v1.2.10.2:',start);
  assert.ok(start>=0&&end>start);
  const collected={texts:['original 1','original 2'],images,videos:[],audios:[],models:[]};
  let patch:Record<string,any>|undefined;
  const deps={useEffect:(callback:()=>void)=>callback(),d,displayText:'edited @image1',overrideText:d.outputText||'',collected,publishedImageUrls:images,upstreamNodes:[],handleMap:new Map(),update:(next:Record<string,any>)=>{patch=next;},motionAssetRefs:()=>[],selectSourceHandleData:()=>[],motionSlotVideos:()=>[]};
  new Function(...Object.keys(deps),transformSync(source.slice(start,end),{loader:'ts'}).code)(...Object.values(deps));
  return patch;
}
test('edited output text and asset mentions replace stale split segments in the actual publication effect',()=>{
  const patch=publish({outputText:'edited @image1'})!;
  assert.equal(patch.prompt,'edited @image1');assert.equal(patch.promptResolved,'edited @image1');
  assert.deepEqual(patch.textSegments,['edited @image1']);assert.deepEqual(patch.segments,['edited @image1']);
  assert.equal(publish({...patch,outputText:'edited @image1'}),undefined);
});
test('unmodified text keeps all split entries and mixed-media output retains its established media-only policy',()=>{
  assert.deepEqual(publish({})!.textSegments,['original 1','original 2']);
  const mixed=publish({outputText:'edited @image1'},['/a.png'])!;
  assert.deepEqual(mixed.textSegments,[]);assert.equal(mixed.prompt,'');assert.deepEqual(mixed.imageUrls,['/a.png']);
});
