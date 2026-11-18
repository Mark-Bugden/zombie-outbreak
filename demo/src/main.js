// The demo's entry point. Vite bundles it with the kit, the worker and the CSS into demo.js and demo.css.
//
// The simulation runs in a worker (sim/client.js), which also paints each frame. This thread keeps
// the animation clock: each tick it owes the worker some simulated days (2 per second at 1×), sends
// them when the last frame is back, and draws the newest frame with the borders and the chart on top.

import manifest from 'virtual:manifest';
import { getTheme, mount, select, slider, token } from '@mark-bugden/demo-kit';
import '@mark-bugden/demo-kit/tokens.scoped.css';
import '@mark-bugden/demo-kit/frame.css';
import './demo.css';
import { NEIGHBOUR_BASE, loadGrid } from './grid.js';
import { chartBox, compact, createHistory, drawChart } from './render/chart.js';
import { createMap, readColours } from './render/map.js';
import { createClient } from './sim/client.js';
import { FIXED, LAST_DAY, PATIENTS_ZERO, SLIDERS, STRAINS } from './strains.js';

// Simulated days per second of animation, at 1×.
const DAYS_PER_SECOND = 2;
// The most animation time one request may make up, in seconds. A device too slow to keep up runs
// the outbreak more slowly instead of falling ever further behind.
const MAX_LAG = 0.25;
const CUSTOM = 'custom';
const number = new Intl.NumberFormat('en-GB');

/** A collapsible group of sliders that acts as one control, whose value is { name: value }. */
function group(label, controls) {
  const el = document.createElement('details');
  el.className = 'dk-control zo-group';
  const summary = document.createElement('summary');
  summary.textContent = label;
  el.append(summary, ...Object.values(controls).map((control) => control.el));
  const read = () => Object.fromEntries(Object.entries(controls).map(([name, control]) => [name, control.value]));
  return {
    el,
    get value() { return read(); },
    set value(next) {
      for (const [name, value] of Object.entries(next)) if (name in controls) controls[name].value = value;
    },
    get disabled() { return Object.values(controls).every((control) => control.disabled); },
    set disabled(state) { for (const control of Object.values(controls)) control.disabled = state; },
    onChange(listener) {
      const offs = Object.values(controls).map((control) => control.onChange(() => listener(read())));
      return () => offs.forEach((off) => off());
    },
  };
}

const scenario = select({ label: 'Outbreak starts in', options: ['Prague', 'Brno', 'Ostrava'] });
const strain = select({
  label: 'Strain',
  options: [...STRAINS.map(({ label, key }) => ({ label, value: key })), { label: 'Custom', value: CUSTOM }],
});
const speed = select({ label: 'Speed', options: [{ label: '1×', value: 1 }, { label: '2×', value: 2 }, { label: '4×', value: 4 }] });
const sliders = Object.fromEntries(SLIDERS.map(({ name, ...spec }) => [name, slider({ ...spec, value: STRAINS[0].params[name] })]));
const advanced = group('Advanced', sliders);

let grid = null;
let map = null;
let client = null;
let colours = null; // the map's and the chart's colours for `colourTheme`
let colourTheme = null;
let latest = null; // the newest frame: { day, totals, ended }
let spare = null; // the newest frame's pixel buffer, to hand back to the worker
let busy = false; // a frame request is out
let owed = 0; // simulated days the animation clock has run ahead of the worker
let run = 0; // counts runs, so frames from a run that has been replaced are dropped
let hoverCell = -1;
const history = createHistory();

const params = () => ({ ...advanced.value, ...FIXED });
const takeSpare = () => {
  const buffer = spare;
  spare = null;
  return buffer ?? undefined;
};

