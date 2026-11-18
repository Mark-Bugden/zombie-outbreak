// The SZR (humans, zombies, removed) model on the population grid. This is a port of the reference
// implementation, src/zombie_outbreak/model.py, which documents the model. The two do the same
// operations in the same order, and test/szr.test.js checks this one against fixtures written by
// that one. Change them together.
//
// Each step: encounters and rising, cell by cell; zombies wander, and are exported across the
// border; humans flee down the zombie share; zombies below `epsilon` are cleared.
//
// For speed, a step visits only the cells that can change: Czech cells, and the foreign cells just
// across the border (the rim) that zombies can cross into. It also skips work that would only add
// zeros. The results are the same as visiting every cell.

import { NEIGHBOUR_BASE } from '../grid.js';

// Bits of `blocks`, per cell: its east edge, and its south edge, is blocked by a cordon.
export const BLOCK_EAST = 1;
export const BLOCK_SOUTH = 2;
// The largest D dt / dx² a step allows, as in model.py.
export const MAX_DIFFUSION_STEP = 0.2;

// Bits of the edge table, per cell: zombies, and humans, can cross its east or south edge.
const ZOMBIE_EAST = 1;
const ZOMBIE_SOUTH = 2;
const HUMAN_EAST = 4;
const HUMAN_SOUTH = 8;
// The cell has a neighbour to its west, and to its north, inside the grid.
const HAS_WEST = 16;
const HAS_NORTH = 32;

/** Throws unless every rate is non-negative and a step with these parameters is stable. */
export function checkParams(params) {
  for (const name of ['beta', 'alpha', 'zeta', 'diffusion', 'flee', 'threshold', 'epsilon']) {
    if (!(params[name] >= 0)) throw new RangeError(`szr: ${name} must be non-negative, got ${params[name]}`);
  }
  if (!(params.dt > 0)) throw new RangeError(`szr: dt must be positive, got ${params.dt}`);
  // 0.25 is the stability limit, but at it a checkerboard pattern never decays (see model.py).
  if (params.diffusion * params.dt > MAX_DIFFUSION_STEP) throw new RangeError(`szr: diffusion × dt must be at most ${MAX_DIFFUSION_STEP} for a smooth, stable step, got ${params.diffusion * params.dt}`);
  if (4 * params.flee * params.dt > 1) throw new RangeError(`szr: 4 × flee × dt must be at most 1 for a stable step, got ${4 * params.flee * params.dt}`);
}

/**
 * A simulation on a width × height grid. `labels` gives each cell's region (Czech, below
 * NEIGHBOUR_BASE) or neighbouring country, and `population` its people at the start, all human.
 *
 * Returns { S, Z, R, exported, cleared, day, seed(cell, zombies), setBlocks(blocks), step(params), total() }.
 * - S, Z and R are Float64Arrays, updated in place.
 * - exported maps a neighbour's label to the zombies that crossed into it.
 * - setBlocks() takes the cordons, as a Uint8Array of BLOCK_* bits per cell (or null for none);
 *   call it whenever they change.
 */
