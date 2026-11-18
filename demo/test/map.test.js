import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pack, parseHex, ramp, rampIndex } from '../src/render/colour.js';
import { borderSegments, fit } from '../src/render/map.js';

test('parses hex colours', () => {
  assert.deepEqual(parseHex('#f6be55'), [246, 190, 85]);
  assert.deepEqual(parseHex(' #FFF '), [255, 255, 255]);
  assert.throws(() => parseHex('rgb(0, 0, 0)'), /hex/);
});

test('packs pixels as little-endian RGBA', () => {
  const pixel = new Uint8ClampedArray(new Uint32Array([pack([1, 2, 3])]).buffer);
  assert.deepEqual([...pixel], [1, 2, 3, 255]);
});

test('ramps from the first stop to the last through the middle ones', () => {
  const table = ramp([[0, '#000000'], [0.5, '#ff0000'], [1, '#ffffff']]);
  const rgb = (i) => [...table.slice(i * 3, i * 3 + 3)];
  assert.deepEqual(rgb(0), [0, 0, 0]);
  assert.deepEqual(rgb(255), [255, 255, 255]);
  // t = 128/255 is just past the middle stop: 255 × (128/255 − 0.5) / 0.5 = 1.
  assert.deepEqual(rgb(128), [255, 1, 1]);
  assert.equal(rampIndex(-1), 0);
  assert.equal(rampIndex(2), 255);
});

test('traces region and national borders along cell edges, merging runs', () => {
  // 4 × 3 cells: regions 1 and 2 side by side, a neighbour (21) along the right.
  // 1 1 2 21
  // 1 1 2 21
  // 1 2 2 21
  const labels = Uint8Array.from([1, 1, 2, 21, 1, 1, 2, 21, 1, 2, 2, 21]);
  const { region, nation } = borderSegments(labels, 4, 3);
  assert.deepEqual(region, [
    [1, 2, 1, 3], // between (2, 0) and (2, 1)
    [2, 0, 2, 2], // between columns 1 and 2, rows 0–1, merged
    [1, 2, 2, 2], // between (1, 1) and (2, 1)
  ]);
  assert.deepEqual(nation, [[3, 0, 3, 3]]);
});

test('fits the grid inside the stage, centred', () => {
  assert.deepEqual(fit(100, 50, 224, 224, 12), { scale: 2, x: 12, y: 62 });
  assert.equal(fit(100, 50, 10, 10, 12).scale, 0);
});
