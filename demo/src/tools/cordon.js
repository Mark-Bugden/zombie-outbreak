// Cordons as cell edges. People and zombies move between neighbouring cells across the edge they
// share (see sim/szr.js), so a cordon is a chain of cell edges: a path along the grid lines, which
// nothing can cross once it is built.
//
// An edge's id is cell × 2 + side, where side EAST is the cell's east edge and SOUTH its south edge,
// as BLOCK_EAST and BLOCK_SOUTH in sim/szr.js. Points are in cell units: x to the east and y to the
// south from the grid's north-west corner, so cell (row, col) spans x from col to col + 1. Grid
// lines meet at whole numbers.

import { NEIGHBOUR_BASE } from '../grid.js';

export const EAST = 0;
export const SOUTH = 1;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The edges along a freehand stroke, in the order drawn: an Int32Array of edge ids. `points` is
 * the stroke as [[x, y], ...]. Each point snaps to the nearest grid corner, and the stroke follows
 * grid lines from corner to corner, one edge at a time, keeping as close as it can to the straight
 * line between them. The edges therefore join up, so a stroke that closes on itself, or runs from
 * border to border, leaves no gap.
 *
 * Edges between two cells outside Czechia are left out, since nothing crosses them anyway, and so
 * is an edge the stroke has already passed.
 */
export function strokeEdges(points, { width, height, labels }) {
  const edges = [];
  const seen = new Set();
  const add = (cell, side) => {
    const other = side === EAST ? cell + 1 : cell + width;
    if (labels[cell] >= NEIGHBOUR_BASE && labels[other] >= NEIGHBOUR_BASE) return;
    const edge = cell * 2 + side;
    if (seen.has(edge)) return;
    seen.add(edge);
    edges.push(edge);
  };

  let x = null;
  let y = null;
  for (const [px, py] of points) {
    const tx = clamp(Math.round(px), 0, width);
    const ty = clamp(Math.round(py), 0, height);
    if (x === null) {
      x = tx;
      y = ty;
      continue;
    }
    // From (x, y) to (tx, ty): take the step, across or down, whose midpoint comes first along
    // the straight line. The grid's outer edges have no cell beyond them, so they are skipped.
    const nx = Math.abs(tx - x);
    const ny = Math.abs(ty - y);
    const sx = Math.sign(tx - x);
    const sy = Math.sign(ty - y);
    for (let ix = 0, iy = 0; ix < nx || iy < ny;) {
      if ((0.5 + ix) * ny < (0.5 + iy) * nx) {
        const col = sx > 0 ? x : x - 1;
        if (y > 0 && y < height) add((y - 1) * width + col, SOUTH);
        x += sx;
        ix++;
      } else {
        const row = sy > 0 ? y : y - 1;
        if (x > 0 && x < width) add(row * width + x - 1, EAST);
        y += sy;
        iy++;
      }
    }
  }
  return Int32Array.from(edges);
}

/**
 * A freehand stroke tidied up before it becomes edges, since a hand rarely ends exactly where it
 * means to: `points` with its ends moved onto what they were reaching for, within `reach` cells.
 * A stroke that ends near its start, after going further away, closes into a loop. Otherwise each
 * end joins the nearest of `corners` (grid corners of existing cordons, as [x, y]) in reach.
 */
export function snapStroke(points, reach, corners = []) {
  if (points.length < 2) return points;
  const distance = ([x1, y1], [x2, y2]) => Math.hypot(x1 - x2, y1 - y2);
  const first = points[0];
  const last = points.at(-1);
  const furthest = points.reduce((most, point) => Math.max(most, distance(point, first)), 0);
  if (distance(first, last) <= reach && furthest > 2 * reach) return [...points, first];
  const nearest = (end) => {
    let best = null;
    let bestDistance = reach;
    for (const corner of corners) {
      const d = distance(end, corner);
      if (d <= bestDistance) {
        best = corner;
        bestDistance = d;
      }
    }
    return best;
  };
  const start = nearest(first);
  const end = nearest(last);
  return [...(start ? [start] : []), ...points, ...(end ? [end] : [])];
}

/** An edge's two ends, [x1, y1, x2, y2], in cell units. */
export function edgeLine(edge, width) {
  const cell = edge >> 1;
  const col = cell % width;
  const row = (cell - col) / width;
  return edge & 1 ? [col, row + 1, col + 1, row + 1] : [col + 1, row, col + 1, row + 1];
}

/**
 * The edges that seal off region `id` (a label from 1 to 14) from the rest of Czechia: its
 * borders with other regions, as an Int32Array of edge ids. Its stretches of national border are
 * left open, so zombies can still cross them. The edges are ordered as paths along the border, so
 * the crew builds a seal as it builds a drawn line, rather than in scattered pieces.
 */
export function sealEdges(id, { width, height, labels }) {
  const boundary = (a, b) => (a === id) !== (b === id) && a < NEIGHBOUR_BASE && b < NEIGHBOUR_BASE;
  const corner = (x, y) => y * (width + 1) + x;
  const ends = new Map(); // grid corner → the edges that end there
  const link = (point, edge) => {
    const list = ends.get(point);
    if (list) list.push(edge);
    else ends.set(point, [edge]);
  };
  const edges = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      if (col < width - 1 && boundary(labels[cell], labels[cell + 1])) edges.push(cell * 2 + EAST);
      if (row < height - 1 && boundary(labels[cell], labels[cell + width])) edges.push(cell * 2 + SOUTH);
    }
  }
  for (const edge of edges) {
    const [x1, y1, x2, y2] = edgeLine(edge, width);
    link(corner(x1, y1), edge);
    link(corner(x2, y2), edge);
  }

  // Walk the border from corner to corner. Paths that stop at the national border are walked from
  // one end; closed loops from their northernmost corner. Each next path starts from the end
  // nearest the last one.
  const used = new Set();
  const other = (edge, point) => {
    const [x1, y1, x2, y2] = edgeLine(edge, width);
    const a = corner(x1, y1);
    return a === point ? corner(x2, y2) : a;
  };
  const free = (point) => ends.get(point).filter((edge) => !used.has(edge));
  const starts = [...ends.keys()].sort((a, b) => a - b);
  const ordered = [];
  let last = null;
  while (ordered.length < edges.length) {
    const open = starts.filter((point) => free(point).length > 0);
    const odd = open.filter((point) => free(point).length % 2 === 1);
    const pool = odd.length ? odd : open;
    const distance = (point) => {
      if (last === null) return 0;
      const dx = (point % (width + 1)) - (last % (width + 1));
      const dy = Math.floor(point / (width + 1)) - Math.floor(last / (width + 1));
      return dx * dx + dy * dy;
    };
    let point = pool.reduce((best, p) => (distance(p) < distance(best) ? p : best), pool[0]);
    for (let next = free(point); next.length; next = free(point)) {
      const edge = next[0];
      used.add(edge);
      ordered.push(edge);
      point = other(edge, point);
    }
    last = point;
  }
  return Int32Array.from(ordered);
}
