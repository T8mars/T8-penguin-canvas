const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../backend/src/providers/g26Krea3d');
test('G2.6 LowPrice GIF remains prompt-driven and preserves ordered references',()=>{
 const p=api.buildImage({model:api.contract.g26.models[0],prompt:'ball',output_mode:'gif',images:['front','back']});
 assert.equal(p.payload.n,1);assert.equal(p.payload.resolution,'1k');assert.match(p.payload.prompt,/looping GIF/);assert.deepEqual(p.sources,['front','back']);
 for(const key of ['output_format','frame_count','frame_duration_ms'])assert.equal(key in p.payload,false);
 assert.throws(()=>api.buildImage({model:p.model,prompt:'ball',images:['a','b','c']}),/reference/);
});
test('Official GIF sheet bounds and SVG contract are distinct from static editing',()=>{
 for(const model of api.contract.g26.models.slice(1)){
  const gif=api.buildImage({model,prompt:'ball',output_mode:'gif',size:'768x512',frame_count:4,frame_duration_ms:200});
  assert.equal(gif.payload.output_format,'gif');assert.equal('resolution' in gif.payload,false);
  assert.throws(()=>api.buildImage({model,prompt:'ball',output_mode:'gif',images:['a']}),/text-only/);
  assert.throws(()=>api.buildImage({model,prompt:'ball',output_mode:'gif',size:'1:1'}),/exact pixels/);
  assert.throws(()=>api.buildImage({model,prompt:'ball',output_mode:'gif',size:'1024x1024',frame_count:16}),/contact sheet/);
  assert.throws(()=>api.buildImage({model,prompt:'ball',output_mode:'gif',frame_duration_ms:25}),/multiple/);
  const svg=api.buildImage({model,prompt:'ball',output_mode:'svg'}).payload;
  assert.deepEqual(svg.svg,{model:'gpt-5.4-mini'});assert.equal(svg.n,1);assert.equal(svg.output_format,'svg');
  const edit=api.buildImage({model,prompt:'ball',images:['a','a'],n:4,output_format:'webp',output_compression:0,complexity:'low'});
  assert.deepEqual(edit.sources,['a','a']);assert.equal(edit.payload.output_compression,0);
 }
});
test('Krea native fields, exact area and Z-image safe-integer seed',()=>{
 const p=api.buildImage({model:'krea-v3-i2i',prompt:'edit',images:['a'],size:'256*256',seed:0,model_variant:'jam',reasoning_level:'medium'}).payload;
 assert.deepEqual(p.metadata,{model_variant:'jam',reasoning_level:'medium'});assert.equal(p.seed,0);assert.equal('n' in p,false);
 assert.throws(()=>api.buildImage({...p,size:'4096*4096',images:['a']}),/4220000/);
 assert.throws(()=>api.buildImage({model:'krea-v3-t2i',prompt:'a',images:['a']}),/T2I/);
 const z=api.buildImage({model:'z-image-t2i',prompt:'a',seed:Number.MAX_SAFE_INTEGER}).payload;
 assert.equal(z.metadata.seed,Number.MAX_SAFE_INTEGER);assert.deepEqual(Object.keys(z).sort(),['metadata','model','prompt']);
 assert.equal(api.buildImage({model:'z-image-t2i',prompt:'a',metadata:{ratio:'9:16',seed:0}}).payload.metadata.seed,0);
});
test('Hitem and Meshy use their own fields and explicit optional booleans',()=>{
 for(const model of api.contract.hitem.models){const p=api.build3d({model,images:model.includes('multi')?['front','back']:['front'],face:100000}).payload;assert.equal(p.face,100000);assert.equal('prompt' in p,false);assert.equal('face_count' in p,false);if(model.includes('portrait'))assert.equal(p.resolution,'1536pro');}
 assert.throws(()=>api.build3d({model:api.contract.hitem.models[1],images:['front']}),/2–4/);
 const m=api.build3d({model:api.contract.meshy.models[0],images:['a'],should_texture:false,should_remesh:true,target_polycount:100}).payload;
 assert.equal(m.should_texture,false);assert.equal(m.should_remesh,true);assert.equal('enable_pbr' in m,false);
});
test('Restored Meshy text validates prompt and rejects references before any request',()=>{
 const model=api.contract.meshy.textModel;
 const minimal=api.build3d({model,prompt:'  A ceramic teapot  '});
 assert.deepEqual(minimal.payload,{model,prompt:'A ceramic teapot'});assert.deepEqual(minimal.sources,[]);assert.equal(minimal.taskType,'t3d');
 const full=api.build3d({model,prompt:'A robot',art_style:'sculpture',enable_prompt_expansion:false,should_texture:false,enable_pbr:false,should_remesh:true,target_polycount:100,topology:'quad',symmetry_mode:'off'}).payload;
 assert.equal(full.art_style,'sculpture');assert.equal(full.enable_prompt_expansion,false);assert.equal(full.enable_pbr,false);assert.equal('should_texture' in full,false);assert.equal('images' in full,false);
 for(const prompt of ['', '   ', 'a'.repeat(601)])assert.throws(()=>api.build3d({model,prompt}),/1–600/);
 assert.equal([...api.build3d({model,prompt:'🤖'.repeat(600)}).payload.prompt].length,600);
 assert.throws(()=>api.build3d({model,prompt:'teapot',images:['image']}),/does not accept/);
 assert.throws(()=>api.build3d({model,prompt:'teapot',art_style:'anime'}),/art_style/);
 assert.throws(()=>api.build3d({model,prompt:'teapot',enable_prompt_expansion:'false'}),/boolean/);
});
