export type Entry = {callback:(value:string)=>void;once:boolean};
export type Entries = Set<Entry>;
