// Paints the outbreak into pixels, one per cell. It runs in the worker, next to the simulation, so
// only the finished image crosses to the main thread. No DOM access.
//
// "The lights go out": each Czech cell starts from the land colour, adds light for its humans (log
// scale, sodium amber rising to white in the densest cores), and adds the stronger of two zombie
// layers:
// - embers: a steady red for the zombies holding the cell
// - the front: a bright red, rising to white, for where bites are happening now (β S Z).
// The dead add nothing, so a burnt-out cell goes dark. In the light theme the same arithmetic
// darkens pale paper with ink and red instead.

import { NEIGHBOUR_BASE } from '../grid.js';
import { pack, parseHex, ramp, rampIndex } from './colour.js';

// How strongly zombies holding a cell show, at the most crowded cell's density.
const EMBERS = 0.85;
// The front's brightness scale: bites per km² per day, log-scaled like the people, doubled.
const FRONT = 2;

/**
 * A painter for a grid of `labels`. `population` (people per cell at the start) sets the log
 * scale, so the map darkens as people are lost instead of rescaling.
 */
export function createPainter({ labels, population }) {
  const logPeak = Math.log1p(population.reduce((max, people) => Math.max(max, people), 0));
  let land = null;
  let night = 0;
  let humans = null; // the ramp's colours minus land, r, g, b per entry
  let embers = null;
  let front = null;
  let embersWeight = null; // how far each entry is from land, to pick the stronger zombie layer
  let frontWeight = null;

  const deltas = (table) => {
    const out = new Int16Array(table.length);
    for (let i = 0; i < table.length; i++) out[i] = table[i] - land[i % 3];
    return out;
  };
  const weights = (delta) => {
    const out = new Float32Array(delta.length / 3);
    for (let i = 0; i < out.length; i++) out[i] = Math.abs(delta[i * 3]) + Math.abs(delta[i * 3 + 1]) + Math.abs(delta[i * 3 + 2]);
    return out;
  };

  return {
    /** Colours as hex strings: { night, land, people, peak, zombie }. */
    setColours(colours) {
      land = parseHex(colours.land);
      night = pack(parseHex(colours.night));
      humans = deltas(ramp([[0, colours.land], [0.9, colours.people], [1, colours.peak]]));
      embers = deltas(ramp([[0, colours.land], [1, colours.zombie]]));
      front = deltas(ramp([[0, colours.land], [0.7, colours.zombie], [1, colours.peak]]));
      embersWeight = weights(embers);
      frontWeight = weights(front);
    },

    get ready() {
      return land !== null;
    },

    /** Paints every cell into `out` (a Uint32Array view of RGBA pixels) from S and Z, with bite rate β. */
    paint(out, S, Z, beta) {
      for (let i = 0; i < out.length; i++) {
        if (labels[i] >= NEIGHBOUR_BASE) {
          out[i] = night;
          continue;
        }
        const s = S[i];
        const z = Z[i];
        const h = rampIndex(Math.log1p(s) / logPeak) * 3;
        let r = land[0] + humans[h];
        let g = land[1] + humans[h + 1];
        let b = land[2] + humans[h + 2];
        if (z > 0) {
          const e = rampIndex((EMBERS * Math.log1p(z)) / logPeak);
          const f = rampIndex((FRONT * Math.log1p(beta * s * z)) / logPeak);
          if (frontWeight[f] > embersWeight[e]) {
            r += front[f * 3];
            g += front[f * 3 + 1];
            b += front[f * 3 + 2];
          } else {
            r += embers[e * 3];
            g += embers[e * 3 + 1];
            b += embers[e * 3 + 2];
          }
        }
        // pack(), inlined: this loop runs for every cell on every frame.
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        b = b < 0 ? 0 : b > 255 ? 255 : b;
        out[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      }
    },
  };
}
