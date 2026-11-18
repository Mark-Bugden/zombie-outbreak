// Colour helpers shared by the map (main thread) and the painter (worker). No DOM access.

const RAMP_SIZE = 256;

/** Parses a CSS hex colour, #rgb or #rrggbb, into [r, g, b]. */
export function parseHex(color) {
  const hex = color.trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`colour: expected a hex colour, got "${color}"`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** Packs [r, g, b] as an opaque pixel for a Uint32Array view of ImageData (little-endian). */
export function pack([r, g, b]) {
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * RAMP_SIZE colours, as r, g, b triples in a Uint8ClampedArray, running through the stops
 * [[t, '#hex'], ...] (t from 0 to 1, increasing), interpolated linearly in RGB.
 */
export function ramp(stops) {
  const parsed = stops.map(([t, color]) => [t, parseHex(color)]);
  const table = new Uint8ClampedArray(RAMP_SIZE * 3);
  for (let i = 0; i < RAMP_SIZE; i++) {
    const t = i / (RAMP_SIZE - 1);
    let k = 1;
    while (k < parsed.length - 1 && parsed[k][0] < t) k++;
    const [t0, c0] = parsed[k - 1];
    const [t1, c1] = parsed[k];
    const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
    for (let j = 0; j < 3; j++) table[i * 3 + j] = Math.round(c0[j] + (c1[j] - c0[j]) * f);
  }
  return table;
}

/** The index into a ramp for t in [0, 1]. */
export function rampIndex(t) {
  return t <= 0 ? 0 : t >= 1 ? RAMP_SIZE - 1 : Math.round(t * (RAMP_SIZE - 1));
}
