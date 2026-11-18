// The baseline: the same outbreak with no quarantine, so the demo can say how many people the
// quarantine saved. It doesn't depend on anything the visitor draws, so it runs ahead of the
// visible run in a second worker, without painting.
//
// Changes to the Advanced sliders apply to both runs from the same day: the baseline re-runs from
// day 0 with every change on the day the visible run took it. Finished baselines are cached, so a
// Reset with the same settings doesn't run it again.

import { createClient } from './client.js';

// Simulated days per request: short enough that a restart doesn't wait long for the worker.
const CHUNK = 10;

/**
 * Returns { start(run), at(day), trace }. `onUpdate` is called whenever the trace grows. A trace is
 * { days, humans, zombies, dead, ended }: totals every `every` days from day 0.
 */
export function createBaseline({ grid, lastDay, every, onUpdate }) {
  const client = createClient();
  const ready = client.init(grid);
  const cache = new Map();
  let trace = null;
  let generation = 0;

  const empty = () => ({ days: [], humans: [], zombies: [], dead: [], ended: false });
  const append = (target, { day, totals }) => {
    target.days.push(day);
    target.humans.push(totals.humans);
    target.zombies.push(totals.zombies);
    target.dead.push(totals.dead);
  };

  async function run(key, { cell, zombies, schedule }, current) {
    await ready;
    const target = empty();
    append(target, await client.start({ cell, zombies, params: schedule[0].params }));
    let next = 1; // the next change in the schedule
    while (current === generation && !target.ended) {
      const day = target.days.at(-1);
      const change = schedule[next];
      const until = Math.min(change ? change.day : lastDay, day + CHUNK);
      const { samples, ended } = await client.trace(Math.max(0, until - day), every);
      if (current !== generation) return;
      for (const sample of samples) append(target, sample);
      target.ended = ended;
      if (change && target.days.at(-1) >= change.day - 1e-9) {
        await client.setParams(change.params);
        next++;
      }
      trace = target;
      onUpdate();
    }
    if (target.ended) cache.set(key, target);
  }

  return {
    /**
     * Starts the baseline for a run, or reuses a cached one: { cell, zombies, schedule }, where
     * schedule is [{ day, params }, ...], starting on day 0.
     */
    start(job) {
      const current = ++generation;
      const key = JSON.stringify(job);
      trace = cache.get(key) ?? null;
      if (trace) onUpdate();
      else run(key, job, current).catch((error) => console.error(error));
    },

    /** The baseline's totals at `day` (the last sample at or before it), or null if not there yet. */
    at(day) {
      if (!trace) return null;
      const { days } = trace;
      if (days.at(-1) < day - 1e-6 && !trace.ended) return null;
      let k = days.length - 1;
      while (k > 0 && days[k] > day + 1e-6) k--;
      return { humans: trace.humans[k], zombies: trace.zombies[k], dead: trace.dead[k] };
    },

    get trace() {
      return trace;
    },
  };
}
