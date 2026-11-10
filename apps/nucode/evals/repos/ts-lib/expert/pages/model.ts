export type Row = {id:string;score:number;label:string};
export type Cursor = Pick<Row,'id'|'score'>;
export function validateLimit(limit:number) {
  if(!Number.isInteger(limit)||limit<1) throw new RangeError('limit');
}
