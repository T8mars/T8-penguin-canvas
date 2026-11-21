'use strict';
const contract=require('../shared/nov21ModelsContract.json').miora;
const FORMATS=new Set(['glb','obj','zip','mtl','png','jpg','jpeg','webp']);
function parseFiles(record){
  const content=record?.data?.content||{},values=content.file_urls?.length?content.file_urls:[content.file_url||record.result_url];
  if(!Array.isArray(values)||!values.length)throw new Error('Miora returned no files');
  const files=[...new Set(values)].map((url,index)=>{const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('Invalid Miora output URL');const type=u.pathname.split('.').pop().toLowerCase();if(!FORMATS.has(type))throw new Error('Unsupported Miora output format');return {name:'file'+(index+1),type,url};});
  const primary=files.find(f=>f.type==='glb')||files.find(f=>f.type==='obj');if(!primary)throw new Error('Miora returned no GLB/OBJ model');
  primary.name='modelUrl';return {files,modelUrl:primary.url,modelUrls:[primary.url]};
}
async function materialize(result,download,taskId){
  const files=[];let primary;
  for(const [index,file]of result.files.entries()){
    const kind=['png','jpg','jpeg','webp'].includes(file.type)?'image':'model3d';
    const saved=await download(file.url,kind,`seedance-nz-miora:${taskId}:${index}`,{miora:true,declaredFormat:file.type});if(!saved.url)return null;
    const item={name:file.name,type:saved.actualFormat||file.type,url:saved.url};files.push(item);if(file.name==='modelUrl')primary=item;
  }
  return primary?{modelUrl:primary.url,modelUrls:[primary.url],urls:[primary.url],files}:null;
}
async function validateArtifact(buffer,format){
  if(format==='mtl'){const text=buffer.toString('utf8');if(!buffer.length||buffer.length>8*1024*1024||!/^\s*newmtl\s+\S+/m.test(text)||/<(?:html|script|!doctype)/i.test(text))throw new Error('Invalid Miora MTL');return {format,partNames:[]};}
  return require('./tripo3d').validateArtifact(buffer,format);
}
module.exports={contract,FORMATS,parseFiles,materialize,validateArtifact};
