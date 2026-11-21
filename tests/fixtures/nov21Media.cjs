const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
async function fixtures(scratch){
 const picture=await require('sharp')({create:{width:512,height:512,channels:3,background:'teal'}}).png().toBuffer(),binary=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((n,i)=>binary.writeFloatLE(n,i*4));
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}]},text=JSON.stringify(doc),json=Buffer.from(text+' '.repeat((4-text.length%4)%4)),glb=Buffer.alloc(12+8+json.length+8+binary.length);glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(json.length,12);glb.writeUInt32LE(0x4e4f534a,16);json.copy(glb,20);glb.writeUInt32LE(binary.length,20+json.length);glb.writeUInt32LE(0x004e4942,24+json.length);binary.copy(glb,28+json.length);
 const pcm=Buffer.alloc(48000);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(4000*Math.sin(i*Math.PI*880/24000)),i*2);const wav=require('../../backend/src/utils/pcmAudio').wrapPcm16Wav(pcm,24000,1),videoFile=path.join(scratch,'source.mp4');
 execFileSync(require('../../backend/src/providers/llmMedia').resolveBundledFfmpeg(),['-v','error','-threads','1','-filter_threads','1','-f','lavfi','-i','color=c=teal:s=160x96:r=12:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-threads','1','-c:a','aac','-shortest','-y',videoFile],{windowsHide:true,timeout:60000});
 const zip=new(require('yazl').ZipFile)();zip.addBuffer(glb,'model.glb');zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);const archive=Buffer.concat(chunks),mtl=Buffer.from('newmtl ceramic\nKd 0.1 0.6 0.5\n');
 fs.writeFileSync(path.join(scratch,'view.png'),picture);fs.writeFileSync(path.join(scratch,'tone.wav'),wav);
 return {picture,wav,video:fs.readFileSync(videoFile),glb,archive,mtl};
}
module.exports={fixtures};
