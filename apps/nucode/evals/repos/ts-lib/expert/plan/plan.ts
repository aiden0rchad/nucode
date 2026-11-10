import {type Job} from './model.ts';
import {validate} from './validate.ts';
export function plan(jobs:Job[],completed:string[]=[]):string[][] {
  validate(jobs,new Set(completed));
  return jobs.map(job=>[job.id]);
}
