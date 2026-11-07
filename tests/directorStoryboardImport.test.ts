import test from 'node:test';
import assert from 'node:assert/strict';
import { assignDirectorShotImages, importDirectorUpstreamScripts } from '../src/utils/directorStoryboardImport.ts';
import { buildDirectorShotSeedancePayload, sanitizeDirectorStoryboardShots } from '../src/utils/directorStoryboard.ts';
import type {Material} from '../src/components/nodes/useUpstreamMaterials';

const image=(id:string,name:string):Material=>({id,kind:'image',url:`/api/resources/file/${id}`,label:name,sourceNodeId:'pictures',origin:'upstream'});
const text=(id:string,url:string):Material=>({id,kind:'text',url,sourceNodeId:'scripts',origin:'upstream'});
const settings={model:'seedance-2.0',ratio:'16:9',resolution:'720p',generateAudio:true,returnLastFrame:false,watermark:false,webSearch:false,seed:-1};
const base=(prompt:string)=>sanitizeDirectorStoryboardShots([{id:'manual',prompt,title:'S1',durationSec:5}])[0];
const images=[image('a','张三.png'),image('b','客厅.png'),image('c','李四.png')];

test('headed script creates the exact shot count and durations; repeat import preserves IDs/results',()=>{
  const scripts=[text('script','# 镜头1 0-5秒\n张三走进客厅\n\n# 镜头2 5-11秒\n李四回头')];
  const plan=importDirectorUpstreamScripts(sanitizeDirectorStoryboardShots([]),scripts,images);
  assert.equal(plan.shots.length,2);assert.equal(plan.added.length,2);assert.deepEqual(plan.invalidDurations,[]);
  assert.deepEqual(plan.shots.map(shot=>shot.durationSec),[5,6]);
  const completed={...plan.shots[0],status:'success',taskId:'keep-task',videoUrl:'/keep.mp4'};
  const repeat=importDirectorUpstreamScripts([completed,plan.shots[1]],scripts,images);
  assert.equal(repeat.added.length,0);assert.deepEqual(repeat.shots[0],completed);
});
test('each upstream text occurrence becomes a shot, including intentionally repeated scripts',()=>{
  const scripts=[text('one','第一段'),text('two','第二段'),text('repeat','第一段')];
  const plan=importDirectorUpstreamScripts([],scripts,[]);
  assert.equal(plan.shots.length,3);assert.equal(new Set(plan.shots.map(shot=>shot.id)).size,3);
  assert.deepEqual(plan.shots.map(shot=>shot.prompt),['第一段','第二段','第一段']);
});
test('existing authored shots and completed results are retained when new scripts are imported',()=>{
  const authored={...base('我的手工脚本'),taskId:'job',videoUrl:'/original.mp4'};
  const plan=importDirectorUpstreamScripts([authored],[text('new','新脚本')],[]);
  assert.equal(plan.shots.length,2);assert.deepEqual(plan.shots[0],authored);
});
test('character and scene images match exact file labels without attaching every upstream image',()=>{
  const result=assignDirectorShotImages(base('张三走进客厅'),images);
  assert.deepEqual(result.shot.localRefImages,[images[0].url,images[1].url]);assert.deepEqual(result.issues,[]);
  const payload=buildDirectorShotSeedancePayload(result.shot,settings,{mentionMaterials:images});
  assert.deepEqual(payload.refImages,[images[0].url,images[1].url]);
  assert.match(payload.prompt,/张三=@image1/);assert.match(payload.prompt,/客厅=@image2/);
  assert.ok(!payload.refImages?.includes(images[2].url));
});
test('explicit global image token is bound once and numbered by the actual submitted reference list',()=>{
  const result=assignDirectorShotImages(base('主角是 @image3'),images);
  const payload=buildDirectorShotSeedancePayload(result.shot,settings,{mentionMaterials:images});
  assert.deepEqual(payload.refImages,[images[2].url]);assert.equal(payload.prompt,'主角是 @image1');
  const reordered=assignDirectorShotImages(result.shot,[images[2],images[0],images[1]]);
  assert.equal(reordered.shot.promptMentions![0].url,images[2].url);
  const after=buildDirectorShotSeedancePayload(reordered.shot,settings,{mentionMaterials:[images[2],images[0],images[1]]});
  assert.deepEqual(after.refImages,[images[2].url]);assert.equal(after.prompt,'主角是 @image1');
});
test('imported shots do not inherit all upstream scripts into each individual generation request',()=>{
  const plan=importDirectorUpstreamScripts([],[text('one','张三在客厅'),text('two','李四在卧室')],images);
  const shot=sanitizeDirectorStoryboardShots(JSON.parse(JSON.stringify(plan.shots)))[0];
  const payload=buildDirectorShotSeedancePayload(shot,settings,{upstreamPrompt:'全部脚本不该重复进入单镜头',mentionMaterials:images});
  assert.ok(!payload.prompt.includes('全部脚本'));assert.ok(!payload.prompt.includes('李四'));
  assert.match(payload.prompt,/张三/);
});
test('ambiguous names, overlapping longer names and missing token references are reported without guessing',()=>{
  const ambiguous=assignDirectorShotImages(base('张三走进客厅 @image99'),[images[0],image('other','张三.png')]);
  assert.equal(ambiguous.shot.localRefImages.length,0);assert.ok(ambiguous.issues.includes('张三'));assert.ok(ambiguous.issues.includes('@image99'));
  const longer=assignDirectorShotImages(base('张三丰回头'),[images[0],image('x','张三丰.png'),image('y','张三丰.png')]);
  assert.equal(longer.shot.localRefImages.length,0);
});
test('longer unique names win, ASCII words do not match substrings, and manual references survive',()=>{
  const result=assignDirectorShotImages({...base('张三丰翻开 catalog'),localRefImages:['/manual.png'],localRefOrder:[{kind:'image',url:'/manual.png'}]},[images[0],image('long','张三丰.png'),image('cat','cat.png')]);
  assert.deepEqual(result.shot.localRefImages,['/manual.png','/api/resources/file/long']);
});
test('unsupported/noninteger script durations are exposed to the import handler instead of silently accepted',()=>{
  for(const script of ['镜头1 0-30秒\n动作','镜头1 0-2秒\n动作','时长：5.5秒\n动作']){
    assert.equal(importDirectorUpstreamScripts([],[text('bad',script)],[]).invalidDurations.length,1);
  }
  const clock=importDirectorUpstreamScripts([],[text('clock','镜头 00:05–00:12\n动作')],[]);
  assert.equal(clock.shots[0].durationSec,7);
});
test('asset assignment is repeatable and survives serialized drafts without duplicating references',()=>{
  const first=assignDirectorShotImages(base('张三和李四在客厅'),images).shot;
  const next=assignDirectorShotImages(sanitizeDirectorStoryboardShots(JSON.parse(JSON.stringify([first])))[0],images).shot;
  assert.deepEqual(next.localRefImages,first.localRefImages);
  assert.deepEqual(next.automaticImageBindings,first.automaticImageBindings);
});
