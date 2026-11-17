// The population grid: Czechia on an equal-area 1 km grid, from public/data/czechia.json, which
// src/zombie_outbreak/grid.py writes. Each `data` field in the file is a typed array of
// width × height cells, row by row from the north-west corner, little-endian, zlib-compressed and
// base64-encoded.

import { loadJSON } from '@mark-bugden/demo-kit/loader';

const ARRAYS = { uint8: Uint8Array, uint16: Uint16Array };

async function decodeField({ dtype, data }, cells) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  // Typed arrays use the platform's byte order, which is little-endian everywhere the demo runs.
  const array = new ARRAYS[dtype](await new Response(inflated).arrayBuffer());
  if (array.length !== cells) throw new Error(`grid: expected ${cells} cells, got ${array.length}`);
  return array;
}

/**
 * Decodes the parsed czechia.json into
 * { width, height, cellSize, origin, total, population, labels, regions, neighbours, cities, sources }.
 * population (Uint16Array) holds the people in each cell. labels (Uint8Array) holds each cell's
 * region id (1–14, Czech) or neighbouring country id (21+), as listed in regions and neighbours.
 */
export async function decodeGrid(json) {
  const { width, height, cellSize, origin, regions, neighbours, cities, sources } = json;
  const [population, labels] = await Promise.all([
    decodeField(json.population, width * height),
    decodeField(json.labels, width * height),
  ]);
  return { width, height, cellSize, origin, total: json.population.total, population, labels, regions, neighbours, cities, sources };
}

/** Fetches and decodes data/czechia.json from beside demo.js. Options are loadJSON's. */
export async function loadGrid(options) {
  return decodeGrid(await loadJSON('data/czechia.json', options));
}
