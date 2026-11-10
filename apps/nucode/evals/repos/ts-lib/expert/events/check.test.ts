import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Hub} from './hub.ts';
import {Relay} from './relay.ts';
import {type Entries} from './model.ts';
for(const kind of ['hub','relay']) {
  const make=()=>{const h=new Hub(),r=new Relay();return kind==='hub'?{on:h.on.bind(h),emit:h.emit.bind(h)}:{on:r.subscribe.bind(r),emit:r.send.bind(r)};};
  test(kind+' snapshot, removal and later additions',()=>{
    const e=make(),seen:string[]=[]; let remove=()=>false;
    e.on(v=>{seen.push('a'+v);remove();e.on(x=>seen.push('c'+x));},true);
    remove=e.on(v=>seen.push('b'+v));
    e.emit('1'); e.emit('2'); assert.deepEqual(seen,['a1','b1','c2']);
  });
  test(kind+' recursion, independent subscriptions and errors',()=>{
    const e=make(),seen:string[]=[];
    e.on(v=>{seen.push('once'+v);e.emit('nested');},true);
    e.on(v=>seen.push(v)); e.emit('outer');
    assert.deepEqual(seen,['onceouter','nested','outer']);
    const f=make(),first=new Error('first'),second={reason:'second'};
    const callback=()=>{throw first;}; const off=f.on(callback); f.on(callback); off();
    f.on(()=>{throw second;},true); f.on(v=>seen.push(v));
    assert.throws(()=>f.emit('tail'),error=>error instanceof AggregateError&&error.message==='delivery failed'&&error.errors.length===2&&error.errors[0]===first&&error.errors[1]===second);
    assert.equal(seen.at(-1),'tail');
    assert.throws(()=>f.emit('again'),error=>error instanceof AggregateError&&error.errors.length===1);
  });
}
test('shared dispatcher is reusable and wrappers delegate',async()=>{
  const {dispatch}=await import('./dispatch.ts');
  const entries:Entries=new Set(),seen:string[]=[];
  entries.add({callback:v=>seen.push(v),once:true}); dispatch(entries,'x'); dispatch(entries,'y');
  assert.deepEqual(seen,['x']); assert.equal(entries.size,0);
  for(const [file,method] of [['hub.ts',Hub.prototype.emit],['relay.ts',Relay.prototype.send]] as const) {
    assert.match(readFileSync(new URL(file,import.meta.url),'utf8'),/import.*dispatch.*from ['"]\.\/dispatch\.ts['"]/);
    assert.match(method.toString(),/dispatch\(/);
    assert.doesNotMatch(method.toString(),/for\s*\(|forEach|\.map\(/);
  }
});
