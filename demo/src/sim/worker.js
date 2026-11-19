// The simulation worker: runs the engine (engine.js) off the main thread. Vite inlines it into
// demo.js (client.js imports it with ?worker&inline), since the bundle allows no extra files.
//
// Requests are { id, type, ...payload }, and every reply is { id, result } or { id, error }.
// A frame's pixel buffer is transferred to the main thread, which hands it back as `spare` with a
// later request, so the buffers are reused rather than reallocated.

import { BUILD_SPEED, DETECTION_DAY, LAST_DAY } from '../strains.js';
import { createEngine } from './engine.js';

const engine = createEngine({ lastDay: LAST_DAY, detectionDay: DETECTION_DAY, buildSpeed: BUILD_SPEED });

const handlers = {
  init: ({ grid }) => engine.init(grid),
  colours: ({ colours }) => engine.setColours(colours),
  reset: (request) => (engine.reset(request), engine.frame()),
  start: (request) => (engine.reset(request), engine.sample()),
  params: ({ params }) => engine.setParams(params),
  add: ({ item }) => engine.addItem(item),
  undo: () => engine.undo(),
  clear: () => engine.clear(),
  advance: ({ days }) => (engine.advance(days), engine.frame()),
  trace: ({ days, every }) => engine.trace(days, every),
  repaint: () => engine.frame(),
};

self.onmessage = ({ data }) => {
  const { id, type, spare } = data;
  try {
    if (spare) engine.recycle(spare);
    const result = handlers[type](data);
    self.postMessage({ id, result }, result?.pixels ? [result.pixels] : []);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
