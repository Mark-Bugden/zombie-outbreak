import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHistory, nearest } from '../src/render/chart.js';
import { parseHex } from '../src/render/colour.js';
import { createPainter } from '../src/render/paint.js';
import { createEngine } from '../src/sim/engine.js';

const DARK = { night: '#0a0e14', land: '#111722', people: '#f6be55', peoplePeak: '#e8ecf2', zombie: '#c13c36', frontPeak: '#e8ecf2', dead: '#9aa6b8' };
const LIGHT = { night: '#f5f6f8', land: '#ffffff', people: '#2456d3', peoplePeak: '#0d2766', zombie: '#5ca24c', frontPeak: '#2d5923', dead: '#2f3642' };
const PARAMS = { beta: 0.01, alpha: 0.004, zeta: 0.05, diffusion: 1, flee: 1, threshold: 1, epsilon: 1e-3, dt: 0.1 };

// 6 × 4 cells: a neighbour (21) down the left side, Czech cells elsewhere, 100 people each.
const width = 6;
const height = 4;
const labels = Uint8Array.from({ length: width * height }, (_, i) => (i % width === 0 ? 21 : 1));
const population = Uint16Array.from(labels, (label) => (label === 1 ? 100 : 0));
const rgb = (pixel) => [pixel & 255, (pixel >> 8) & 255, (pixel >> 16) & 255];

test('paints neighbours as night, empty land as land, people as light, and zombies redder', () => {
  // One crowded cell sets the scale, as a city does on the real map, so 100 people sit mid-ramp.
  const crowded = Uint16Array.from(population);
  crowded[5] = 5000;
  const painter = createPainter({ labels, population: crowded });
  painter.setColours(DARK);
  const out = new Uint32Array(width * height);
  const S = Float64Array.from(crowded);
  const Z = new Float64Array(width * height);
  S[1] = 0; // an empty Czech cell
  Z[2] = 5; // a few zombies among 100 people
  painter.paint(out, S, Z, new Float64Array(width * height), 0.001);
  assert.deepEqual(rgb(out[0]), parseHex(DARK.night));
  assert.deepEqual(rgb(out[1]), parseHex(DARK.land));
  const [r, g, b] = rgb(out[3]);
  assert.ok(r > g && g > b && r > 100, 'people glow amber');
  const [zr, zg] = rgb(out[2]);
  assert.ok(zr - zg > r - g, 'zombies make a cell redder');
});

test('darkens pale paper in the light theme', () => {
  const painter = createPainter({ labels, population });
  painter.setColours(LIGHT);
  const out = new Uint32Array(width * height);
  painter.paint(out, Float64Array.from(population), new Float64Array(width * height), new Float64Array(width * height), PARAMS.beta);
  const [r, g, b] = rgb(out[3]);
  assert.ok(r < 200 && g < 200 && b < 200, 'people are ink on paper');
});

test('shows the dead in ash, mixed with zombies by their shares', () => {
  const painter = createPainter({ labels, population });
  painter.setColours(DARK);
  const out = new Uint32Array(width * height);
  const S = new Float64Array(width * height);
  const Z = new Float64Array(width * height);
  const R = new Float64Array(width * height);
  R[1] = 100; // only the dead
  Z[2] = 100; // only zombies
  Z[3] = 25; // more dead than zombies
  R[3] = 75;
  painter.paint(out, S, Z, R, 0); // no bites, so no front
  const land = parseHex(DARK.land);
  const [dr, dg, db] = rgb(out[1]);
  assert.ok(dr > land[0] && db > dr, 'the dead glow a cool grey, not dark');
  const [zr, , zb] = rgb(out[2]);
  assert.ok(zr > zb, 'zombies glow red');
  const [mr, , mb] = rgb(out[3]);
  assert.ok(mr < zr && mb > zb && mb < db, 'a mixed cell lies between, nearer the dead');
});

