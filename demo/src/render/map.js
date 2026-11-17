// The map: the population grid drawn to fit the stage, with region and national borders.
// Cells are painted into an offscreen image at one pixel per cell, and the image is drawn
// scaled to the stage. The borders are vector paths along cell edges, stroked on top.

// Labels from 21 up are neighbouring countries; below that, Czech regions (see grid.py).
export const NEIGHBOUR_BASE = 21;
const RAMP_SIZE = 256;
// Space around the map inside the stage, in CSS pixels.
const PADDING = 12;

/** The map colours, read from the demo's --zo-* tokens (demo.css) for the current theme. */
export function readColours(token) {
  return {
    night: token('--zo-night'),
    land: token('--zo-land'),
    people: token('--zo-people'),
    peak: token('--zo-people-peak'),
    region: token('--zo-border-region'),
    nation: token('--zo-border-nation'),
  };
}

/** Parses a CSS hex colour, #rgb or #rrggbb, into [r, g, b]. */
export function parseHex(color) {
  const hex = color.trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`map: expected a hex colour, got "${color}"`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** Packs [r, g, b] as an opaque pixel for a Uint32Array view of ImageData (little-endian). */
export function pack([r, g, b]) {
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * A lookup table of RAMP_SIZE packed colours running through the stops, [[t, '#hex'], ...] with
 * t from 0 to 1 in increasing order, interpolated linearly in RGB.
 */
export function ramp(stops) {
  const parsed = stops.map(([t, color]) => [t, parseHex(color)]);
  const table = new Uint32Array(RAMP_SIZE);
  for (let i = 0; i < RAMP_SIZE; i++) {
    const t = i / (RAMP_SIZE - 1);
    let k = 1;
    while (k < parsed.length - 1 && parsed[k][0] < t) k++;
    const [t0, c0] = parsed[k - 1];
    const [t1, c1] = parsed[k];
    const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
    table[i] = pack(c0.map((v, j) => Math.round(v + (c1[j] - v) * f)));
  }
  return table;
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
 * The map for a decoded grid (see grid.js). Call setColours() with readColours() whenever the
 * theme changes, paint() whenever the population changes, and draw() on every render.
 */
export function createMap(grid) {
  const { width, height, labels } = grid;
  const image = new ImageData(width, height);
  const pixels = new Uint32Array(image.data.buffer);
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { width, height });
  const context = canvas.getContext('2d');
  const segments = borderSegments(labels, width, height);
  const paths = { region: toPath(segments.region), nation: toPath(segments.nation) };
  // Brightness is log-scaled against the most crowded cell at the start, so the map darkens
  // as people are lost instead of rescaling.
  const logPeak = Math.log1p(grid.population.reduce((max, people) => Math.max(max, people), 0));
  let colours = null;
  let shades = null;
  let night = 0;
  let view = { scale: 1, x: 0, y: 0 };

  return {
    setColours(next) {
      colours = next;
      // Only the densest city cores reach the peak colour.
      shades = ramp([[0, next.land], [0.9, next.people], [1, next.peak]]);
      night = pack(parseHex(next.night));
    },

    /** Paints each cell from `people` (one value per cell). */
    paint(people) {
      for (let i = 0; i < pixels.length; i++) {
        if (labels[i] >= NEIGHBOUR_BASE) {
          pixels[i] = night;
        } else {
          const t = Math.log1p(people[i]) / logPeak;
          pixels[i] = shades[Math.min(RAMP_SIZE - 1, Math.round(t * (RAMP_SIZE - 1)))];
        }
      }
      context.putImageData(image, 0, 0);
    },

    /** Draws the map to fit a stage of width × height CSS pixels; ctx is already scaled to CSS pixels. */
    draw(ctx, stageWidth, stageHeight) {
      view = fit(width, height, stageWidth, stageHeight);
      ctx.fillStyle = colours.night;
      ctx.fillRect(0, 0, stageWidth, stageHeight);
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
      ctx.restore();
    },

    /** The index of the cell under a point on the stage (CSS pixels), or -1 if it is off the grid. */
    cellAt(x, y) {
      const col = Math.floor((x - view.x) / view.scale);
      const row = Math.floor((y - view.y) / view.scale);
      return col >= 0 && col < width && row >= 0 && row < height ? row * width + col : -1;
    },
  };
}
