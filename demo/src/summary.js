// The end summary: when a run ends, a card under the map gives four numbers. Survived, saved
// (compared with the baseline, the same run with no quarantine), sealed in (walled in with
// zombies, see sim/enclosures.js) and exported (zombies that crossed the border).

import { compact } from './render/chart.js';

function stat(term, value, note) {
  const item = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  const big = document.createElement('span');
  big.className = 'zo-stat';
  big.textContent = value;
  const small = document.createElement('span');
  small.className = 'zo-note';
  small.textContent = note;
  dd.append(big, small);
  item.append(dt, dd);
  return item;
}

/** "Germany, Poland and Austria". */
function list(names) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

/** A summary card appended to `container`, hidden until show(). */
export function createSummary(container) {
  const el = document.createElement('section');
  el.className = 'zo-summary';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  container.append(el);

  return {
    /**
     * Shows the summary: { day, diedOut, humans, total, baseline (the baseline's surviving humans,
     * or null while it runs), sealedIn, exports: [{ name, zombies }] }.
     */
    show({ day, diedOut, humans, total, baseline, sealedIn, exports }) {
      const title = document.createElement('h3');
      title.textContent = diedOut ? `The outbreak died out on day ${Math.round(day)}.` : `Day ${Math.round(day)}: the run is over.`;

      let saved = ['Comparing…', 'with no quarantine'];
      if (baseline !== null) {
        const difference = humans - baseline;
        const amount = compact(Math.abs(difference));
        const note = `compared with no quarantine, where ${compact(baseline)} survive`;
        saved = Math.abs(difference) < 1 ? ['0', note] : [difference > 0 ? amount : `−${amount}`, note];
      }
      const crossed = exports.filter((e) => e.zombies >= 1).sort((a, b) => b.zombies - a.zombies);
      const exported = crossed.reduce((sum, e) => sum + e.zombies, 0);

      const items = document.createElement('dl');
      items.append(
        stat('Survived', compact(humans), `of ${compact(total)} people`),
        stat('Saved', ...saved),
        stat('Sealed in', compact(sealedIn), 'people walled in with zombies'),
        stat('Exported', compact(exported), crossed.length ? `zombies crossed into ${list(crossed.map((e) => e.name))}` : 'zombies crossed the border'),
      );
      el.replaceChildren(title, items);
      el.hidden = false;
    },

    hide() {
      el.hidden = true;
    },
  };
}
