// The demo's entry point. Vite bundles it with the kit, the worker and the CSS into demo.js and demo.css.
//
// The simulation runs in a worker (sim/client.js), which also paints each frame. This thread keeps
// the animation clock: each tick it owes the worker some simulated days (2 per second at 1×), sends
// them when the last frame is back, and draws the newest frame with the borders and the quarantine
// on top, and the chart above the map.
//
// The quarantine: blockades drawn on the map and sealed regions join one build queue (sim/crew.js).
// In the code they are cordons. This thread keeps a copy of the queue to draw it; the worker's copy
// blocks each edge once it is built. Until the detection day the outbreak is hidden on the map, in
// the status line and in the hover readout, here as in the worker; the chart shows the truth all along.
//
// The baseline, the same outbreak with no quarantine, runs ahead in a second worker
// (sim/baseline.js), for the chart's faint line and the end summary's "saved".

import manifest from 'virtual:manifest';
import { getTheme, mount, select, slider, toggle, token } from '@mark-bugden/demo-kit';
import '@mark-bugden/demo-kit/tokens.scoped.css';
import '@mark-bugden/demo-kit/frame.css';
import './demo.css';
import { actions, chooser, group } from './controls.js';
import { NEIGHBOUR_BASE, loadGrid } from './grid.js';
import { SAMPLE_DAYS, compact, createHistory, drawChart } from './render/chart.js';
import { drawCordons } from './render/cordons.js';
import { borderSegments, createMap, readColours } from './render/map.js';
import { createBaseline } from './sim/baseline.js';
import { createClient } from './sim/client.js';
import { createQueue } from './sim/crew.js';
import { DETECTION_DAY, FIXED, LAST_DAY, PATIENTS_ZERO, SLIDERS, STRAINS } from './strains.js';
import { createSummary } from './summary.js';
import { edgeLine, sealEdges, snapStroke, strokeEdges } from './tools/cordon.js';

// Simulated days per second of animation, at 1×.
const DAYS_PER_SECOND = 2;
// The most animation time one request may make up, in seconds. A device too slow to keep up runs
// the outbreak more slowly instead of falling ever further behind.
const MAX_LAG = 0.25;
const CUSTOM = 'custom';
// How near a stroke must end, in CSS pixels, to its own start to close into a loop, or to a cordon
// or the national border to join it. Fingers get more room than a mouse or pen.
const SNAP = { mouse: 14, pen: 14, touch: 24 };
// For this many days after detection, the status line says the outbreak has been detected.
const NEWS_DAYS = 6;
// The notice on the map when the outbreak is detected, and how long it stays, in ms.
const NOTICE = 'Infection detected. Build blockades to stop the spread of infection.';
const NOTICE_TIME = 8000;
// How long the Advanced sliders must rest, in ms, before the baseline re-runs with their change.
const SETTLE = 400;
const number = new Intl.NumberFormat('en-GB');

const scenario = select({ label: 'Outbreak starts in', options: ['Prague', 'Brno', 'Ostrava'] });
const strain = select({
  label: 'Strain',
  options: [...STRAINS.map(({ label, key }) => ({ label, value: key })), { label: 'Custom', value: CUSTOM }],
});
const speed = select({ label: 'Speed', options: [{ label: '1×', value: 1 }, { label: '2×', value: 2 }, { label: '4×', value: 4 }] });
const sliders = Object.fromEntries(SLIDERS.map(({ name, ...spec }) => [name, slider({ ...spec, value: STRAINS[0].params[name] })]));
const advanced = group('Advanced', sliders, { collapsible: true });
const draw = toggle({ label: 'Draw blockade' });
const seal = chooser({ label: 'Seal a region', prompt: 'Choose a region' });
const edit = actions([{ name: 'undo', label: 'Undo' }, { name: 'clear', label: 'Clear' }]);
const quarantine = group('Quarantine', { draw, seal, edit });