test('runs an outbreak, reports totals, and stops on the last day', () => {
  const engine = createEngine({ lastDay: 2, detectionDay: 0, buildSpeed: 1 });
  engine.init({ width, height, labels, population });
  engine.setColours(DARK);
  engine.reset({ cell: 9, zombies: 10, params: PARAMS });
  const start = engine.frame();
  assert.equal(start.pixels.byteLength, width * height * 4);
  assert.deepEqual(start.totals, { humans: 1990, zombies: 10, dead: 0, exported: 0 });
  assert.equal(start.ended, false);

  engine.recycle(start.pixels);
  engine.advance(1);
  const middle = engine.frame();
  assert.equal(middle.pixels, start.pixels, 'reuses the recycled buffer');
  assert.ok(Math.abs(middle.day - 1) < 1e-9);
  const { humans, zombies, dead, exported } = middle.totals;
  assert.ok(Math.abs(humans + zombies + dead + exported - 2000) < 0.01, 'nobody is lost (beyond clean-up)');
  assert.ok(exported > 0, 'zombies cross into the neighbour');

  engine.advance(10);
  const last = engine.frame();
  assert.equal(last.ended, true);
  assert.ok(Math.abs(last.day - 2) < 1e-9, 'stops on the last day');
  assert.equal(last.regions.length, 3, 'one region: its humans, zombies and dead');
  const sum = [last.totals.humans, last.totals.zombies, last.totals.dead];
  last.regions.forEach((value, k) => assert.ok(Math.abs(value - sum[k]) < 1e-6, 'the region holds all of Czechia'));
});

test('keeps one chart point per half day, and starts again for a new run', () => {
  const history = createHistory();
  const frame = (day) => ({ day, totals: { humans: 100 - day, zombies: day, dead: 0 } });
  // Twenty steps of 0.1 days, added up as the engine does, so the days carry its rounding.
  for (let step = 0, day = 0; step <= 20; step++, day += 0.1) history.push(frame(day));
  assert.deepEqual(history.days.map((d) => Math.round(d * 10) / 10), [0, 0.5, 1, 1.5, 2]);
  history.push(frame(history.days.at(-1))); // a repaint: the engine reports exactly the same day
  assert.equal(history.days.length, 5);
  history.push(frame(0)); // a new run
  assert.deepEqual(history.days, [0]);
});

test('finds the chart point nearest a day', () => {
  const days = [0, 0.5, 1, 1.5, 2];
  assert.equal(nearest([], 1), -1);
  assert.equal(nearest(days, -3), 0);
  assert.equal(nearest(days, 0.7), 1);
  assert.equal(nearest(days, 0.8), 2);
  assert.equal(nearest(days, 9), 4);
});

test('shows the outbreak from day 0, but builds only from the detection day', () => {
  const engine = createEngine({ lastDay: 10, detectionDay: 2, buildSpeed: 5 });
  engine.init({ width, height, labels, population });
  engine.setColours(DARK);
  engine.reset({ cell: 9, zombies: 10, params: { ...PARAMS, diffusion: 0, flee: 0 } });
  // A wall down the middle, between columns 2 and 3: four east edges, 4 km.
  const wall = Int32Array.from([0, 1, 2, 3].map((row) => (row * width + 2) * 2));
  engine.addItem({ kind: 'cordon', edges: wall });

  engine.advance(1);
  const early = engine.frame();
  assert.equal(early.detected, false);
  assert.ok(early.totals.zombies > 10, 'the outbreak grows before anyone notices');
  const pixels = new Uint32Array(early.pixels);
  assert.notEqual(pixels[9], pixels[10], 'and the map shows it: the bitten cell differs from its untouched neighbour');
  assert.equal(early.work, 0, 'the crew waits');

  engine.advance(1.5);
  const building = engine.frame();
  assert.equal(building.detected, true);
  assert.ok(Math.abs(building.work - 2.5) < 1e-9, '5 km a day for half a day');

  engine.advance(5);
  assert.equal(engine.frame().work, 4, 'no work is banked once the queue is built');
  engine.undo();
  assert.equal(engine.frame().work, 0);
});