const app = mount({
  el: document.querySelector(`[data-demo="${manifest.slug}"]`),
  manifest,
  controls: { scenario, strain, speed, advanced },
  stage: 'canvas',
  animate: true,
  reset: () => startRun(),
  status: 'Loading the population map…',
  render({ stage, width, height, pixelRatio, theme, delta, token: read }) {
    const ctx = stage.getContext('2d');
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (!map || !colours) {
      ctx.fillStyle = read('--color-bg');
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (theme !== colourTheme) applyColours().then(() => client.repaint(takeSpare())).then(show).catch(fail);
    if (delta > 0 && latest && !latest.ended) {
      const rate = DAYS_PER_SECOND * speed.value;
      owed = Math.min(owed + delta * rate, MAX_LAG * rate);
      pump();
    }
    map.draw(ctx, width, height);
    const box = chartBox(width);
    if (box) drawChart(ctx, box, history, { total: grid.total, lastDay: LAST_DAY, colours: colours.chart, font: colours.font, latest: latest?.totals });
  },
});
app.stage.setAttribute('aria-label', 'Map of Czechia at 1 km resolution: where people live, and where the zombie outbreak has spread.');

function applyColours() {
  colourTheme = getTheme();
  const read = (name) => token(app.stage, name);
  const map_ = readColours(read);
  colours = {
    map: map_,
    chart: {
      humans: map_.people,
      zombies: map_.zombie,
      dead: map_.nation,
      panel: read('--color-surface'),
      border: read('--color-border'),
      text: read('--color-text'),
      muted: read('--color-muted'),
    },
    font: read('--font-text'),
  };
  map.setColours(map_);
  return client.setColours(map_);
}

function show(frame) {
  map.setImage(frame.pixels);
  spare = frame.pixels;
  latest = frame;
  history.push(frame);
  if (frame.ended) app.pause();
  refreshStatus();
  app.redraw();
}

function pump() {
  if (busy || !latest || latest.ended || owed < FIXED.dt) return;
  const days = Math.floor(owed / FIXED.dt) * FIXED.dt;
  owed -= days;
  busy = true;
  const current = run;
  client.advance(days, takeSpare()).then((frame) => {
    busy = false;
    if (current !== run) {
      spare = frame.pixels;
      return;
    }
    show(frame);
    pump();
  }).catch(fail);
}

function startRun() {
  if (!client) return;
  const current = ++run;
  owed = 0;
  latest = null;
  history.clear();
  const [col, row] = grid.cities.find((city) => city.name === scenario.value).cell;
  client.reset({ cell: row * grid.width + col, zombies: PATIENTS_ZERO, params: params() }, takeSpare())
    .then((frame) => {
      if (current !== run) {
        spare = frame.pixels;
        return;
      }
      show(frame);
    })
    .catch(fail);
}

function liveStatus() {
  if (!latest) return 'Starting the outbreak…';
  const { day, totals, ended } = latest;
  const counts = `${compact(totals.humans)} humans, ${compact(totals.zombies)} zombies, ${compact(totals.dead)} dead`;
  const crossed = totals.exported >= 1 ? `, and ${compact(totals.exported)} zombies have crossed the border` : '';
  if (ended) {
    const how = totals.zombies === 0 ? 'The outbreak died out' : 'The run ended';
    return `${how} on day ${Math.round(day)}: ${counts}${crossed}. Press Reset to run it again.`;
  }
  return `Day ${Math.floor(day)}: ${counts}${crossed}.`;
}

function describe(cell, { humans, zombies, dead }) {
  const label = grid.labels[cell];
  if (label >= NEIGHBOUR_BASE) return grid.neighbours.find((n) => n.id === label).name;
  const region = grid.regions[label - 1];
  const name = region.code === 'CZ-PR' ? region.nameEn : `${region.nameEn} Region`;
  const count = (value) => number.format(Math.round(value));
  return `${name}: ${count(humans)} humans, ${count(zombies)} zombies and ${count(dead)} dead in this km².`;
}

function refreshStatus() {
  if (hoverCell < 0) {
    app.status(liveStatus());
    return;
  }
  const cell = hoverCell;
  client.probe(cell).then((values) => {
    if (cell === hoverCell) app.status(describe(cell, values));
  }).catch(fail);
}

function fail(error) {
  app.pause();
  app.status('The simulation stopped because of an error.');
  console.error(error);
}

loadGrid()
  .then(async (loaded) => {
    grid = loaded;
    map = createMap(grid);
    client = createClient();
    await client.init(grid);
    await applyColours();
    startRun();

    scenario.onChange(() => startRun());
    strain.onChange((key) => {
      const chosen = STRAINS.find((s) => s.key === key);
      if (!chosen) return;
      advanced.value = chosen.params;
      startRun();
    });
    advanced.onChange(() => {
      strain.value = CUSTOM;
      client.setParams(params()).catch(fail);
    });
    app.stage.addEventListener('pointermove', (event) => {
      const rect = app.stage.getBoundingClientRect();
      hoverCell = map.cellAt(event.clientX - rect.left, event.clientY - rect.top);
      refreshStatus();
    });
    app.stage.addEventListener('pointerleave', () => {
      hoverCell = -1;
      refreshStatus();
    });
  })
  .catch((error) => {
    app.status('The population map could not be loaded.');
    console.error(error);
  });