let grid = null;
let map = null;
let client = null;
let colours = null; // the map's and the chart's colours for `colourTheme`
let colourTheme = null;
let latest = null; // the newest frame: { day, totals, regions, ended, detected, work, ... }
let spare = null; // the newest frame's pixel buffer, to hand back to the worker
let busy = false; // a frame request is out
let owed = 0; // simulated days the animation clock has run ahead of the worker
let run = 0; // counts runs, so frames from a run that has been replaced are dropped
let hoverCell = -1;
let chartPointer = null; // the x of a pointer over the chart, in CSS pixels
let regionPeople = null; // each region's people at the start, by label - 1
let noticeTimer = 0;
let queue = null; // this thread's copy of the build queue
let stroke = null; // the cordon being drawn: [[x, y], ...] in cell units
let strokeReach = SNAP.mouse; // its snapping distance, in CSS pixels
let borderCorners = null; // grid corners on the national border, which a stroke's ends can join
const seals = new Map(); // region id → its seal's edges, computed when first needed
let baseline = null;
let job = null; // the baseline's run: { cell, zombies, schedule: [{ day, params }, ...] }
let settling = 0; // the timer that re-runs the baseline after a slider change
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
  controls: { scenario, strain, speed, quarantine, advanced },
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
    map.draw(ctx, width, height, (overlay, scale) => {
      const region = hoverRegion();
      if (region) {
        overlay.save();
        overlay.globalAlpha = 0.7;
        overlay.strokeStyle = colours.cordon;
        overlay.lineWidth = 1.5 / scale;
        overlay.stroke(map.outline(region));
        overlay.restore();
      }
      drawCordons(overlay, {
        items: queue.items,
        built: queue.built(latest?.work ?? 0),
        width: grid.width,
        scale,
        colour: colours.cordon,
        crew: Boolean(latest?.detected && !latest.ended),
        stroke,
      });
    });
    paintChart(pixelRatio);
  },
});
const summary = createSummary(app.stage.closest('.dk-main'));
app.stage.setAttribute('aria-label', 'Map of Czechia at 1 km resolution: where people live, where the zombie outbreak has spread, and the blockades drawn against it.');

// The chart goes above the map, and the detection notice over the map's top edge.
const chartCanvas = document.createElement('canvas');
chartCanvas.className = 'zo-chart';
chartCanvas.setAttribute('role', 'img');
chartCanvas.setAttribute('aria-label', `Chart of the humans, zombies and dead in Czechia, day by day, from day 0 to day ${LAST_DAY}.`);
app.stage.closest('.dk-stage').before(chartCanvas);
const notice = document.createElement('p');
notice.className = 'zo-notice';
notice.setAttribute('role', 'status');
notice.hidden = true;
notice.addEventListener('click', () => hideNotice());
app.stage.closest('.dk-stage').append(notice);

/** Draws the chart, sizing its canvas to its box at `pixelRatio` first. */
function paintChart(pixelRatio) {
  const { width, height } = chartCanvas.getBoundingClientRect();
  const backing = [Math.max(1, Math.round(width * pixelRatio)), Math.max(1, Math.round(height * pixelRatio))];
  if (chartCanvas.width !== backing[0]) chartCanvas.width = backing[0];
  if (chartCanvas.height !== backing[1]) chartCanvas.height = backing[1];
  const ctx = chartCanvas.getContext('2d');
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawChart(ctx, { width, height }, history, {
    total: grid.total,
    lastDay: LAST_DAY,
    detectionDay: DETECTION_DAY,
    day: latest?.day ?? 0,
    colours: colours.chart,
    font: colours.font,
    latest: latest?.totals ?? null,
    baseline: queue.total > 0 ? baseline.trace : null, // until anything is planned, it is the same run
    pointer: chartPointer,
  });
}

function showNotice() {
  notice.textContent = NOTICE;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(hideNotice, NOTICE_TIME);
}

function hideNotice() {
  clearTimeout(noticeTimer);
  notice.hidden = true;
}

function applyColours() {
  colourTheme = getTheme();
  const read = (name) => token(app.stage, name);
  const map_ = readColours(read);
  colours = {
    map: map_,
    chart: {
      humans: map_.people,
      zombies: map_.zombie,
      dead: map_.dead,
      panel: read('--color-surface'),
      border: read('--color-border'),
      text: read('--color-text'),
      muted: read('--color-muted'),
    },
    font: read('--font-text'),
    cordon: read('--color-text'),
  };
  map.setColours(map_);
  return client.setColours(map_);
}

function show(frame) {
  map.setImage(frame.pixels);
  spare = frame.pixels;
  if (frame.detected && latest && !latest.detected) showNotice();
  latest = frame;
  history.push(frame);
  if (frame.ended) app.pause();
  refreshStatus();
  showSummary();
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
  queue.clear();
  stroke = null;
  afterEdit();
  summary.hide();
  hideNotice();
  clearTimeout(settling);
  const [col, row] = grid.cities.find((city) => city.name === scenario.value).cell;
  job = { cell: row * grid.width + col, zombies: PATIENTS_ZERO, schedule: [{ day: 0, params: params() }] };
  baseline.start(job);
  client.reset({ cell: job.cell, zombies: job.zombies, params: job.schedule[0].params }, takeSpare())
    .then((frame) => {
      if (current !== run) {
        spare = frame.pixels;
        return;
      }
      show(frame);
    })
    .catch(fail);
}

