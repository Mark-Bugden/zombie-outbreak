import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { NEIGHBOUR_BASE, decodeGrid } from '../src/grid.js';
import { createQueue } from '../src/sim/crew.js';
import { BLOCK_EAST, BLOCK_SOUTH, createSim } from '../src/sim/szr.js';
import { EAST, SOUTH, edgeLine, sealEdges, snapStroke, strokeEdges } from '../src/tools/cordon.js';

const grid = await decodeGrid(JSON.parse(await readFile(new URL('../public/data/czechia.json', import.meta.url), 'utf8')));
const FRENZIED = { beta: 0.015, alpha: 0.003, zeta: 0.001, diffusion: 2.0, flee: 0.5, threshold: 1, epsilon: 1e-3, dt: 0.1 };

/** A width × height grid of Czech cells (region 1). */
const plain = (width, height) => ({ width, height, labels: new Uint8Array(width * height).fill(1) });

const toBlocks = (edges, cells) => {
  const blocks = new Uint8Array(cells);
  for (const edge of edges) blocks[edge >> 1] |= edge & 1 ? BLOCK_SOUTH : BLOCK_EAST;
  return blocks;
};

/** The Czech cells reachable from `start` by 4-neighbour moves across unblocked edges. */
function reachable(start, blocks, { width, height, labels }) {
  const seen = new Uint8Array(width * height);
  const stack = [start];
  seen[start] = 1;
  const visit = (cell) => {
    if (!seen[cell] && labels[cell] < NEIGHBOUR_BASE) {
      seen[cell] = 1;
      stack.push(cell);
    }
  };
  while (stack.length) {
    const i = stack.pop();
    const col = i % width;
    if (col < width - 1 && !(blocks[i] & BLOCK_EAST)) visit(i + 1);
    if (col > 0 && !(blocks[i - 1] & BLOCK_EAST)) visit(i - 1);
    if (i + width < width * height && !(blocks[i] & BLOCK_SOUTH)) visit(i + width);
    if (i >= width && !(blocks[i - width] & BLOCK_SOUTH)) visit(i - width);
  }
  return seen;
}

