// The simulation engine behind the worker: it owns the model and the build crew, and paints each
// frame. worker.js wires it to messages; on its own it has no DOM or worker dependencies, so the
// tests drive it directly.
//
// Until the detection day the outbreak is hidden: frames are painted as if nobody had been bitten,
// and the crew waits. From then on it builds the queued cordons and seals, and frames show the truth.

import { NEIGHBOUR_BASE } from '../grid.js';
import { createPainter } from '../render/paint.js';
import { createQueue } from './crew.js';
import { createSim } from './szr.js';

/**
 * Returns { init, setColours, reset, setParams, addItem, undo, clear, advance, frame, recycle, probe }.
 * A frame is { day, totals: { humans, zombies, dead, exported }, ended, detected, work, pixels }:
 * `work` is the km of cordon the crew has built, and pixels an ArrayBuffer of width × height RGBA
 * pixels.
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
  const spares = [];

  const detected = () => sim.day >= detectionDay - 1e-9;
  const applyBlocks = () => {
    work = Math.min(work, queue.total);
    applied = Math.floor(work + 1e-9);
    queue.fillBlocks(work, blocks);
    sim.setBlocks(blocks);
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

  const engine = {
    /** Takes the grid: { width, height, labels, population }. */
    init({ width, height, labels, population }) {
      grid = { width, height, labels, population };
      painter = createPainter(grid);
      czech = Int32Array.from(labels.reduce((cells, label, i) => (label < NEIGHBOUR_BASE ? (cells.push(i), cells) : cells), []));
      queue = createQueue(width * height);
      blocks = new Uint8Array(width * height);
      unseen = { S: Float64Array.from(population), Z: new Float64Array(width * height) };
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
      applyBlocks();
    },

    setParams(nextParams) {
      params = nextParams;
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

    /** The current frame, painted into a recycled buffer when there is one. */
    frame() {
      const pixels = spares.pop() ?? new ArrayBuffer(grid.width * grid.height * 4);
      const seen = detected() ? sim : unseen;
      painter.paint(new Uint32Array(pixels), seen.S, seen.Z, params.beta);
      return { day: sim.day, totals: totals(), ended, detected: detected(), work, pixels };
    },

    /** Gives back a frame's buffer for reuse. */
    recycle(buffer) {
      if (buffer?.byteLength === grid.width * grid.height * 4) spares.push(buffer);
    },

    /** One cell's humans, zombies and dead. */
    probe(cell) {
      return { humans: sim.S[cell], zombies: sim.Z[cell], dead: sim.R[cell] };
    },
  };
  return engine;
}