/** The quarantine's progress, for the status line: '' when nothing is queued. */
function cordonStatus(detected) {
  const total = queue.total;
  if (total === 0) return '';
  const km = (value) => `${number.format(value)} km`;
  if (!detected) return ` ${km(total)} of blockade planned, to be built once the outbreak is detected.`;
  const built = Math.min(Math.floor(latest.work + 1e-9), total);
  return built === total ? ` Blockades: all ${km(total)} built.` : ` Blockades: ${number.format(built)} of ${km(total)} built.`;
}

function liveStatus() {
  if (!latest) return 'Starting the outbreak…';
  const { day, totals, ended, detected } = latest;
  if (!detected) return `Day ${Math.floor(day)}: no outbreak detected yet.${cordonStatus(false)}`;
  const base = queue.total > 0 ? baseline.at(day) : null;
  const gap = base ? totals.humans - base.humans : 0;
  const versus = Math.abs(gap) >= 1 ? ` (${compact(Math.abs(gap))} ${gap > 0 ? 'more' : 'fewer'} than with no quarantine)` : '';
  const counts = `${compact(totals.humans)} humans${versus}, ${compact(totals.zombies)} zombies, ${compact(totals.dead)} dead`;
  const crossed = totals.exported >= 1 ? `, and ${compact(totals.exported)} zombies have crossed the border` : '';
  if (ended) {
    const how = totals.zombies === 0 ? 'The outbreak died out' : 'The run ended';
    return `${how} on day ${Math.round(day)}: ${counts}${crossed}.${cordonStatus(true)} Press Reset to run it again.`;
  }
  const news = day < DETECTION_DAY + NEWS_DAYS ? 'outbreak detected. ' : '';
  return `Day ${Math.floor(day)}: ${news}${counts}${crossed}.${cordonStatus(true)}`;
}

const regionName = (region) => (region.code === 'CZ-PR' ? region.nameEn : `${region.nameEn} Region`);

/** The region under the pointer, by label, or 0 when the pointer isn't over Czechia (or is drawing). */
const hoverRegion = () => (hoverCell >= 0 && !draw.value && !stroke && grid.labels[hoverCell] < NEIGHBOUR_BASE ? grid.labels[hoverCell] : 0);

/** The readout for the region (or country) of one cell. Before detection it shows only who lived there. */
function describe(cell) {
  const label = grid.labels[cell];
  if (label >= NEIGHBOUR_BASE) return grid.neighbours.find((n) => n.id === label).name;
  const name = regionName(grid.regions[label - 1]);
  if (!latest?.detected) return `${name}: ${compact(regionPeople[label - 1])} people.`;
  const [humans, zombies, dead] = latest.regions.subarray((label - 1) * 3, label * 3);
  return `${name}: ${compact(humans)} humans, ${compact(zombies)} zombies and ${compact(dead)} dead.`;
}

function refreshStatus() {
  app.status(hoverCell < 0 ? liveStatus() : describe(hoverCell));
}

/** Shows the end summary once the run has ended. Until the baseline has finished, "saved" waits. */
function showSummary() {
  if (!latest?.ended) return;
  const trace = baseline.trace;
  const done = trace?.ended ? trace.humans.at(-1) : null;
  summary.show({
    day: latest.day,
    diedOut: latest.totals.zombies === 0,
    humans: latest.totals.humans,
    total: grid.total,
    baseline: done,
    sealedIn: latest.sealedIn,
    exports: latest.exports.map(([label, zombies]) => ({ name: grid.neighbours.find((n) => n.id === label).name, zombies })),
  });
}

function fail(error) {
  app.pause();
  app.status('The simulation stopped because of an error.');
  console.error(error);
}

// The quarantine tools.

const isSealed = (id) => queue.items.some((item) => item.region === id);

/** Updates the tools after the queue changes, and redraws. */
function afterEdit() {
  const empty = queue.items.length === 0;
  edit.enable('undo', !empty);
  edit.enable('clear', !empty);
  const options = grid.regions.map((region, k) => {
    const sealed = isSealed(k + 1);
    return { label: `${regionName(region)}${sealed ? ' (sealed)' : ''}`, value: k + 1, disabled: sealed };
  });
  seal.setOptions(options.sort((a, b) => a.label.localeCompare(b.label, 'en')));
  refreshStatus();
  app.redraw();
}

function addItem(item) {
  queue.add(item);
  client.addItem(item).catch(fail);
  hideNotice();
  afterEdit();
}

function sealRegion(id) {
  if (isSealed(id)) return;
  if (!seals.has(id)) seals.set(id, sealEdges(id, grid));
  addItem({ kind: 'seal', region: id, edges: seals.get(id) });
}

