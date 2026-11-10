export type Job = {id:string;needs:string[]};
export const dependencies = (job:Job) => new Set(job.needs);
