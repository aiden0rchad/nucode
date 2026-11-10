import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Cache} from './cache.ts';
import {Reader} from './reader.ts';
import {identity} from './policy.ts';
test('expiry boundary, zero TTL and null hits',()=>{
  let now=10,calls=0;
  const r=new Reader(()=>{calls++;return null;},()=>now);
  assert.equal(r.read('a','en',5),null); now=14; r.read('a','en',5); assert.equal(calls,1);
  now=15; r.read('a','en',5); assert.equal(calls,2);
  r.read('z','en',0); r.read('z','en',0); assert.equal(calls,4);
  r.read('a','en',0); assert.equal(calls,5);
  for(const ttl of [-1,NaN,Infinity]) assert.throws(()=>r.read('a','en',ttl),RangeError);
  assert.equal(calls,5);
});
test('compound identities and exact invalidation',()=>{
  let calls=0;
  const r=new Reader((id,locale)=>({labels:[id,locale,String(++calls)]}),()=>0);
  assert.notEqual(identity('a:b','c'),identity('a','b:c'));
  r.read('a:b','c',20); r.read('a','b:c',20); r.read('a','en',20);
  assert.equal(calls,3); r.invalidate('a');
  assert.equal(r.read('a:b','c',20)?.labels[2],'1');
  r.read('a','en',20); r.read('a','b:c',20); assert.equal(calls,5);
});
test('direct cache and reader isolate nested values in both directions',()=>{
  const source={labels:['original']}, c=new Cache();
  c.set('k',source,0,2); source.labels.push('changed');
  const first=c.get('k',1)!; assert.deepEqual(first,{labels:['original']});
  first.labels.push('caller'); assert.deepEqual(c.get('k',1),{labels:['original']});
  assert.equal(c.get('k',2),undefined);
  const r=new Reader(()=>source,()=>0), result=r.read('id','en',10)!;
  result.labels.push('client'); source.labels.push('loader');
  assert.deepEqual(r.read('id','en',10),{labels:['original','changed']});
});
