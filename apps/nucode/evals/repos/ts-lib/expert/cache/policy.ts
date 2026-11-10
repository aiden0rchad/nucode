export type Value = {labels:string[]} | null;
export function validateTTL(ttl:number) {
  if(!Number.isFinite(ttl)||ttl<0) throw new RangeError('ttl');
}
export const identity = (id:string,locale:string) => JSON.stringify([id,locale]);
