import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { NEIGHBOUR_BASE, decodeGrid } from '../src/grid.js';
import { checkParams, createSim } from '../src/sim/szr.js';

// Runs of the reference model, src/zombie_outbreak/model.py, written by src/zombie_outbreak/fixtures.py.
const fixtures = JSON.parse(await readFile(new URL('../../tests/fixtures/szr.json', import.meta.url), 'utf8'));
const grid = await decodeGrid(JSON.parse(await readFile(new URL('../public/data/czechia.json', import.meta.url), 'utf8')));

const close = (actual, expected) => Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));

for (const fixture of fixtures.cases) {
  test(`reproduces the reference model: ${fixture.name}`, (t) => {
    const { width, height, params, expected } = fixture;
    const sim = createSim({ width, height, labels: Uint8Array.from(fixture.labels), population: fixture.population });
    for (const [cell, zombies] of fixture.seeds) sim.seed(cell, zombies);
    sim.setBlocks(Uint8Array.from(fixture.blocks));
    for (let s = 0; s < fixture.steps; s++) sim.step(params);

    let worst = 0;
    for (const name of ['S', 'Z', 'R']) {
      sim[name].forEach((value, i) => {
        const want = expected[name][i];
        worst = Math.max(worst, Math.abs(value - want) / Math.max(1, Math.abs(want)));
        assert.ok(close(value, want), `${name}[${i}]: ${value} vs ${want}`);
      });
    }
    assert.deepEqual([...sim.exported.keys()].map(String).sort(), Object.keys(expected.exported).sort());
    for (const [label, value] of sim.exported) assert.ok(close(value, expected.exported[label]), `exported to ${label}`);
    assert.ok(close(sim.cleared, expected.cleared), 'cleared');
    assert.ok(close(sim.day, expected.day), 'day');
    t.diagnostic(`largest relative difference from the reference: ${worst.toExponential(1)}`);
  });
}

test('keeps the books on the full map: nobody lost, nobody negative, nobody outside Czechia', (t) => {
  const sim = createSim(grid);
  for (const { cell: [col, row] } of grid.cities) sim.seed(row * grid.width + col, 100);
  const start = sim.total();
  const params = { beta: 0.001, alpha: 0.0003, zeta: 0.05, diffusion: 2, flee: 0.5, threshold: 1, epsilon: 1e-3, dt: 0.1 };
  const steps = 50;
  const began = performance.now();
  for (let s = 0; s < steps; s++) sim.step(params);
  const perStep = (performance.now() - began) / steps;

  assert.ok(Math.abs(sim.total() - start) <= 1e-9 * start);
  for (let i = 0; i < grid.labels.length; i++) {
    assert.ok(sim.S[i] >= 0 && sim.Z[i] >= 0 && sim.R[i] >= 0, `cell ${i}`);
    if (grid.labels[i] >= NEIGHBOUR_BASE) assert.ok(sim.S[i] === 0 && sim.Z[i] === 0 && sim.R[i] === 0, `outside cell ${i}`);
  }
  t.diagnostic(`${(grid.width * grid.height).toLocaleString('en-GB')} cells: ${perStep.toFixed(2)} ms per step`);
});

test('refuses unstable or negative parameters', () => {
  const ok = { beta: 0, alpha: 0, zeta: 0, diffusion: 2, flee: 2, threshold: 1, epsilon: 1e-3, dt: 0.1 };
  assert.doesNotThrow(() => checkParams(ok));
  assert.throws(() => checkParams({ ...ok, diffusion: 3 }), /diffusion/);
  assert.throws(() => checkParams({ ...ok, diffusion: 2.5 }), /diffusion/); // the checkerboard never decays at 0.25
  assert.throws(() => checkParams({ ...ok, flee: 3 }), /flee/);
  assert.throws(() => checkParams({ ...ok, beta: -1 }), /beta/);
});