/** A freehand loop around (cx, cy): a wobbly circle of `points` points, ending near its start. */
function loop(cx, cy, radius, wobble, points, random) {
  return Array.from({ length: points }, (_, k) => {
    const angle = (2 * Math.PI * k) / points;
    const r = radius * (1 + wobble * (random() - 0.5));
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}

function seeded(seed) {
  let state = seed;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('follows grid lines: a straight stroke, and a diagonal one as a joined-up staircase', () => {
  const g = plain(10, 8);
  // Along y = 2 from x = 1 to 4: the south edges of row 1, columns 1–3.
  assert.deepEqual([...strokeEdges([[1.2, 2.1], [3.9, 1.8]], g)], [1, 2, 3].map((col) => (10 + col) * 2 + SOUTH));
  // Down x = 5 from y = 1 to 3: the east edges of column 4, rows 1–2.
  assert.deepEqual([...strokeEdges([[5, 1], [5, 3]], g)], [1, 2].map((row) => (row * 10 + 4) * 2 + EAST));

  const edges = strokeEdges([[1, 1], [7, 5]], g);
  assert.equal(edges.length, 6 + 4, 'a staircase has |dx| + |dy| edges');
  for (let k = 1; k < edges.length; k++) {
    const [a1, b1, a2, b2] = edgeLine(edges[k - 1], 10);
    const [c1, d1, c2, d2] = edgeLine(edges[k], 10);
    const shared = [[a1, b1], [a2, b2]].some(([x, y]) => (x === c1 && y === d1) || (x === c2 && y === d2));
    assert.ok(shared, `edges ${k - 1} and ${k} meet`);
  }
});

test('skips edges between two foreign cells, the grid\'s outer edges, and edges passed twice', () => {
  const g = plain(6, 4);
  g.labels.fill(NEIGHBOUR_BASE, 0, 6); // the top row is foreign
  assert.equal(strokeEdges([[0, 1], [6, 1]], g).length, 6, 'the border between Czechia and the neighbour counts');
  assert.equal(strokeEdges([[3, 0], [3, 1]], g).length, 0, 'between two foreign cells');
  assert.equal(strokeEdges([[0, 0], [6, 0], [6, 4]], g).length, 0, 'along the outside of the grid');
  assert.equal(strokeEdges([[1, 2], [4, 2], [1, 2]], g).length, 3, 'there and back');
});

test('snaps the ends of a stroke: closing a loop, or joining an existing cordon', () => {
  const hook = [[0, 0], [10, 0], [10, 10], [1, 1]];
  assert.deepEqual(snapStroke(hook, 2).at(-1), [0, 0], 'ends near its start: closed');
  assert.equal(snapStroke([[0, 0], [1, 1], [0.5, 0]], 2).length, 3, 'a scribble stays open');
  assert.deepEqual(snapStroke(hook, 1), hook, 'out of reach: unchanged');
  assert.equal(snapStroke([[0, 0], [2, 0], [2, 2], [1, 1]], 2).length, 4, 'not far enough away to be a loop');
  const joined = snapStroke([[20, 0], [30, 0]], 3, [[18, 1], [5, 5], [31, 2]]);
  assert.deepEqual([joined[0], joined.at(-1)], [[18, 1], [31, 2]]);
});

test('a closed freehand loop is watertight', () => {
  const g = plain(120, 120);
  const random = seeded(7);
  for (let trial = 0; trial < 40; trial++) {
    const radius = 5 + 40 * random();
    const points = loop(60 + 5 * random(), 60 + 5 * random(), radius, 0.5, 12 + Math.floor(60 * random()), random);
    const blocks = toBlocks(strokeEdges(snapStroke(points, 0.8 * radius), g), 120 * 120);
    const inside = reachable(60 * 120 + 60, blocks, g);
    assert.equal(inside[0], 0, `trial ${trial}: the loop leaks`);
  }
});

test('a seal encloses exactly its region, leaving the national border open', () => {
  for (const name of ['Prague', 'Ostrava', 'Brno']) {
    const city = grid.cities.find((c) => c.name === name);
    const [col, row] = city.cell;
    const id = grid.regions.findIndex((r) => r.code === city.region) + 1;
    const edges = sealEdges(id, grid);
    assert.equal(new Set(edges).size, edges.length, 'no edge twice');
    const inside = reachable(row * grid.width + col, toBlocks(edges, grid.labels.length), grid);
    for (let i = 0; i < grid.labels.length; i++) assert.equal(inside[i] === 1, grid.labels[i] === id, `${name}: cell ${i}`);
    for (const edge of edges) {
      const cell = edge >> 1;
      const other = edge & 1 ? cell + grid.width : cell + 1;
      assert.ok(grid.labels[cell] < NEIGHBOUR_BASE && grid.labels[other] < NEIGHBOUR_BASE, 'only borders between regions');
    }
  }
  const prague = grid.regions.findIndex((r) => r.code === 'CZ-PR') + 1;
  assert.equal(sealEdges(prague, grid).length, 126);
});

test('zombies never cross a closed cordon, on the real map', () => {
  const [col, row] = grid.cities.find((c) => c.name === 'Prague').cell;
  const start = row * grid.width + col;
  const ring = strokeEdges(snapStroke(loop(col + 0.5, row + 0.5, 25, 0.5, 40, seeded(3)), 20), grid);
  const blocks = toBlocks(ring, grid.labels.length);
  const inside = reachable(start, blocks, grid);

  const sim = createSim(grid);
  sim.setBlocks(blocks);
  sim.seed(start, 1000);
  for (let s = 0; s < 600; s++) sim.step(FRENZIED);
  let insideZombies = 0;
  for (let i = 0; i < grid.labels.length; i++) {
    if (inside[i]) {
      insideZombies += sim.Z[i] + sim.R[i];
      continue;
    }
    assert.equal(sim.Z[i], 0, `zombies outside, in cell ${i}`);
    if (grid.labels[i] < NEIGHBOUR_BASE) assert.equal(sim.S[i], grid.population[i], `humans moved outside, in cell ${i}`);
  }
  assert.ok(insideZombies > 1000, 'the outbreak spread inside');
  assert.equal(sim.exported.size, 0);
});

test('the queue builds in order, at no cost for edges already covered', () => {
  const queue = createQueue(100);
  const a = queue.add({ edges: Int32Array.from([1, 2, 3, 4]) });
  const b = queue.add({ edges: Int32Array.from([3, 4, 5, 6, 7]) }); // shares 3 and 4 with a
  assert.equal(a.cost, 4);
  assert.equal(b.cost, 3);
  assert.equal(queue.total, 7);
  assert.deepEqual(queue.built(0), [0, 0]);
  assert.deepEqual(queue.built(2.5), [2, 0]);
  assert.deepEqual(queue.built(4), [4, 2], 'walks along the shared edges for free');
  assert.deepEqual(queue.built(5), [4, 3]);
  assert.deepEqual(queue.built(99), [4, 5]);

  const blocks = new Uint8Array(100);
  queue.fillBlocks(5, blocks);
  assert.deepEqual([...blocks.slice(0, 4)], [BLOCK_SOUTH, BLOCK_EAST | BLOCK_SOUTH, BLOCK_EAST | BLOCK_SOUTH, 0]);

  queue.undo();
  assert.equal(queue.total, 4);
  assert.equal(queue.add({ edges: Int32Array.from([4, 5]) }).cost, 1, 'undo releases the edges');
  queue.clear();
  assert.equal(queue.total, 0);
  assert.equal(queue.add({ edges: Int32Array.from([1]) }).cost, 1);
});
