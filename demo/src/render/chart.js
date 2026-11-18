// The inset chart: humans, zombies and the dead over the run, drawn on the stage canvas in its
// top-right corner. That corner is empty: either the band above the map on a tall stage, or the grid's
// corner above Moravia (Poland's side of the border) on a wide one. Hidden on narrow stages, where
// the status line carries the same numbers.

// Narrower stages than this get no chart.
const MIN_STAGE_WIDTH = 560;
// The chart's distance from the stage's edges, as the map's padding.
const INSET = 12;
// A new point when the day has moved on by at least this much.
export const SAMPLE_DAYS = 0.5;

const SERIES = [
  { key: 'humans', label: 'Humans' },
  { key: 'zombies', label: 'Zombies' },
  { key: 'dead', label: 'Dead' },
];

/** A number in a few characters: 9.62M, 812k, 4,031. */
export function compact(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
  return Math.round(value).toLocaleString('en-GB');
}

/** The run so far, one point per SAMPLE_DAYS: { days, humans, zombies, dead, push(frame), clear() }. */
export function createHistory() {
  const history = { days: [], humans: [], zombies: [], dead: [] };
  history.push = ({ day, totals }) => {
    const last = history.days.at(-1);
    if (last !== undefined) {
      if (day < last) history.clear(); // a new run
      // A repaint of the same day is skipped too. The tolerance absorbs rounding in the day count
      // (ten steps of 0.1 days add up to 0.9999999999999999).
      else if (day - last < SAMPLE_DAYS - 1e-6) return;
    }
    history.days.push(day);
    for (const { key } of SERIES) history[key].push(totals[key]);
  };
  history.clear = () => {
    for (const key of ['days', ...SERIES.map((s) => s.key)]) history[key].length = 0;
  };
  return history;
}

/** Where the chart goes on the stage, or null when the stage is too narrow: { x, y, width, height }. */
export function chartBox(stageWidth) {
  if (stageWidth < MIN_STAGE_WIDTH) return null;
  const width = Math.round(Math.min(250, Math.max(190, stageWidth * 0.24)));
  const height = Math.round(width * 0.6);
  return { x: Math.round(stageWidth - INSET - width), y: INSET, width, height };
}

/**
 * Draws the chart in `box`. `colours` holds the lines (humans, zombies, dead) and the panel
 * (panel, border, text, muted), plus `font`, the text face. `total` is the top of the scale, and
 * `latest` the current totals for the legend. `baseline`, if given, is the run with no quarantine
 * (sim/baseline.js); its humans are drawn faintly up to day `until`.
 */
export function drawChart(ctx, box, history, { total, lastDay, colours, font, latest, baseline, until }) {
  const pad = 10;
  const row = 15;
  ctx.save();
  ctx.fillStyle = colours.panel;
  ctx.strokeStyle = colours.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1, 6);
  ctx.fill();
  ctx.stroke();

  // Legend: one column per series, with a swatch and the name above the latest value.
  const column = (box.width - 2 * pad) / SERIES.length;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  SERIES.forEach(({ key, label }, i) => {
    const x = box.x + pad + column * i;
    const y = box.y + pad + row / 2;
    ctx.fillStyle = colours[key];
    ctx.fillRect(x, y - 1, 8, 2);
    ctx.font = `10px ${font}`;
    ctx.fillStyle = colours.muted;
    ctx.fillText(label, x + 12, y);
    ctx.font = `12px ${font}`;
    ctx.fillStyle = colours.text;
    ctx.fillText(latest ? compact(latest[key]) : '–', x, y + row);
  });

  // Plot: days across, people up, from 0 to the whole population.
  const plot = { x: box.x + pad, y: box.y + pad + row * 2 + 6, width: box.width - 2 * pad, height: 0 };
  plot.height = box.y + box.height - pad - 12 - plot.y;
  ctx.strokeStyle = colours.border;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y + plot.height + 0.5);
  ctx.lineTo(plot.x + plot.width, plot.y + plot.height + 0.5);
  ctx.stroke();
  ctx.font = `10px ${font}`;
  ctx.fillStyle = colours.muted;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('Day 0', plot.x, plot.y + plot.height + 3);
  ctx.textAlign = 'right';
  ctx.fillText(String(lastDay), plot.x + plot.width, plot.y + plot.height + 3);

  const x = (day) => plot.x + (day / lastDay) * plot.width;
  const y = (people) => plot.y + plot.height - (people / total) * plot.height;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  if (baseline?.days.length > 1) {
    // The key, centred under the plot: a dashed swatch and its label.
    const key = 'no quarantine';
    const middle = plot.x + plot.width / 2;
    const half = (ctx.measureText(key).width + 16) / 2;
    ctx.textAlign = 'left';
    ctx.fillText(key, middle - half + 16, plot.y + plot.height + 3);
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = colours.humans;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(middle - half, plot.y + plot.height + 9);
    ctx.lineTo(middle - half + 12, plot.y + plot.height + 9);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < baseline.days.length && baseline.days[i] <= until + 1e-6; i++) {
      const point = [x(baseline.days[i]), y(baseline.humans[i])];
      if (i) ctx.lineTo(...point);
      else ctx.moveTo(...point);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (const { key } of SERIES) {
    const values = history[key];
    if (values.length < 2) continue;
    ctx.strokeStyle = colours[key];
    ctx.beginPath();
    values.forEach((value, i) => (i ? ctx.lineTo(x(history.days[i]), y(value)) : ctx.moveTo(x(history.days[i]), y(value))));
    ctx.stroke();
  }
  ctx.restore();
}
