import type { Job } from "bullmq";
import { runGated } from "../../../platform/jobs/gate";
import { UPLOADS_SIGNAL, nextSweep, sweepVehicleImageUploads } from "./vehicle-images";

// The fleet's background jobs, run by the worker on a schedule and gated like the trips' (platform/jobs/gate.ts).
export const fleetJobs = {
  // Photo uploads that were never confirmed: their files and rows.
  "sweep-uploads": { every: 15 * 60_000 },
} as const;

export const processFleetJob = async (job: Job) => {
  if (!(job.name in fleetJobs)) throw new Error(`Unknown fleet job: ${job.name}`);
  await runGated({ job: job.name, signal: UPLOADS_SIGNAL }, async () => {
    await sweepVehicleImageUploads();
    return nextSweep();
  });
};
