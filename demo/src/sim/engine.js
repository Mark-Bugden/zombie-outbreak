// The simulation engine behind the worker: it owns the model and the build crew, and paints each
// frame. worker.js wires it to messages; on its own it has no DOM or worker dependencies, so the
// tests drive it directly.
//
// Until the detection day the outbreak is hidden: frames are painted as if nobody had been bitten,
// and the crew waits. From then on it builds the queued cordons and seals, and frames show the truth.
//
// The same engine runs the baseline, a run with no quarantine, in a second worker, with trace().

import { NEIGHBOUR_BASE } from '../grid.js';
import { createPainter } from '../render/paint.js';
import { createQueue } from './crew.js';
import { createEnclosures } from './enclosures.js';
import { createSim } from './szr.js';

/**
 * Returns { init, setColours, reset, setParams, addItem, undo, clear, advance, sample, trace, frame,
 * recycle }. A frame is { day, totals: { humans, zombies, dead, exported }, regions, ended, detected,
 * work, sealedIn, exports, pixels }:
 * - regions: the humans, zombies and dead in each region, as a Float64Array of three numbers per
 *   region, in label order (region 1's humans, zombies, dead, then region 2's, ...)
 * - work: the km of cordon the crew has built
 * - sealedIn: the humans walled in with zombies so far (see enclosures.js)
 * - exports: [[neighbour label, zombies], ...], the zombies that crossed into each country
 * - pixels: an ArrayBuffer of width × height RGBA pixels.
 */
export function createEngine({ lastDay, detectionDay, buildSpeed }) {
  let grid = null;
  let painter = null;
  let sim = null;
  let params = null;
  let czech = null;
  let ended = false;
  let queue = null;
  let blocks = null;
  let work = 0; // km built
  let applied = -1; // the whole km of work that `blocks` shows
  let unseen = null; // what the map shows before detection: the starting population, and no zombies
  let enclosures = null;
  let regionCount = 0;
  const spares = [];

  const detected = () => sim.day >= detectionDay - 1e-9;
  const applyBlocks = () => {
    work = Math.min(work, queue.total);
    applied = Math.floor(work + 1e-9);
    queue.fillBlocks(work, blocks);
    sim.setBlocks(blocks);
    enclosures.update(queue.builtEdges(work), blocks, sim.S, sim.Z, params.threshold);
  };

  const totals = () => {
    let humans = 0;
    let zombies = 0;
    let dead = 0;
    for (let k = 0; k < czech.length; k++) {
      const i = czech[k];
      humans += sim.S[i];
      zombies += sim.Z[i];
      dead += sim.R[i];
    }
    let exported = 0;
    for (const value of sim.exported.values()) exported += value;
    return { humans, zombies, dead, exported };
  };

  /** The frame's `regions`. */
  const regionTotals = () => {
    const out = new Float64Array(regionCount * 3);
    for (let k = 0; k < czech.length; k++) {
      const i = czech[k];
      const j = (grid.labels[i] - 1) * 3;
      out[j] += sim.S[i];
      out[j + 1] += sim.Z[i];
      out[j + 2] += sim.R[i];
    }
    return out;
  };

  const engine = {
    /** Takes the grid: { width, height, labels, population }. */
    init({ width, height, labels, population }) {
      grid = { width, height, labels, population };
      painter = createPainter(grid);
      czech = Int32Array.from(labels.reduce((cells, label, i) => (label < NEIGHBOUR_BASE ? (cells.push(i), cells) : cells), []));
      regionCount = czech.reduce((max, i) => Math.max(max, labels[i]), 0);
      queue = createQueue(width * height);
      blocks = new Uint8Array(width * height);
      unseen = { S: Float64Array.from(population), Z: new Float64Array(width * height), R: new Float64Array(width * height) };
      enclosures = createEnclosures(grid);
    },

    /** Takes the map colours as hex strings (see render/paint.js). */
    setColours(colours) {
      painter.setColours(colours);
    },

    /** Starts a new run: `zombies` patients zero in `cell`, with `nextParams`, and nothing queued. */
    reset({ cell, zombies, params: nextParams }) {
      sim = createSim(grid);
      sim.seed(cell, zombies);
      params = nextParams;
      ended = false;
      queue.clear();
      work = 0;
      enclosures.reset();
      applyBlocks();
    },

    /** Changes the parameters from now on, and returns the day they take effect. */
    setParams(nextParams) {
      params = nextParams;
      return sim.day;
    },

    /** Queues a cordon or seal for the crew: { edges, ...info } (see crew.js). */
    addItem(item) {
      queue.add(item);
    },

    /** Takes the newest cordon or seal off the queue, and opens its edges again. */
    undo() {
      queue.undo();
      applyBlocks();
    },

    /** Takes every cordon and seal off the queue. */
    clear() {
      queue.clear();
      applyBlocks();
    },

    /**
     * Runs whole steps for about `days` days, stopping at lastDay or when the zombies are gone.
     * After detection, the crew builds buildSpeed km a day, and each finished km blocks its edge.
     */
    advance(days) {
      const steps = Math.max(0, Math.round(days / params.dt));
      for (let s = 0; s < steps && !ended; s++) {
        const building = detected();
        sim.step(params);
        if (building) {
          work = Math.min(work + buildSpeed * params.dt, queue.total);
          if (Math.floor(work + 1e-9) !== applied) applyBlocks();
        }
        if (sim.day >= lastDay - 1e-9) ended = true;
      }
      if (!ended && totals().zombies === 0) ended = true;
    },

    /** The day and the totals, without painting: { day, totals }. */
    sample() {
      return { day: sim.day, totals: totals() };
    },

    /**
     * Runs like advance() for `days` days, without painting, and samples the totals every `every`
     * days: { samples: [{ day, totals }, ...], ended }. The baseline uses this.
     */
    trace(days, every) {
      const samples = [];
      for (let done = 0; done < days - 1e-9 && !ended; done += every) {
        engine.advance(Math.min(every, days - done));
        samples.push({ day: sim.day, totals: totals() });
      }
      return { samples, ended };
    },

    /** The current frame, painted into a recycled buffer when there is one. */
    frame() {
      const pixels = spares.pop() ?? new ArrayBuffer(grid.width * grid.height * 4);
      const seen = detected() ? sim : unseen;
      painter.paint(new Uint32Array(pixels), seen.S, seen.Z, seen.R, params.beta);
      return {
        day: sim.day,
        totals: totals(),
        regions: regionTotals(),
        ended,
        detected: detected(),
        work,
        sealedIn: enclosures.total,
        exports: [...sim.exported],
        pixels,
      };
    },

    /** Gives back a frame's buffer for reuse. */
    recycle(buffer) {
      if (buffer?.byteLength === grid.width * grid.height * 4) spares.push(buffer);
    },
  };
  return engine;
}
