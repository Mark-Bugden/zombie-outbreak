// The chart: humans, zombies and the dead over the whole run, day 0 to the last day, on a canvas of
// its own above the map. It shows the true numbers from day 0, even while the map still hides the
// outbreak. A line marks today, so the timeline visibly moves even when little else does; a dashed
// one marks the detection day. Pointing at the chart reads off any day so far.

// A new point when the day has moved on by at least this much.
export const SAMPLE_DAYS = 0.5;

const SERIES = [
  { key: 'humans', label: 'Humans' },
  { key: 'zombies', label: 'Zombies' },
  { key: 'dead', label: 'Dead' },
];
const BASELINE_LABEL = 'Humans with no quarantine';
const PAD = 12;
const LEGEND_ROW = 20;
const NOTE_ROW = 16; // the labels above the plot: today's day, and "detected"
const AXIS_ROW = 16; // the day labels under the plot

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

/** The index of the entry in `days` (increasing) nearest to `day`, or -1 if it is empty. */
export function nearest(days, day) {
  if (!days.length) return -1;
  let lo = 0;
  let hi = days.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && day - days[lo - 1] < days[lo] - day ? lo - 1 : lo;
}

/** The first of `steps` that keeps ticks at least `gap` px apart along `length` px of `range`. */
const tickStep = (steps, range, length, gap) => steps.find((step) => (step / range) * length >= gap) ?? steps.at(-1);
const millions = (value) => (value === 0 ? '0' : `${value / 1e6}M`);

/**
 * Draws the chart over a canvas of `width` × `height` CSS pixels; ctx is already scaled to CSS
 * pixels. `colours` holds the lines (humans, zombies, dead) and the panel (panel, border, text,
 * muted); `font` is the text face. `total` is the top of the scale, `day` today, and `latest` the
 * current totals for the legend. `baseline`, if given, is the run with no quarantine
 * (sim/baseline.js); its humans are drawn dashed up to today. `pointer`, if given, is the x of a
 * pointer over the chart, which gets a crosshair and the values on that day.
 */
