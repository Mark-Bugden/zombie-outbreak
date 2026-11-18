// Draws the quarantine on the map, in cell units (inside map.draw's overlay): built cordon as a
// solid line, cordon still to build as a dashed one, the crew as a dot where it is working, and the
// stroke being drawn as it follows the pointer.

import { edgeLine } from '../tools/cordon.js';

// Line widths and dashes, in CSS pixels.
const BUILT = 2;
const PLANNED = 1.5;
const DASH = [4, 3];
const CREW = 3.5;

/** Adds edges to `path` as polylines, continuing the line wherever the next edge starts at its end. */
function trace(path, edges, from, to, width) {
  let x = NaN;
  let y = NaN;
  for (let j = from; j < to; j++) {
    const [x1, y1, x2, y2] = edgeLine(edges[j], width);
    if (x === x1 && y === y1) {
      path.lineTo(x2, y2);
      [x, y] = [x2, y2];
    } else if (x === x2 && y === y2) {
      path.lineTo(x1, y1);
      [x, y] = [x1, y1];
    } else {
      path.moveTo(x1, y1);
      path.lineTo(x2, y2);
      [x, y] = [x2, y2];
    }
  }
  return [x, y];
}

/**
 * Draws `items` (the build queue's) with `built[k]` edges of item k finished, and `stroke`, the
 * points of a stroke in progress (or null). `scale` is CSS pixels per cell; `colour` the line colour,
 * and `crew` whether to mark where the crew is working.
 */
export function drawCordons(ctx, { items, built, width, scale, colour, crew, stroke }) {
  const done = new Path2D();
  const planned = new Path2D();
  let head = null;
  items.forEach((item, k) => {
    const count = built[k] ?? 0;
    const end = trace(done, item.edges, 0, count, width);
    trace(planned, item.edges, count, item.edges.length, width);
    if (crew && head === null && count < item.edges.length) head = count > 0 ? end : edgeLine(item.edges[0], width);
  });

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = BUILT / scale;
  ctx.stroke(done);
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = PLANNED / scale;
  ctx.setLineDash(DASH.map((length) => length / scale));
  ctx.stroke(planned);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (head) {
    ctx.beginPath();
    ctx.arc(head[0], head[1], CREW / scale, 0, 2 * Math.PI);
    ctx.fill();
  }
  if (stroke?.length > 1) {
    ctx.lineWidth = BUILT / scale;
    ctx.beginPath();
    stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  ctx.restore();
}
