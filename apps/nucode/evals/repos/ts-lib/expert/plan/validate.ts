import {type Job} from './model.ts';
export function validate(jobs:Job[],done:Set<string>) {
  return new Set(jobs.map(job=>job.id));
}
