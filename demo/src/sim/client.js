// The main thread's side of the simulation worker (worker.js): one promise per request.

import SimWorker from './worker.js?worker&inline';

/**
 * Starts the worker and returns its API. Each method returns a promise. Methods that return a
 * frame take an optional `spare`: a previous frame's pixel buffer, handed back for reuse.
 */
export function createClient() {
  const worker = new SimWorker();
  const pending = new Map();
  let lastId = 0;

  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(`simulation: ${data.error}`));
    else request.resolve(data.result);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    for (const request of pending.values()) request.reject(new Error(`simulation: ${event.message || 'the worker failed'}`));
    pending.clear();
  };

  const call = (type, payload = {}) => new Promise((resolve, reject) => {
    const id = ++lastId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...payload }, payload.spare ? [payload.spare] : []);
  });

  return {
    init: ({ width, height, labels, population }) => call('init', { grid: { width, height, labels, population } }),
    setColours: (colours) => call('colours', { colours }),
    reset: (run, spare) => call('reset', { ...run, spare }),
    start: (run) => call('start', run), // reset() without painting: resolves to { day, totals }
    setParams: (params) => call('params', { params }), // resolves to the day the change takes effect
    addItem: (item) => call('add', { item }),
    advance: (days, spare) => call('advance', { days, spare }),
    trace: (days, every) => call('trace', { days, every }),
    repaint: (spare) => call('repaint', { spare }),
  };
}
