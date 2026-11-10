import {type Entries} from './model.ts';
export class Hub {
  entries:Entries=new Set();
  on(callback:(value:string)=>void,once=false) {
    const entry={callback,once}; this.entries.add(entry);
    return ()=>this.entries.delete(entry);
  }
  emit(value:string) {
    const errors:unknown[]=[];
    for(const entry of [...this.entries]) {
      if(entry.once) this.entries.delete(entry);
      try {entry.callback(value);} catch(error) {errors.push(error);}
    }
    if(errors.length) throw new AggregateError(errors,'delivery failed');
  }
}
