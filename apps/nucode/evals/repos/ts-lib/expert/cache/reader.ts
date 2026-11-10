import {Cache} from './cache.ts';
import {type Value} from './policy.ts';
export class Reader {
  cache=new Cache();
  load:(id:string,locale:string)=>Value;
  clock:()=>number;
  constructor(load:(id:string,locale:string)=>Value,clock:()=>number) {this.load=load;this.clock=clock;}
  read(id:string,locale:string,ttl:number):Value {
    const key=id+':'+locale, now=this.clock();
    const hit=this.cache.get(key,now);
    if(hit!==undefined) return hit;
    const value=this.load(id,locale);
    this.cache.set(key,value,now,ttl);
    return value;
  }
  invalidate(id:string) {
    for(const key of this.cache.entries.keys()) if(key.startsWith(id+':')) this.cache.entries.delete(key);
  }
}
