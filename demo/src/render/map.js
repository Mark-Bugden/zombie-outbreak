// The map: an image of the grid at one pixel per cell, painted by the worker (see paint.js), drawn
// scaled to fit the stage, with region and national borders stroked on top as vector paths along
// cell edges.

import { NEIGHBOUR_BASE } from '../grid.js';

// Space around the map inside the stage, in CSS pixels.
const PADDING = 12;

/** The map's colours for the current theme, from the kit's tokens and the demo's --zo-people (demo.css). */
export function readColours(token) {
  return {
    night: token('--color-bg'),
    land: token('--color-surface'),
    people: token('--zo-people'),
    peak: token('--color-text'),
    zombie: token('--color-halpha'),
    region: token('--color-border'),
    nation: token('--color-curve'),
  };
}

/**
 * The cell edges where the label changes, as [x1, y1, x2, y2] segments in cell units: `region`
 * between two Czech regions, `nation` between Czechia and a neighbour. Runs along one line are merged.
 */
export function borderSegments(labels, width, height) {
  const region = [];
  const nation = [];
  const inside = (label) => label < NEIGHBOUR_BASE;
  const kind = (a, b) => {
    if (a === b) return null;
    if (inside(a) && inside(b)) return region;
    return inside(a) || inside(b) ? nation : null;
  };
  // Vertical edges at x = col, between cells (row, col - 1) and (row, col).
  for (let col = 1; col < width; col++) {
    let list = null;
    let start = 0;
    for (let row = 0; row <= height; row++) {
      const next = row < height ? kind(labels[row * width + col - 1], labels[row * width + col]) : null;
      if (next !== list) {
        list?.push([col, start, col, row]);
        list = next;
        start = row;
      }
    }
  }
  // Horizontal edges at y = row, between cells (row - 1, col) and (row, col).
  for (let row = 1; row < height; row++) {
    let list = null;
    let start = 0;
    for (let col = 0; col <= width; col++) {
      const next = col < width ? kind(labels[(row - 1) * width + col], labels[row * width + col]) : null;
      if (next !== list) {
        list?.push([start, row, col, row]);
        list = next;
        start = col;
      }
    }
  }
  return { region, nation };
}

/** The scale and offset that fit a grid of cells inside a box, centred with PADDING around it. */
export function fit(gridWidth, gridHeight, boxWidth, boxHeight, padding = PADDING) {
  const scale = Math.max(0, Math.min((boxWidth - 2 * padding) / gridWidth, (boxHeight - 2 * padding) / gridHeight));
  return { scale, x: (boxWidth - gridWidth * scale) / 2, y: (boxHeight - gridHeight * scale) / 2 };
}

function toPath(segments) {
  const path = new Path2D();
  for (const [x1, y1, x2, y2] of segments) {
    path.moveTo(x1, y1);
    path.lineTo(x2, y2);
  }
  return path;
}

/**
 * The map for a decoded grid (see grid.js). Call setImage() with each frame's pixels, setColours()
 * with readColours() when the theme changes, and draw() on every render.
 */
export function createMap(grid) {
  const { width, height, labels } = grid;
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { width, height });
  const context = canvas.getContext('2d');
  const segments = borderSegments(labels, width, height);
  const paths = { region: toPath(segments.region), nation: toPath(segments.nation) };
  let colours = null;
  let painted = false;
  let view = { scale: 1, x: 0, y: 0 };

  return {
    setColours(next) {
      colours = next;
    },

    /** Takes a frame's pixels: an ArrayBuffer of width × height RGBA pixels. */
    setImage(buffer) {
      context.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
      painted = true;
    },

    /**
     * Draws the map to fit a stage of width × height CSS pixels; ctx is already scaled to CSS pixels.
     * `overlay(ctx, scale)`, if given, draws on top in cell units, where `scale` is CSS pixels per cell.
     */
    draw(ctx, stageWidth, stageHeight, overlay) {
      view = fit(width, height, stageWidth, stageHeight);
      ctx.fillStyle = colours.night;
      ctx.fillRect(0, 0, stageWidth, stageHeight);
      if (!painted) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, view.x, view.y, width * view.scale, height * view.scale);

      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colours.region;
      ctx.lineWidth = 0.75 / view.scale;
      ctx.stroke(paths.region);
      ctx.strokeStyle = colours.nation;
      ctx.lineWidth = 1.25 / view.scale;
      ctx.stroke(paths.nation);
      overlay?.(ctx, view.scale);
      ctx.restore();
    },

    /** CSS pixels per cell, as last drawn. */
    get scale() {
      return view.scale;
    },

    /** A point on the stage (CSS pixels) in cell units: [x, y] from the grid's north-west corner. */
    toGrid(x, y) {
      return [(x - view.x) / view.scale, (y - view.y) / view.scale];
    },

    /** The index of the cell under a point on the stage (CSS pixels), or -1 if it is off the grid. */
    cellAt(x, y) {
      const col = Math.floor((x - view.x) / view.scale);
      const row = Math.floor((y - view.y) / view.scale);
      return col >= 0 && col < width && row >= 0 && row < height ? row * width + col : -1;
    },
  };
}
