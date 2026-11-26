// The demo's entry point. Vite bundles it with the kit, the worker and the CSS into demo.js and demo.css.
//
// The simulation runs in a worker (sim/client.js), which also paints each frame. This thread keeps
// the animation clock: each tick it owes the worker some simulated days (2 per second at 1×), sends
// them when the last frame is back, and draws the newest frame with the borders and the quarantine
// on top, and the counts and the chart above the map.
//
// The quarantine: regions sealed with a click, and blockades drawn on the map (Manual blockades,
// under Advanced), join one build queue (sim/crew.js). In the code, blockades are cordons. This
// thread keeps a copy of the queue to draw it; the worker's copy blocks each edge once it is built.
// The crew starts on the detection day, but the outbreak is shown as it is from day 0.
//
// Each run opens paused on day 0, with a Play button over the map, so visitors can choose the
// settings and plan the quarantine first. Playing, from that button or the kit's, starts the run and
// takes the button away until the next run.
//
// The baseline, the same outbreak with no quarantine, runs ahead in a second worker
// (sim/baseline.js), for the chart's faint line and the end summary's "saved".

import manifest from 'virtual:manifest';
import { getTheme, mount, select, slider, toggle, token } from '@mark-bugden/demo-kit';
import '@mark-bugden/demo-kit/tokens.scoped.css';
import '@mark-bugden/demo-kit/frame.css';
import './demo.css';
import { group } from './controls.js';
import { createCounts } from './counts.js';
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
// Frames the first run holds on day 0 once it plays, before its clock starts. Over a canvas's first
// few animated frames, the browser moves it to the GPU and compiles shaders for it, which can freeze
// the page for a few hundred ms when its shader cache is cold. Holding still lets that happen before
// anything moves.
const WARM_UP_FRAMES = 10;
const CUSTOM = 'custom';
// How near a stroke must end, in CSS pixels, to its own start to close into a loop, or to a cordon
// or the national border to join it. Fingers get more room than a mouse or pen.
const SNAP = { mouse: 14, pen: 14, touch: 24 };
// For this many days after detection, the status line says the outbreak has been detected.
const NEWS_DAYS = 6;
// The notice on the map when the outbreak is detected. It stays until the crew has built every
// blockade and seal, a click on it, the end of the run, or a new run.
const NOTICE = 'Outbreak detected. Click on a region to build blockades and try to stop the spread.';
// The kit's play icon, at the opening Play button's size.
const PLAY_ICON = '<span class="dk-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" focusable="false"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg></span>';
// How long the Advanced sliders must rest, in ms, before the baseline re-runs with their change.
const SETTLE = 400;
const number = new Intl.NumberFormat('en-GB');

const scenario = select({ label: 'Outbreak starts in', options: ['Prague', 'Brno', 'Ostrava'] });
const strain = select({
  label: 'Strain',
  options: [...STRAINS.map(({ label, key }) => ({ label, value: key })), { label: 'Custom', value: CUSTOM }],
});
const speed = select({ label: 'Speed', options: [{ label: '1×', value: 1 }, { label: '2×', value: 2 }, { label: '4×', value: 4 }], value: 1 });
const sliders = Object.fromEntries(SLIDERS.map(({ name, ...spec }) => [name, slider({ ...spec, value: STRAINS[0].params[name] })]));
const rates = group(null, sliders, { className: 'zo-rates' }); // the model's rates: their value is the parameters
const draw = toggle({ label: 'Manual blockades' });
const advanced = group('Advanced', { draw, rates }, { collapsible: true });

let grid = null;
let map = null;
let client = null;
let colours = null; // the map's and the chart's colours for `colourTheme`
let colourTheme = null;
let latest = null; // the newest frame: { day, totals, regions, ended, detected, work, ... }
let spare = null; // the newest frame's pixel buffer, to hand back to the worker
let busy = false; // a frame request is out
let owed = 0; // simulated days the animation clock has run ahead of the worker
let warmUp = WARM_UP_FRAMES; // frames left to hold the first run on day 0
let run = 0; // counts runs, so frames from a run that has been replaced are dropped
let hoverCell = -1;
let chartPointer = null; // the x of a pointer over the chart, in CSS pixels
let queue = null; // this thread's copy of the build queue
let stroke = null; // the cordon being drawn: [[x, y], ...] in cell units
let strokeReach = SNAP.mouse; // its snapping distance, in CSS pixels
let borderCorners = null; // grid corners on the national border, which a stroke's ends can join
const seals = new Map(); // region id → its seal's edges, computed when first needed
let baseline = null;
let job = null; // the baseline's run: { cell, zombies, schedule: [{ day, params }, ...] }
let settling = 0; // the timer that re-runs the baseline after a slider change
const history = createHistory();