/** Turns the stroke just drawn into a cordon, joining its ends to what they nearly reach. */
function finishStroke() {
  const corners = [...borderCorners];
  for (const item of queue.items) {
    for (const edge of item.edges) {
      const [x1, y1, x2, y2] = edgeLine(edge, grid.width);
      corners.push([x1, y1], [x2, y2]);
    }
  }
  const edges = strokeEdges(snapStroke(stroke, strokeReach / map.scale, corners), grid);
  stroke = null;
  if (edges.length) addItem({ kind: 'cordon', edges });
  else app.redraw();
}

/** Every grid corner along the national border. */
function nationalCorners() {
  const corners = [];
  for (const [x1, y1, x2, y2] of borderSegments(grid.labels, grid.width, grid.height).nation) {
    for (let x = x1, y = y1; x <= x2 && y <= y2; x1 === x2 ? y++ : x++) corners.push([x, y]);
  }
  return corners;
}

loadGrid()
  .then(async (loaded) => {
    grid = loaded;
    regionPeople = new Float64Array(grid.regions.length);
    grid.labels.forEach((label, i) => {
      if (label < NEIGHBOUR_BASE) regionPeople[label - 1] += grid.population[i];
    });
    map = createMap(grid);
    queue = createQueue(grid.width * grid.height);
    borderCorners = nationalCorners();
    client = createClient();
    baseline = createBaseline({
      grid,
      lastDay: LAST_DAY,
      every: SAMPLE_DAYS,
      onUpdate: () => {
        refreshStatus();
        showSummary();
        app.redraw();
      },
    });
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
      const next = params();
      const current = run;
      client.setParams(next).then((day) => {
        if (current !== run) return;
        // The baseline takes the same change on the same day, once the sliders settle.
        job = { ...job, schedule: [...job.schedule.filter((change) => change.day < day - 1e-9), { day, params: next }] };
        clearTimeout(settling);
        settling = setTimeout(() => baseline.start(job), SETTLE);
      }).catch(fail);
    });
    draw.onChange((on) => {
      app.stage.classList.toggle('zo-drawing', on);
      app.stage.classList.remove('zo-sealable');
      stroke = null;
      app.redraw();
    });
    seal.onChange((id) => sealRegion(id));
    edit.onChange((name) => {
      if (name === 'undo') {
        queue.undo();
        client.undo().catch(fail);
      } else {
        queue.clear();
        client.clear().catch(fail);
      }
      afterEdit();
    });

    const stagePoint = (event) => {
      const rect = app.stage.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const czechCell = (cell) => cell >= 0 && grid.labels[cell] < NEIGHBOUR_BASE;
    app.stage.addEventListener('pointerdown', (event) => {
      if (!draw.value || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      app.stage.setPointerCapture(event.pointerId);
      stroke = [map.toGrid(...stagePoint(event))];
      strokeReach = SNAP[event.pointerType] ?? SNAP.mouse;
    });
    app.stage.addEventListener('pointermove', (event) => {
      const [x, y] = stagePoint(event);
      if (stroke) {
        const point = map.toGrid(x, y);
        const [lastX, lastY] = stroke.at(-1);
        if (Math.hypot(point[0] - lastX, point[1] - lastY) * map.scale >= 2) {
          stroke.push(point);
          app.redraw();
        }
        return;
      }
      const region = hoverRegion();
      hoverCell = map.cellAt(x, y);
      app.stage.classList.toggle('zo-sealable', !draw.value && czechCell(hoverCell) && !isSealed(grid.labels[hoverCell]));
      refreshStatus();
      if (hoverRegion() !== region) app.redraw();
    });
    app.stage.addEventListener('pointerup', (event) => {
      if (!stroke) return;
      stroke.push(map.toGrid(...stagePoint(event)));
      finishStroke();
    });
    app.stage.addEventListener('pointercancel', () => {
      stroke = null;
      app.redraw();
    });
    app.stage.addEventListener('pointerleave', () => {
      hoverCell = -1;
      refreshStatus();
      app.redraw();
    });
    app.stage.addEventListener('click', (event) => {
      if (draw.value) return;
      const cell = map.cellAt(...stagePoint(event));
      if (czechCell(cell)) sealRegion(grid.labels[cell]);
    });

    // Pointing at the chart (or touching it) reads off a day.
    const pointAtChart = (event) => {
      chartPointer = event.clientX - chartCanvas.getBoundingClientRect().left;
      app.redraw();
    };
    const leaveChart = () => {
      chartPointer = null;
      app.redraw();
    };
    chartCanvas.addEventListener('pointerdown', pointAtChart);
    chartCanvas.addEventListener('pointermove', pointAtChart);
    chartCanvas.addEventListener('pointerleave', leaveChart);
    chartCanvas.addEventListener('pointercancel', leaveChart);
  })
  .catch((error) => {
    app.status('The population map could not be loaded.');
    console.error(error);
  });