export function drawChart(ctx, { width, height }, history, { total, lastDay, detectionDay, day, colours, font, latest, baseline, pointer }) {
  const text = (size, weight = 400) => `${weight} ${size}px ${font}`;
  ctx.save();
  ctx.fillStyle = colours.panel;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  // Legend: a swatch, the name, and the latest value for each series, then the baseline's key,
  // right-aligned, or on a row of its own when there is no room.
  const items = SERIES.map(({ key, label }) => {
    ctx.font = text(11);
    const labelWidth = ctx.measureText(label).width;
    ctx.font = text(13, 600);
    const value = latest ? compact(latest[key]) : '–';
    return { key, label, value, labelWidth, width: 16 + labelWidth + 6 + ctx.measureText(value).width };
  });
  let x = PAD;
  let rows = 1;
  items.forEach((item, i) => {
    if (i && x + item.width > width - PAD) {
      x = PAD;
      rows++;
    }
    const y = PAD + (rows - 1) * LEGEND_ROW + LEGEND_ROW / 2;
    ctx.fillStyle = colours[item.key];
    ctx.fillRect(x, y - 1, 10, 2);
    ctx.font = text(11);
    ctx.fillStyle = colours.muted;
    ctx.textAlign = 'left';
    ctx.fillText(item.label, x + 16, y);
    ctx.font = text(13, 600);
    ctx.fillStyle = colours.text;
    ctx.fillText(item.value, x + 16 + item.labelWidth + 6, y);
    x += item.width + 20;
  });
  const showBaseline = baseline?.days.length > 1;
  if (showBaseline) {
    ctx.font = text(11);
    const keyWidth = 22 + ctx.measureText(BASELINE_LABEL).width;
    let keyX = width - PAD - keyWidth;
    if (keyX < x - 8) {
      rows++;
      keyX = PAD;
    }
    const y = PAD + (rows - 1) * LEGEND_ROW + LEGEND_ROW / 2;
    ctx.save();
    ctx.strokeStyle = colours.humans;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(keyX, y);
    ctx.lineTo(keyX + 14, y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = colours.muted;
    ctx.fillText(BASELINE_LABEL, keyX + 22, y);
  }

  // The plot: days across, people up, from 0 to the whole population, with recessive gridlines.
  ctx.font = text(10);
  const yLabels = width < 480 ? 28 : 34;
  const notes = PAD + rows * LEGEND_ROW + 2;
  const plot = { x: PAD + yLabels, y: notes + NOTE_ROW, width: 0, height: 0 };
  plot.width = width - PAD - plot.x;
  plot.height = height - PAD - AXIS_ROW - plot.y;
  if (plot.width < 40 || plot.height < 20) {
    ctx.restore();
    return;
  }
  const px = (d) => plot.x + (d / lastDay) * plot.width;
  const py = (people) => plot.y + plot.height - (people / total) * plot.height;
  const bottom = plot.y + plot.height;

  const peopleStep = tickStep([1e6, 2e6, 2.5e6, 5e6], total, plot.height, 22);
  ctx.strokeStyle = colours.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = colours.muted;
  ctx.textAlign = 'right';
  for (let value = 0; value <= total; value += peopleStep) {
    const y = Math.round(py(value)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.stroke();
    ctx.fillText(millions(value), plot.x - 6, y);
  }
  const dayStep = tickStep([30, 60, 90], lastDay, plot.width, 44);
  ctx.textBaseline = 'top';
  for (let d = 0; d < lastDay - dayStep * 0.6; d += dayStep) {
    ctx.textAlign = d === 0 ? 'left' : 'center';
    ctx.fillText(d === 0 ? 'Day 0' : String(d), px(d), bottom + 4);
  }
  ctx.textAlign = 'right';
  ctx.fillText(String(lastDay), px(lastDay), bottom + 4);

  // Detection day, dashed, and today, solid, with their labels above the plot.
  ctx.textBaseline = 'middle';
  const noteY = notes + NOTE_ROW / 2;
  const today = Math.min(Math.max(day ?? 0, 0), lastDay);
  const todayLabel = `Day ${Math.floor(today)}`;
  ctx.font = text(11, 600);
  const todayHalf = ctx.measureText(todayLabel).width / 2;
  const todayX = Math.min(Math.max(px(today), plot.x + todayHalf), plot.x + plot.width - todayHalf);
  ctx.save();
  ctx.strokeStyle = colours.muted;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(Math.round(px(detectionDay)) + 0.5, notes + 2);
  ctx.lineTo(Math.round(px(detectionDay)) + 0.5, bottom);
  ctx.stroke();
  ctx.restore();
  ctx.font = text(10);
  const detectedLabel = 'detected';
  const detectedX = px(detectionDay) + 4;
  const detectedEnd = detectedX + ctx.measureText(detectedLabel).width;
  if (detectedEnd + 8 < todayX - todayHalf || detectedX - 8 > todayX + todayHalf) {
    ctx.fillStyle = colours.muted;
    ctx.textAlign = 'left';
    ctx.fillText(detectedLabel, detectedX, noteY);
  }

  // The lines: the baseline's humans, then the dead, zombies and humans so far.
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const line = (days, values, until = Infinity) => {
    ctx.beginPath();
    for (let i = 0; i < days.length && days[i] <= until + 1e-6; i++) {
      if (i) ctx.lineTo(px(days[i]), py(values[i]));
      else ctx.moveTo(px(days[i]), py(values[i]));
    }
    ctx.stroke();
  };
  if (showBaseline) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colours.humans;
    ctx.setLineDash([3, 2]);
    line(baseline.days, baseline.humans, today);
    ctx.restore();
  }
  for (const { key } of [...SERIES].reverse()) {
    if (history[key].length < 2) continue;
    ctx.strokeStyle = colours[key];
    line(history.days, history[key]);
  }

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = colours.text;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(px(today)) + 0.5, notes + NOTE_ROW);
  ctx.lineTo(Math.round(px(today)) + 0.5, bottom);
  ctx.stroke();
  ctx.restore();
  ctx.font = text(11, 600);
  ctx.fillStyle = colours.text;
  ctx.textAlign = 'center';
  ctx.fillText(todayLabel, todayX, noteY);

  // The crosshair: the values on the day under the pointer, up to today.
  const i = pointer === null || pointer === undefined || pointer < plot.x - 8 || pointer > plot.x + plot.width + 8
    ? -1
    : nearest(history.days, Math.min(((pointer - plot.x) / plot.width) * lastDay, today));
  if (i >= 0) {
    const d = history.days[i];
    const cx = Math.round(px(d)) + 0.5;
    ctx.save();
    ctx.strokeStyle = colours.text;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, plot.y);
    ctx.lineTo(cx, bottom);
    ctx.stroke();
    ctx.restore();
    const rowsOut = SERIES.map(({ key, label }) => ({ key, label, value: history[key][i] }));
    const b = showBaseline ? nearest(baseline.days, d) : -1;
    if (b >= 0 && Math.abs(baseline.days[b] - d) < SAMPLE_DAYS) rowsOut.push({ key: 'humans', label: 'No quarantine', value: baseline.humans[b], dashed: true });
    for (const row of rowsOut) {
      if (row.dashed) continue;
      ctx.beginPath();
      ctx.arc(cx, py(row.value), 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = colours[row.key];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colours.panel;
      ctx.stroke();
    }
    // The tooltip, beside the crosshair, on whichever side has room.
    const title = `Day ${Math.floor(d)}`;
    ctx.font = text(11);
    const labelWidth = Math.max(...rowsOut.map((row) => ctx.measureText(row.label).width));
    ctx.font = text(12, 600);
    const valueWidth = Math.max(...rowsOut.map((row) => ctx.measureText(compact(row.value)).width), ctx.measureText(title).width - labelWidth - 30);
    const boxWidth = 8 + 16 + labelWidth + 12 + valueWidth + 10;
    const boxHeight = 8 + 16 + rowsOut.length * 16 + 6;
    let boxX = cx + 12;
    if (boxX + boxWidth > width - 4) boxX = cx - 12 - boxWidth;
    boxX = Math.max(4, boxX);
    const boxY = Math.max(4, Math.min(plot.y, height - 4 - boxHeight));
    ctx.fillStyle = colours.panel;
    ctx.strokeStyle = colours.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX + 0.5, boxY + 0.5, boxWidth, boxHeight, 6);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = colours.text;
    ctx.fillText(title, boxX + 8, boxY + 8 + 8);
    rowsOut.forEach((row, k) => {
      const y = boxY + 8 + 16 + k * 16 + 8;
      ctx.save();
      ctx.strokeStyle = colours[row.key];
      ctx.lineWidth = 2;
      if (row.dashed) {
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([3, 2]);
      }
      ctx.beginPath();
      ctx.moveTo(boxX + 8, y);
      ctx.lineTo(boxX + 18, y);
      ctx.stroke();
      ctx.restore();
      ctx.font = text(11);
      ctx.fillStyle = colours.muted;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, boxX + 24, y);
      ctx.font = text(12, 600);
      ctx.fillStyle = colours.text;
      ctx.textAlign = 'right';
      ctx.fillText(compact(row.value), boxX + boxWidth - 10, y);
    });
  }
  ctx.restore();
}
