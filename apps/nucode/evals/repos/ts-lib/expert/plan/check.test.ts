import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plan} from './plan.ts';
import {validate} from './validate.ts';
import {type Job} from './model.ts';
test('waves use previous completions and stable input order',()=>{
  const jobs=[{id:'ship',needs:['build','test']},{id:'test',needs:['build','build']},{id:'docs',needs:[]},{id:'build',needs:['fetch']},{id:'fetch',needs:[]}];
  const copy=structuredClone(jobs);
  assert.deepEqual(plan(jobs),[['docs','fetch'],['build'],['test'],['ship']]);
  assert.deepEqual(jobs,copy);
  assert.deepEqual(plan([{id:'a',needs:[]},{id:'b',needs:['a']}]),[['a'],['b']]);
});
test('completed nodes and external prerequisites',()=>{
  const jobs=[{id:'a',needs:['b']},{id:'b',needs:['a','external']},{id:'c',needs:[]}];
  const done=Object.freeze(['a','external']) as unknown as string[];
  assert.deepEqual(plan(jobs,done),[['b','c']]);
  assert.deepEqual(plan([],done),[]);
  assert.deepEqual(plan([{id:'a',needs:['a']}],['a']),[]);
  assert.deepEqual([...validate(jobs,new Set(done))],['a','b','c']);
});
test('invalid graph is rejected, including skipped nodes',()=>{
  const invalid:Job[][]=[
    [{id:'a',needs:[]},{id:'a',needs:[]}],
    [{id:'a',needs:['missing']}],
  ];
  for(const jobs of invalid) for(const done of [[],['a']]) {
    assert.throws(()=>validate(jobs,new Set(done)),Error);
    assert.throws(()=>plan(jobs,done),Error);
  }
  for(const jobs of [[{id:'a',needs:['a']}],[{id:'a',needs:['b']},{id:'b',needs:['a']},{id:'ready',needs:[]}]]) assert.throws(()=>plan(jobs),/cycle/);
  const frozen=Object.freeze([{id:'__proto__',needs:Object.freeze([])}]) as unknown as Job[];
  assert.deepEqual(plan(frozen),[['__proto__']]);
});