const params = () => ({ ...rates.value, ...FIXED });
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
    if (app.playing && !opening.hidden) hideOpening();
    const ctx = stage.getContext('2d');
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (!map || !colours) {
      ctx.fillStyle = read('--color-surface');
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (theme !== colourTheme) applyColours().then(() => client.repaint(takeSpare())).then(show).catch(fail);
    if (delta > 0 && latest && !latest.ended) {
      if (warmUp > 0) {
        warmUp--;
      } else {
        const rate = DAYS_PER_SECOND * speed.value;
        owed = Math.min(owed + delta * rate, MAX_LAG * rate);
        pump();
      }
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

// The counts and the chart go above the map, in one panel, and the detection notice over the map's
// top edge.
const chartPanel = document.createElement('div');
chartPanel.className = 'zo-chart';
const counts = createCounts(chartPanel);
const chartCanvas = document.createElement('canvas');
chartCanvas.setAttribute('role', 'img');
chartCanvas.setAttribute('aria-label', `Chart of the humans, zombies and dead in Czechia, day by day, from day 0 to day ${LAST_DAY}.`);
chartPanel.append(chartCanvas);
app.stage.closest('.dk-stage').before(chartPanel);
const notice = document.createElement('p');
notice.className = 'zo-notice';
notice.setAttribute('role', 'status');
notice.hidden = true;
notice.addEventListener('click', () => hideNotice());
app.stage.closest('.dk-stage').append(notice);

// The opening Play button, in the stage's top right corner, clear of every region (see demo.css).
// Only the button takes the pointer, so the map around it stays clickable. It shows once the first
// run is ready.
const opening = document.createElement('button');
opening.type = 'button';
opening.className = 'dk-button dk-button-primary zo-play';
opening.innerHTML = PLAY_ICON;
opening.append('Play');
opening.hidden = true;
opening.addEventListener('click', () => app.play());
app.stage.closest('.dk-stage').append(opening);
const transport = app.stage.closest('.dk-main').querySelector('.dk-bar .dk-button-primary'); // the kit's Play/Pause
app.pause();

/** Takes the opening Play button away, handing keyboard focus on to the kit's Play/Pause. */
function hideOpening() {
  const keyboard = opening.matches(':focus-visible');
  opening.hidden = true;
  if (keyboard) transport?.focus();
}

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
    baseline: queue.total > 0 ? baseline.trace : null, // until anything is planned, it is the same run
    pointer: chartPointer,
  });
}

function showNotice() {
  notice.textContent = NOTICE;
  notice.hidden = false;
}

function hideNotice() {
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
  if (frame.ended || (queue.total > 0 && builtKm() === queue.total)) hideNotice();
  history.push(frame);
  if (frame.ended) app.pause();
  refreshStatus();
  refreshCounts();
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

/** Starts a new run in the opening state: day 0, paused, with the Play button over the map. */
function startRun() {
  if (!client) return;
  app.pause();
  opening.hidden = false;
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

/** The km of the queue the crew has built so far. */
const builtKm = () => Math.min(Math.floor((latest?.work ?? 0) + 1e-9), queue.total);

/** The quarantine's progress, for the status line: '' when nothing is queued. */
function cordonStatus(detected) {
  const total = queue.total;
  if (total === 0) return '';
  const km = (value) => `${number.format(value)} km`;
  if (!detected) return ` ${km(total)} of blockade planned, to be built once the outbreak is detected.`;
  const built = builtKm();
  return built === total ? ` Blockades: all ${km(total)} built.` : ` Blockades: ${number.format(built)} of ${km(total)} built.`;
}

/** The status line when the pointer isn't over the map: news of the run. The numbers are in the counts. */
function liveStatus() {
  if (!latest) return 'Starting the outbreak…';
  const { day, totals, ended, detected } = latest;
  if (ended) {
    const how = totals.zombies === 0 ? 'The outbreak died out' : 'The run ended';
    return `${how} on day ${Math.round(day)}.${cordonStatus(true)} Press Reset to run it again.`;
  }
  // A plan made before detection says it waits for detection, so it needs no news of its own.
  const planned = cordonStatus(detected);
  if (!detected) return planned.trim() || 'Outbreak not yet detected.';
  return `${day < DETECTION_DAY + NEWS_DAYS ? 'Outbreak detected.' : ''}${planned}`.trim();
}

/** The counts above the chart. Saved waits for the baseline to reach today. */
function refreshCounts() {
  if (!latest) {
    counts.show(null);
    return;
  }
  const { day, totals } = latest;
  let saved = 0; // until anything is planned, the baseline is the same run
  if (queue.total > 0) {
    const base = baseline.at(day);
    saved = base ? totals.humans - base.humans : null;
  }
  counts.show({ day, ...totals, saved });
}

const regionName = (region) => (region.code === 'CZ-PR' ? region.nameEn : `${region.nameEn} Region`);

/** The region under the pointer, by label, or 0 when the pointer isn't over Czechia (or is drawing). */
const hoverRegion = () => (hoverCell >= 0 && !draw.value && !stroke && grid.labels[hoverCell] < NEIGHBOUR_BASE ? grid.labels[hoverCell] : 0);

/** The readout for the region (or country) of one cell. */
function describe(cell) {
  const label = grid.labels[cell];
  if (label >= NEIGHBOUR_BASE) return grid.neighbours.find((n) => n.id === label).name;
  const name = regionName(grid.regions[label - 1]);
  if (!latest) return name;
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

/** Refreshes the status line and the counts after the queue changes, and redraws. */
function afterEdit() {
  refreshStatus();
  refreshCounts();
  app.redraw();
}

function addItem(item) {
  queue.add(item);
  client.addItem(item).catch(fail);
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
    map = createMap(grid);
    queue = createQueue(grid.width * grid.height);
    borderCorners = nationalCorners();
    client = createClient();
    baseline = createBaseline({
      grid,
      lastDay: LAST_DAY,
      every: SAMPLE_DAYS,
      onUpdate: () => {
        refreshCounts();
        showSummary();
        app.redraw();
      },
    });
    await client.init(grid);
    await applyColours();
    const pressed = app.playing; // the kit's Play, pressed while the map loaded
    startRun();
    if (pressed) app.play();

    scenario.onChange(() => startRun());
    strain.onChange((key) => {
      const chosen = STRAINS.find((s) => s.key === key);
      if (!chosen) return;
      rates.value = chosen.params;
      startRun();
    });
    rates.onChange(() => {
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
