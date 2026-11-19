// Paints the outbreak into pixels, one per cell. It runs in the worker, next to the simulation, so
// only the finished image crosses to the main thread. No DOM access.
//
// "The lights go out": each Czech cell starts from the land colour, adds light for its humans (log
// scale, the people's colour rising to white in the densest cores), and adds the stronger of two
// layers:
// - the fallen: zombies and the dead together, log-scaled like the people, in a colour mixed from
//   the zombies' colour and the dead's by their shares, so a cell with more dead than zombies looks
//   more like the dead
// - the front: the zombies' colour, rising to white, for where bites are happening now (β S Z).
// In the light theme the same arithmetic darkens pale paper instead, rising to deeper shades.

import { NEIGHBOUR_BASE } from '../grid.js';
import { pack, parseHex, ramp, rampIndex } from './colour.js';

// How strongly the fallen (zombies and dead) show, at the most crowded cell's density.
const FALLEN = 0.85;
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
  let ash = null;
  let front = null;
  let embersWeight = null; // how far each entry is from land, to pick the stronger layer
  let ashWeight = null;
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
    /** Colours as hex strings: { night, land, people, peoplePeak, zombie, frontPeak, dead }. */
    setColours(colours) {
      land = parseHex(colours.land);
      night = pack(parseHex(colours.night));
      humans = deltas(ramp([[0, colours.land], [0.9, colours.people], [1, colours.peoplePeak]]));
      embers = deltas(ramp([[0, colours.land], [1, colours.zombie]]));
      ash = deltas(ramp([[0, colours.land], [1, colours.dead]]));
      front = deltas(ramp([[0, colours.land], [0.7, colours.zombie], [1, colours.frontPeak]]));
      embersWeight = weights(embers);
      ashWeight = weights(ash);
      frontWeight = weights(front);
    },

    get ready() {
      return land !== null;
    },

    /** Paints every cell into `out` (a Uint32Array view of RGBA pixels) from S, Z and R, with bite rate β. */
    paint(out, S, Z, R, beta) {
      for (let i = 0; i < out.length; i++) {
        if (labels[i] >= NEIGHBOUR_BASE) {
          out[i] = night;
          continue;
        }
        const s = S[i];
        const z = Z[i];
        const fallen = z + R[i];
        const h = rampIndex(Math.log1p(s) / logPeak) * 3;
        let r = land[0] + humans[h];
        let g = land[1] + humans[h + 1];
        let b = land[2] + humans[h + 2];
        if (fallen > 0) {
          const e = rampIndex((FALLEN * Math.log1p(fallen)) / logPeak);
          const f = z > 0 ? rampIndex((FRONT * Math.log1p(beta * s * z)) / logPeak) : 0;
          const red = z / fallen; // the zombies' share; the rest are dead
          if (frontWeight[f] > red * embersWeight[e] + (1 - red) * ashWeight[e]) {
            r += front[f * 3];
            g += front[f * 3 + 1];
            b += front[f * 3 + 2];
          } else {
            const k = e * 3;
            r += red * embers[k] + (1 - red) * ash[k];
            g += red * embers[k + 1] + (1 - red) * ash[k + 1];
            b += red * embers[k + 2] + (1 - red) * ash[k + 2];
          }
        }
        // pack(), inlined: this loop runs for every cell on every frame. The mixed layer leaves
        // fractions, which the shift below truncates.
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        b = b < 0 ? 0 : b > 255 ? 255 : b;
        out[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      }
    },
  };
}
