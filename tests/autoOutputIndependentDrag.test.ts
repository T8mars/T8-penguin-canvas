import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { markManualAutoOutputDrag } from '../src/utils/autoOutputDrag.ts';
import { automaticOutputGridPositions } from '../src/utils/autoOutputLayout.ts';

const nodes = () => [
  { id:'split', type:'text-split', position:{x:0,y:0}, data:{}, width:300,height:100 },
  ...Array.from({length:7},(_,i)=>({id:`output-auto-${i}`,type:'output',position:{x:400+(i%3)*350,y:Math.floor(i/3)*390},width:320,height:360,data:{pickIndex:i},selected:false})),
];
function applyProductionGrid(input: any[]) {
  const source=readFileSync(new URL('../src/components/Canvas.tsx',import.meta.url),'utf8');
  const start=source.indexOf('  useEffect(() => {',source.indexOf('// ===== 自动外挂 OutputNode 的网格重排'));
  const end=source.indexOf('  }, [nodes, edges, loaded]);',start);
  assert.ok(start>0&&end>start);
  let result=input;
  const code=transformSync(source.slice(start,end)+'  }, []);',{loader:'ts'}).code;
  new Function('useEffect','nodes','edges','loaded','setNodes','automaticOutputGridPositions',code)(
    (callback:()=>void)=>callback(), input, input.slice(1).map(n=>({id:`e-auto-${n.id}`,source:'split',target:n.id})),true,
    (change:(v:any[])=>any[])=>{result=change(result);},automaticOutputGridPositions,
  );
  return result;
}
test('dragged first output stops anchoring and moving its ungrouped siblings, including old saved userMoved flags',()=>{
  const input=nodes();input[1].position={x:1300,y:550};(input[1].data as any).userMoved=true;
  assert.deepEqual(applyProductionGrid(input),input);
});
test('active drag is never overwritten or used as the automatic layout anchor',()=>{
  const input=nodes();input[1].position={x:1300,y:550};(input[1] as any).dragging=true;
  assert.deepEqual(applyProductionGrid(input),input);
});
test('all manually positioned siblings keep their coordinates while untouched grids still adapt to measured sizes',()=>{
  const input=nodes();input.slice(1).forEach(n=>(n.data as any).userMoved=true);
  assert.deepEqual(applyProductionGrid(input),input);
  const fresh=nodes();fresh[2].width=400;
  const result=applyProductionGrid(fresh);
  assert.equal(result[3].position.x,1180);
  assert.equal(result[1].position.x,400);
});
test('manual drag marks exactly the dragged selection and is reference-stable on subsequent events',()=>{
  const input=nodes();input[2].selected=true;
  const single=markManualAutoOutputDrag(input,'output-auto-0');
  assert.equal(single[1].data.userMoved,true);assert.equal(single[2].data.userMoved,undefined);
  assert.equal(markManualAutoOutputDrag(single,'output-auto-0'),single);
  input[1].selected=true;
  const multi=markManualAutoOutputDrag(input,'output-auto-0');
  assert.equal(multi[2].data.userMoved,true);assert.equal(multi[3].data.userMoved,undefined);
});
