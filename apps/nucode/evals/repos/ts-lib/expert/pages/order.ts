import {type Cursor,type Row} from './model.ts';
export const compare = (a:Cursor,b:Cursor) => b.score-a.score;
export const ordered = (rows:Row[]) => rows.sort(compare);
