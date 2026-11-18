// The simulation engine behind the worker: it owns the model and paints each frame. worker.js wires
// it to messages; on its own it has no DOM or worker dependencies, so the tests drive it directly.

import { NEIGHBOUR_BASE } from '../grid.js';
import { createPainter } from '../render/paint.js';
import { createSim } from './szr.js';

/**
 * Returns { init, setColours, reset, setParams, advance, frame, probe }. A frame is
 * { day, totals: { humans, zombies, dead, exported }, ended, pixels } where pixels is an
 * ArrayBuffer of width × height RGBA pixels.
 */
export function createEngine({ lastDay }) {
  let grid = null;
  let painter = null;
  let sim = null;
  let params = null;
  let czech = null;
  let ended = false;
  const spares = [];

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
    },

    /** Takes the map colours as hex strings (see render/paint.js). */
    setColours(colours) {
      painter.setColours(colours);
    },

    /** Starts a new run: `zombies` patients zero in `cell`, with `nextParams`. */
    reset({ cell, zombies, params: nextParams }) {
      sim = createSim(grid);
      sim.seed(cell, zombies);
      params = nextParams;
      ended = false;
    },

    setParams(nextParams) {
      params = nextParams;
    },

    /** Runs whole steps for about `days` days, stopping at lastDay or when the zombies are gone. */
    advance(days) {
      const steps = Math.max(0, Math.round(days / params.dt));
      for (let s = 0; s < steps && !ended; s++) {
        sim.step(params);
        if (sim.day >= lastDay - 1e-9) ended = true;
      }
      if (!ended && totals().zombies === 0) ended = true;
    },

    /** The current frame, painted into a recycled buffer when there is one. */
    frame() {
      const pixels = spares.pop() ?? new ArrayBuffer(grid.width * grid.height * 4);
      painter.paint(new Uint32Array(pixels), sim.S, sim.Z, params.beta);
      return { day: sim.day, totals: totals(), ended, pixels };
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
