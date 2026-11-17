import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { decodeGrid } from '../src/grid.js';

const json = JSON.parse(await readFile(new URL('../public/data/czechia.json', import.meta.url), 'utf8'));

test('decodes every cell of the population and labels', async () => {
  const grid = await decodeGrid(json);
  assert.ok(grid.population instanceof Uint16Array);
  assert.ok(grid.labels instanceof Uint8Array);
  assert.equal(grid.population.length, grid.width * grid.height);
  assert.equal(grid.labels.length, grid.width * grid.height);
  assert.equal(grid.population.reduce((sum, people) => sum + people, 0), grid.total);
});

test('agrees with the region summaries written by the prep script', async () => {
  const grid = await decodeGrid(json);
  for (const region of grid.regions) {
    let cells = 0;
    let people = 0;
    grid.labels.forEach((label, i) => {
      if (label === region.id) {
        cells += 1;
        people += grid.population[i];
      }
    });
    assert.equal(cells, region.cells, region.code);
    assert.equal(people, region.population, region.code);
  }
});

test('puts each city start in a populated cell of its region', async () => {
  const grid = await decodeGrid(json);
  for (const { name, cell: [col, row], region } of grid.cities) {
    const i = row * grid.width + col;
    assert.equal(grid.regions[grid.labels[i] - 1].code, region, name);
    assert.ok(grid.population[i] > 0, name);
  }
});

test('rejects a field with the wrong number of cells', async () => {
  await assert.rejects(decodeGrid({ ...json, width: json.width + 1 }), /expected/);
});
