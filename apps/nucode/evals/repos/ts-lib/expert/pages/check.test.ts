import {test} from 'node:test';
import assert from 'node:assert/strict';
import {page} from './page.ts';
import {compare,ordered} from './order.ts';
import {type Row,type Cursor} from './model.ts';
const rows:Row[]=[{id:'z',score:8,label:'last'},{id:'b',score:10,label:'second'},{id:'a',score:10,label:'first'},{id:'A',score:8,label:'third'}];
test('stable public ordering without mutation',()=>{
  const input=Object.freeze(rows.map(row=>Object.freeze({...row}))) as unknown as Row[];
  assert.deepEqual(ordered(input).map(r=>r.id),['a','b','A','z']);
  assert.equal(compare(rows[0],rows[0]),0);
  assert.ok(compare(rows[2],rows[1])<0);
  assert.deepEqual(input,rows);
});
test('walk every boundary including an exact final full page',()=>{
  for(const limit of [1,2,3,4,5]) {
    let cursor:Cursor|null=null; const seen:string[]=[];
    for(let n=0;n<6;n++) {
      const result=page([...rows],limit,cursor); seen.push(...result.items.map(r=>r.id));
      if(result.next===null) break;
      assert.ok(result.items.length); cursor=result.next;
      assert.ok(n<5,'pagination must terminate');
    }
    assert.deepEqual(seen,['a','b','A','z']);
  }
  assert.equal(page([...rows],4).next,null);
  assert.deepEqual(page([],2),{items:[],next:null});
});
test('deleted boundary, tie boundary and validation',()=>{
  assert.deepEqual(page([...rows],2,{id:'aa',score:10}).items.map(r=>r.id),['b','A']);
  assert.deepEqual(page([...rows],2,{id:'z',score:8}),{items:[],next:null});
  assert.deepEqual(page([...rows],9,{id:'q',score:9}).items.map(r=>r.id),['A','z']);
  for(const n of [0,-1,1.5,NaN,Infinity]) assert.throws(()=>page([...rows],n),RangeError);
  assert.deepEqual(page(Object.freeze([...rows]) as unknown as Row[],1).next,{id:'a',score:10});
});
