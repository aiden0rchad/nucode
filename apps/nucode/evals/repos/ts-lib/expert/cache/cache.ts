import {type Value,validateTTL} from './policy.ts';
export class Cache {
  entries=new Map<string,{value:Value; expires:number}>();
  get(key:string,now:number):Value|undefined {
    const entry=this.entries.get(key);
    if(!entry||now>entry.expires) return undefined;
    return entry.value;
  }
  set(key:string,value:Value,now:number,ttl:number) {
    validateTTL(ttl);
    this.entries.set(key,{value,expires:now+ttl});
  }
}
