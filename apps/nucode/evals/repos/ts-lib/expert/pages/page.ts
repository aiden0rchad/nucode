import {type Row,type Cursor,validateLimit} from './model.ts';
import {ordered} from './order.ts';
export function page(rows:Row[],limit:number,after:Cursor|null=null):{items:Row[];next:Cursor|null} {
  validateLimit(limit);
  const all=ordered(rows).filter(row=>!after||row.score<after.score);
  const items=all.slice(0,limit), last=items.at(-1);
  return {items,next:last?{id:last.id,score:last.score}:null};
}
