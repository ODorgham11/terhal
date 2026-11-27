import { beforeEach, describe, expect, it } from "vitest";
import { markChanged, runGated } from "../../src/platform/jobs/gate";
import { resetRedis } from "../support/redis";

beforeEach(async () => {
  await resetRedis();
});

const MINUTE = 60_000;
const gate = { job: "test-job", signal: "test" };
const at = (ms: number) => new Date(Date.UTC(2026, 10, 27, 10, 0) + ms);
const run = (next: Date | null = null) => () => Promise.resolve(next);

describe("job gate", () => {
  it("runs the first time, then skips while nothing changed", async () => {
    expect(await runGated(gate, run(), at(0))).toBe(true);
    expect(await runGated(gate, run(), at(MINUTE))).toBe(false);
  });

  it("runs again after a change, until a run starts well after it", async () => {
    await runGated(gate, run(), at(0));
    await markChanged("test", at(MINUTE));
    // Marked while its transaction was open: keep looking until a run surely saw it committed.
    expect(await runGated(gate, run(), at(MINUTE + 5_000))).toBe(true);
    expect(await runGated(gate, run(), at(2 * MINUTE + 1_000))).toBe(true);
    expect(await runGated(gate, run(), at(3 * MINUTE))).toBe(false);
  });

  it("runs when the job said it has work", async () => {
    await runGated(gate, run(at(10 * MINUTE)), at(0));
    expect(await runGated(gate, run(), at(5 * MINUTE))).toBe(false);
    expect(await runGated(gate, run(), at(10 * MINUTE))).toBe(true);
  });

  it("runs on the next whole hour regardless", async () => {
    await runGated(gate, run(), at(0));
    expect(await runGated(gate, run(), at(59 * MINUTE))).toBe(false);
    expect(await runGated(gate, run(), at(60 * MINUTE))).toBe(true);
  });

  it("runs when its keys are gone", async () => {
    await runGated(gate, run(), at(0));
    await resetRedis();
    expect(await runGated(gate, run(), at(MINUTE))).toBe(true);
  });
});
