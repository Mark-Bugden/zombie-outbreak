// Counts the humans "sealed in": walled in with zombies by the quarantine. When a newly built edge
// closes off part of Czechia from the largest connected part, and that part holds zombies able to
// bite (at least `threshold` per km²), the humans in it at that moment are sealed in. Each km² is
// counted once, so a second ring inside the first adds nothing.
//
// Checking the whole map after every edge would be slow, so walls are tracked as a union-find over
// grid corners: cordon edges, plus the national border, which humans cannot cross either. An edge
// can only close off an area when its two ends are already joined by walls. Only then are the
// areas labelled.

import { NEIGHBOUR_BASE } from '../grid.js';
import { BLOCK_EAST, BLOCK_SOUTH } from './szr.js';

/** Returns { reset(), update(edges, blocks, S, Z, threshold), get total() } for a grid. */
export function createEnclosures({ width, height, labels }) {
  const cells = width * height;
  const across = width + 1; // grid corners per row
  const parent = new Int32Array(across * (height + 1));
  const walled = new Uint8Array(cells * 2); // edges already joined into the walls
  const sealed = new Uint8Array(cells); // cells already counted
  const area = new Int32Array(cells); // each cell's area id, while labelling
  const stack = new Int32Array(cells);
  let walls = 0; // cordon edges joined into the walls
  let total = 0;

  const czech = (cell) => labels[cell] < NEIGHBOUR_BASE;
  const ends = (edge) => {
    const cell = edge >> 1;
    const col = cell % width;
    const row = (cell - col) / width;
    return edge & 1
      ? [(row + 1) * across + col, (row + 1) * across + col + 1]
      : [row * across + col + 1, (row + 1) * across + col + 1];
  };
  const find = (corner) => {
    let c = corner;
    while (parent[c] !== c) {
      parent[c] = parent[parent[c]];
      c = parent[c];
    }
    return c;
  };
  /** Joins an edge's ends; true if they were already joined, so the edge closes a loop. */
  const join = (edge) => {
    const [a, b] = ends(edge).map(find);
    if (a === b) return true;
    parent[a] = b;
    return false;
  };

  // The national border: every edge between a Czech cell and a foreign one.
  const border = [];
  for (let cell = 0; cell < cells; cell++) {
    const col = cell % width;
    if (col < width - 1 && czech(cell) !== czech(cell + 1)) border.push(cell * 2);
    if (cell + width < cells && czech(cell) !== czech(cell + width)) border.push(cell * 2 + 1);
  }

  const rebuild = () => {
    for (let c = 0; c < parent.length; c++) parent[c] = c;
    walled.fill(0);
    walls = 0;
    for (const edge of border) join(edge);
  };

  /** Labels the areas of Czechia that humans can move between, and counts the newly sealed in. */
  const count = (blocks, S, Z, threshold) => {
    area.fill(-1);
    const sizes = [];
    for (let start = 0; start < cells; start++) {
      if (area[start] !== -1 || !czech(start)) continue;
      const id = sizes.length;
      let size = 0;
      let top = 0;
      stack[top++] = start;
      area[start] = id;
      while (top > 0) {
        const i = stack[--top];
        size++;
        const col = i % width;
        // The four neighbours, where no cordon is in the way.
        const next = [
          col < width - 1 && !(blocks[i] & BLOCK_EAST) ? i + 1 : -1,
          col > 0 && !(blocks[i - 1] & BLOCK_EAST) ? i - 1 : -1,
          i + width < cells && !(blocks[i] & BLOCK_SOUTH) ? i + width : -1,
          i >= width && !(blocks[i - width] & BLOCK_SOUTH) ? i - width : -1,
        ];
        for (const j of next) {
          if (j >= 0 && area[j] === -1 && czech(j)) {
            area[j] = id;
            stack[top++] = j;
          }
        }
      }
      sizes.push(size);
    }
    const largest = sizes.indexOf(Math.max(...sizes));
    const biting = new Uint8Array(sizes.length);
    for (let i = 0; i < cells; i++) if (area[i] >= 0 && Z[i] >= threshold) biting[area[i]] = 1;
    for (let i = 0; i < cells; i++) {
      const id = area[i];
      if (id >= 0 && id !== largest && biting[id] && !sealed[i]) {
        sealed[i] = 1;
        total += S[i];
      }
    }
  };

  rebuild();
  return {
    /** For a new run: nothing built, nobody sealed in. */
    reset() {
      sealed.fill(0);
      total = 0;
      rebuild();
    },

    /**
     * Takes every edge built so far (an iterable of edge ids, the same ones `blocks` shows) after
     * the cordons change, and counts anyone newly sealed in. S and Z are the model's arrays.
     */
    update(edges, blocks, S, Z, threshold) {
      const built = new Set(edges);
      if (built.size < walls) rebuild(); // an edge was taken away
      let closes = false;
      for (const edge of built) {
        if (walled[edge]) continue;
        walled[edge] = 1;
        walls++;
        if (join(edge)) closes = true;
      }
      if (closes) count(blocks, S, Z, threshold);
    },

    /** The humans sealed in so far. */
    get total() {
      return total;
    },
  };
}
