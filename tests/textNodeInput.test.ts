import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTextNodeInput, textInputHasCycle } from '../src/utils/textNodeInput.ts';

test('text node follows ordered split text inputs and preserves the local draft on disconnect', () => {
  const original={prompt:'local draft',promptMentions:[]};
  const first=resolveTextNodeInput(original,[{url:'shot A'},{url:'shot B'}]);
  assert.equal(first.text,'shot A\n\nshot B');assert.equal(first.following,true);
  const stored={...original,...first.patch};
  assert.equal(stored.textLocalPrompt,'local draft');
  assert.deepEqual(resolveTextNodeInput(stored,[{url:'shot A'},{url:'shot B'}]).patch,{});
  const changed=resolveTextNodeInput(stored,[{url:'new script'}]);
  assert.equal(changed.text,'new script');
  assert.equal(resolveTextNodeInput({...stored,...changed.patch},[]).text,'local draft');
});
test('text field-only agent nodes display their actual content and manual mode is respected',()=>{
  assert.equal(resolveTextNodeInput({text:'generated text'},[]).text,'generated text');
  assert.equal(resolveTextNodeInput({prompt:'own',textUseUpstream:false},[{url:'incoming'}]).text,'own');
  const edited={prompt:'edited @image1',textLocalPrompt:'edited @image1',textUseUpstream:false};
  assert.equal(resolveTextNodeInput(edited,[{url:'new incoming'}]).text,edited.prompt);
});
test('text feedback cycles are detected before enabling live input propagation',()=>{
  const edges=[{source:'a',target:'b'},{source:'b',target:'c'},{source:'c',target:'a'}];
  assert.equal(textInputHasCycle('a',edges),true);
  assert.equal(textInputHasCycle('other',edges),false);
  assert.equal(textInputHasCycle('a',edges.slice(0,2)),false);
  assert.equal(resolveTextNodeInput({prompt:'safe'},[{url:'feedback'}],false).text,'safe');
  assert.equal(textInputHasCycle('text',[{source:'group',target:'text'}],[{id:'group',type:'groupBox',data:{memberIds:['text']}}]),true);
  assert.equal(textInputHasCycle('outside',[{source:'group',target:'outside'}],[{id:'group',type:'groupBox',data:{memberIds:['other']}}]),false);
});