export function createSim({ width, height, labels, population }) {
  const n = width * height;
  const S = Float64Array.from(population);
  const Z = new Float64Array(n);
  const R = new Float64Array(n);
  // Scratch, reused every step: flows across each cell's east and south edges, and zombie shares.
  const east = new Float64Array(n);
  const south = new Float64Array(n);
  const share = new Float64Array(n);
  const exported = new Map();
  const sim = { S, Z, R, exported, cleared: 0, day: 0 };

  const inside = Uint8Array.from(labels, (label) => (label < NEIGHBOUR_BASE ? 1 : 0));
  const touchesInside = (row, col) => [[row, col - 1], [row, col + 1], [row - 1, col], [row + 1, col]]
    .some(([r, c]) => r >= 0 && r < height && c >= 0 && c < width && inside[r * width + c]);
  const czech = [];
  const rim = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      if (inside[i]) czech.push(i);
      else if (touchesInside(row, col)) rim.push(i);
    }
  }
  // Every cell a step visits, in grid order: Czech cells and the rim.
  const active = Int32Array.from([...czech, ...rim].sort((a, b) => a - b));
  const czechCells = Int32Array.from(czech);
  const rimCells = Int32Array.from(rim);
  const edges = new Uint8Array(n);

  sim.setBlocks = (blocks) => {
    for (let k = 0; k < active.length; k++) {
      const i = active[k];
      const col = i % width;
      const row = (i - col) / width;
      let bits = (col > 0 ? HAS_WEST : 0) | (row > 0 ? HAS_NORTH : 0);
      if (col < width - 1 && !(blocks && blocks[i] & BLOCK_EAST)) {
        if (inside[i] || inside[i + 1]) bits |= ZOMBIE_EAST;
        if (inside[i] && inside[i + 1]) bits |= HUMAN_EAST;
      }
      if (row < height - 1 && !(blocks && blocks[i] & BLOCK_SOUTH)) {
        if (inside[i] || inside[i + width]) bits |= ZOMBIE_SOUTH;
        if (inside[i] && inside[i + width]) bits |= HUMAN_SOUTH;
      }
      edges[i] = bits;
    }
  };
  sim.setBlocks(null);

  // Applies values_i − east_i + east_(i−1) − south_i + south_(i−w), in that order, as model.py
  // does. Flows across closed edges, and into cells a step never visits, are zero.
  const apply = (values) => {
    for (let k = 0; k < active.length; k++) {
      const i = active[k];
      const bits = edges[i];
      let v = values[i];
      v -= east[i];
      if (bits & HAS_WEST) v += east[i - 1];
      v -= south[i];
      if (bits & HAS_NORTH) v += south[i - width];
      values[i] = v;
    }
  };

  sim.seed = (cell, zombies) => {
    const turned = Math.min(zombies, S[cell]);
    S[cell] -= turned;
    Z[cell] += turned;
  };

  sim.total = () => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += S[i] + Z[i] + R[i];
    for (const value of exported.values()) sum += value;
    return sum + sim.cleared;
  };

  sim.step = (params) => {
    checkParams(params);
    const { beta, alpha, threshold, epsilon, dt } = params;

    // 1. Encounters and rising. A cell with no zombies and no dead cannot change.
    const rise = -Math.expm1(-params.zeta * dt);
    for (let k = 0; k < czechCells.length; k++) {
      const i = czechCells[k];
      const z = Z[i];
      const r = R[i];
      if (z === 0 && r === 0) continue;
      const s = S[i];
      const bites = z >= threshold ? s * -Math.expm1(-beta * z * dt) : 0;
      const kills = z * -Math.expm1(-alpha * s * dt);
      const rises = r * rise;
      S[i] = s - bites;
      Z[i] = z + (bites - kills + rises);
      R[i] = r + (kills - rises);
    }

    // 2. Zombies wander, and those that cross the border are exported.
    const rate = params.diffusion * dt;
    for (let k = 0; k < active.length; k++) {
      const i = active[k];
      const bits = edges[i];
      east[i] = bits & ZOMBIE_EAST ? rate * (Z[i] - Z[i + 1]) : 0;
      south[i] = bits & ZOMBIE_SOUTH ? rate * (Z[i] - Z[i + width]) : 0;
    }
    apply(Z);
    for (let k = 0; k < rimCells.length; k++) {
      const i = rimCells[k];
      if (Z[i] !== 0) {
        if (Z[i] > 0) exported.set(labels[i], (exported.get(labels[i]) ?? 0) + Z[i]);
        Z[i] = 0;
      }
    }

    // 3. Humans flee down the zombie share, between Czech cells.
    for (let k = 0; k < czechCells.length; k++) {
      const i = czechCells[k];
      const walking = S[i] + Z[i];
      share[i] = walking > 0 ? Z[i] / walking : 0;
    }
    const flight = params.flee * dt;
    for (let k = 0; k < active.length; k++) {
      const i = active[k];
      const bits = edges[i];
      let d;
      east[i] = bits & HUMAN_EAST && (d = share[i] - share[i + 1]) !== 0 ? flight * (d > 0 ? S[i] * d : S[i + 1] * d) : 0;
      south[i] = bits & HUMAN_SOUTH && (d = share[i] - share[i + width]) !== 0 ? flight * (d > 0 ? S[i] * d : S[i + width] * d) : 0;
    }
    apply(S);

    // 4. Clean-up.
    for (let k = 0; k < czechCells.length; k++) {
      const i = czechCells[k];
      if (Z[i] < epsilon) {
        sim.cleared += Z[i];
        Z[i] = 0;
      }
    }
    sim.day += dt;
  };

  return sim;
}
