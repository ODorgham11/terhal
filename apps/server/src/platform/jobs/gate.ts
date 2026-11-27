import { logger } from "../logger/logger";
import { signals } from "../redis/connections";

// Lets a scheduled job skip Postgres when nothing it looks at has changed and nothing is due yet. Neon suspends its
// compute after 5 minutes without a query, so a job that queried every few seconds would keep it (and its bill) awake
// around the clock. The job still runs on its schedule; it only checks Redis first.
//
// Three timestamps, in Redis:
// - `signal.<name>.changedAt`: the last time something the job reads changed. Written inside the change's transaction,
//   by markChanged, so before it commits.
// - `job.<name>.ranAt` and `job.<name>.dueAt`: when the job last ran, and the earliest time it said it has work again.
//
// A job is skipped only if it ran since the last change and isn't due. "Since" allows COMMIT_MARGIN: a change marked
// while its transaction was still open may have committed after the job read, so the job runs again until its last run
// started well after the mark. A failed read or a missing key runs the job; a failed mark delays it to the hour at most,
// since every job runs at least once an hour regardless, on the hour, so a quiet database wakes once an hour.

// Longer than any transaction takes to commit.
const COMMIT_MARGIN = 60_000;
const HOUR = 60 * 60_000;

const changedKey = (signal: string) => `signal.${signal}.changedAt`;
const ranKey = (job: string) => `job.${job}.ranAt`;
const dueKey = (job: string) => `job.${job}.dueAt`;

// The next whole hour after `at`, so every gated job's fallback run lands in the same wake.
const nextHour = (at: number) => (Math.floor(at / HOUR) + 1) * HOUR;

// Inside the transaction of a change, before it commits. A failure is logged, not thrown: the change still saves, and
// the jobs pick it up at the latest on the hour.
export const markChanged = async (signal: string, now = new Date()) => {
  try {
    await signals.set(changedKey(signal), String(now.getTime()));
  } catch (error) {
    logger.warn({ err: error, signal }, "couldn't mark a change for the job gate");
  }
};

interface Gate {
  // The job's own name, for its timestamps.
  job: string;
  // The change it watches, written by markChanged.
  signal: string;
}

const shouldSkip = async ({ job, signal }: Gate, now: number) => {
  try {
    const [changedAt, ranAt, dueAt] = (
      await signals.mget(changedKey(signal), ranKey(job), dueKey(job))
    ).map((value) => (value === null ? null : Number(value)));
    if (changedAt == null || ranAt == null || dueAt == null) return false;
    return changedAt < ranAt - COMMIT_MARGIN && now < dueAt;
  } catch (error) {
    logger.warn({ err: error, job }, "couldn't read the job gate, running the job");
    return false;
  }
};

// Runs `run` unless the gate says there's nothing to do. `run` returns the earliest time it will have work again
// without any change, or null if only a change can give it some. Returns whether it ran.
export const runGated = async (gate: Gate, run: () => Promise<Date | null>, now = new Date()) => {
  const startedAt = now.getTime();
  if (await shouldSkip(gate, startedAt)) return false;

  const next = await run();
  const dueAt = Math.min(next?.getTime() ?? Infinity, nextHour(startedAt));
  try {
    await signals
      .multi()
      .set(ranKey(gate.job), String(startedAt))
      .set(dueKey(gate.job), String(dueAt))
      // Nothing marked yet (a fresh Redis): count it as changed long ago, so the next run can skip.
      .set(changedKey(gate.signal), "0", "NX")
      .exec();
  } catch (error) {
    logger.warn({ err: error, job: gate.job }, "couldn't save the job gate");
  }
  return true;
};
