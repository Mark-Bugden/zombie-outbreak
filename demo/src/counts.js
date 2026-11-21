// The counts above the chart: today, and the run's totals so far, each in a slot of fixed width so
// that the numbers change in place while the run plays. Their swatches are the chart's legend.

import { compact } from './render/chart.js';

const ITEMS = [
  { key: 'day', label: 'Day' },
  { key: 'humans', label: 'Humans' },
  { key: 'zombies', label: 'Zombies' },
  { key: 'dead', label: 'Dead' },
  { key: 'exported', label: 'Exported' },
  { key: 'saved', label: 'Saved' },
];

/** The counts, appended to `container`, each a dash until show(). */
export function createCounts(container) {
  const el = document.createElement('dl');
  el.className = 'zo-counts';
  const values = {};
  for (const { key, label } of ITEMS) {
    const item = document.createElement('div');
    item.dataset.key = key;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = '–';
    values[key] = dd;
    item.append(dt, dd);
    el.append(item);
  }
  container.append(el);

  return {
    /**
     * Shows { day, humans, zombies, dead, exported, saved }. Saved is the humans more than with no
     * quarantine (negative for fewer); any number that is null shows as a dash.
     */
    show(numbers) {
      for (const { key } of ITEMS) {
        const value = numbers?.[key] ?? null;
        let text = '–';
        if (value !== null && key === 'day') text = String(Math.floor(value));
        else if (value !== null && key === 'saved') text = Math.abs(value) < 1 ? '0' : value > 0 ? compact(value) : `−${compact(-value)}`;
        else if (value !== null) text = compact(value);
        if (values[key].textContent !== text) values[key].textContent = text;
      }
    },
  };
}
