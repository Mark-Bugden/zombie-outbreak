// The demo's entry point. Vite bundles it with the kit and the CSS into demo.js and demo.css.
// For now it draws the population map. The simulation and the quarantine tools come later (see docs/plan.md).

import manifest from 'virtual:manifest';
import { mount } from '@mark-bugden/demo-kit';
import '@mark-bugden/demo-kit/tokens.scoped.css';
import '@mark-bugden/demo-kit/frame.css';
import './demo.css';
import { loadGrid } from './grid.js';
import { NEIGHBOUR_BASE, createMap, readColours } from './render/map.js';

const number = new Intl.NumberFormat('en-GB');

let grid = null;
let map = null;
let paintedTheme = null;

const frame = mount({
  el: document.querySelector(`[data-demo="${manifest.slug}"]`),
  manifest,
  stage: 'canvas',
  status: 'Loading the population map…',
  render({ stage, width, height, pixelRatio, theme, token }) {
    const ctx = stage.getContext('2d');
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (!map) {
      ctx.fillStyle = token('--zo-night');
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (theme !== paintedTheme) {
      map.setColours(readColours(token));
      map.paint(grid.population);
      paintedTheme = theme;
    }
    map.draw(ctx, width, height);
  },
});
frame.stage.setAttribute('aria-label', 'Map of where people live in Czechia in 2020, at 1 km resolution, with the 14 regions outlined.');

function overview() {
  const cells = grid.regions.reduce((sum, region) => sum + region.cells, 0);
  return `${number.format(grid.total)} people in ${number.format(cells)} cells of 1 km². Point at the map to read a cell.`;
}

function describe(cell) {
  const label = grid.labels[cell];
  if (label >= NEIGHBOUR_BASE) return grid.neighbours.find((n) => n.id === label).name;
  const region = grid.regions[label - 1];
  const name = region.code === 'CZ-PR' ? region.nameEn : `${region.nameEn} Region`;
  return `${name}: ${number.format(grid.population[cell])} people in this km².`;
}

loadGrid()
  .then((loaded) => {
    grid = loaded;
    map = createMap(grid);
    frame.status(overview());
    frame.redraw();
    frame.stage.addEventListener('pointermove', (event) => {
      const rect = frame.stage.getBoundingClientRect();
      const cell = map.cellAt(event.clientX - rect.left, event.clientY - rect.top);
      frame.status(cell < 0 ? overview() : describe(cell));
    });
    frame.stage.addEventListener('pointerleave', () => frame.status(overview()));
  })
  .catch((error) => {
    frame.status('The population map could not be loaded.');
    throw error;
  });
