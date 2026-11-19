import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEngine } from '../src/sim/engine.js';
import { createEnclosures } from '../src/sim/enclosures.js';
import { BLOCK_EAST, BLOCK_SOUTH } from '../src/sim/szr.js';
import { strokeEdges } from '../src/tools/cordon.js';

// 14 × 10 cells: Czech (region 1) inside a one-cell rim of a neighbour (21), 100 people a cell.
const width = 14;
const height = 10;
const labels = Uint8Array.from({ length: width * height }, (_, i) => {
  const col = i % width;
  const row = Math.floor(i / width);
  return col === 0 || row === 0 || col === width - 1 || row === height - 1 ? 21 : 1;
});
const grid = { width, height, labels };
const S = Float64Array.from(labels, (label) => (label === 1 ? 100 : 0));
const cell = (col, row) => row * width + col;

const blocksOf = (edges) => {
  const blocks = new Uint8Array(width * height);
  for (const edge of edges) blocks[edge >> 1] |= edge & 1 ? BLOCK_SOUTH : BLOCK_EAST;
  return blocks;
};

/** Builds `edges` one at a time, as the crew does, and returns the total sealed in after each. */
function build(enclosures, earlier, edges, Z) {
  const totals = [];
  for (let k = 1; k <= edges.length; k++) {
    const built = [...earlier, ...edges.slice(0, k)];
    enclosures.update(built, blocksOf(built), S, Z, 1);
    totals.push(enclosures.total);
  }
  return totals;
}

const square = (x1, y1, x2, y2) => strokeEdges([[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]], grid);

test('counts the humans walled in with zombies, once, when the ring closes', () => {
  const enclosures = createEnclosures(grid);
  const Z = new Float64Array(width * height);
  Z[cell(5, 5)] = 5;
  const ring = square(3, 3, 7, 7); // 4 × 4 cells
  const totals = build(enclosures, [], ring, Z);
  assert.ok(totals.slice(0, -1).every((total) => total === 0), 'nothing until it closes');
  assert.equal(totals.at(-1), 16 * 100);

  // A second ring inside the first adds nothing: those people are already counted.
  const inner = square(4, 4, 6, 6);
  assert.equal(build(enclosures, ring, inner, Z).at(-1), 1600);
});

test('ignores rings with no zombies that can bite, and the largest part of the country', () => {
  const enclosures = createEnclosures(grid);
  const Z = new Float64Array(width * height);
  Z[cell(5, 5)] = 0.5; // below the threshold
  Z[cell(11, 7)] = 5; // outside the ring, in the largest part
  assert.equal(build(enclosures, [], square(3, 3, 7, 7), Z).at(-1), 0);
});

test('a line across the country seals in the smaller side, if it holds zombies', () => {
  // From the top rim to the bottom rim at x = 4: columns 1–3 (24 cells) against columns 4–12 (72).
  const line = strokeEdges([[4, 0], [4, height]], grid);
  const small = new Float64Array(width * height);
  small[cell(2, 4)] = 5;
  assert.equal(build(createEnclosures(grid), [], line, small).at(-1), 24 * 100);
  const large = new Float64Array(width * height);
  large[cell(9, 4)] = 5;
  assert.equal(build(createEnclosures(grid), [], line, large).at(-1), 0);
});

test('keeps its count when a cordon is taken away, and counts nobody twice when it is rebuilt', () => {
  const enclosures = createEnclosures(grid);
  const Z = new Float64Array(width * height);
  Z[cell(5, 5)] = 5;
  const ring = square(3, 3, 7, 7);
  build(enclosures, [], ring, Z);
  enclosures.update([], blocksOf([]), S, Z, 1); // Undo
  assert.equal(enclosures.total, 1600);
  build(enclosures, [], ring, Z);
  assert.equal(enclosures.total, 1600);
  enclosures.reset();
  assert.equal(enclosures.total, 0);
});

test('frames report the sealed in and the exports, and trace() samples a run without painting', () => {
  const population = Uint16Array.from(S);
  const engine = createEngine({ lastDay: 30, detectionDay: 0, buildSpeed: 1000 });
  engine.init({ width, height, labels, population });
  const params = { beta: 0.01, alpha: 0.001, zeta: 0, diffusion: 0, flee: 0, threshold: 1, epsilon: 1e-3, dt: 0.1 };
  engine.reset({ cell: cell(5, 5), zombies: 10, params });
  engine.addItem({ edges: square(3, 3, 7, 7) });
  engine.advance(0.1);
  const { samples, ended } = engine.trace(2, 0.5);
  assert.deepEqual(samples.map((s) => Math.round(s.day * 10) / 10), [0.6, 1.1, 1.6, 2.1]);
  assert.equal(ended, false);
  assert.ok(samples.every((s) => 'humans' in s.totals));
  assert.equal(engine.setParams(params), samples.at(-1).day);

  engine.setColours({ night: '#000000', land: '#111111', people: '#ffaa00', peoplePeak: '#ffffff', zombie: '#cc3311', frontPeak: '#ffffff', dead: '#999999' });
  const frame = engine.frame();
  assert.ok(frame.sealedIn > 1500 && frame.sealedIn <= 1600, `walled in when the ring closed: ${frame.sealedIn}`);
  assert.deepEqual(frame.exports, []);
});
