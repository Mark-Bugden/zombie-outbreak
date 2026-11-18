// The build crew: one queue of cordons and seals, built in the order they were added, at a fixed
// speed in km per day (one cell edge is 1 km). There is no budget; the crew's speed is the limit.
// Work is not banked: a crew with nothing left to build waits.
//
// Only the newest item can be taken off (Undo), or all of them (Clear), so every item before the
// one being built is finished. An edge that an earlier item already covers costs nothing.
//
// The worker's engine and the main thread each keep a queue with the same items. The engine counts
// the work done and blocks the built edges; the main thread uses the same count to draw progress.

import { BLOCK_EAST, BLOCK_SOUTH } from './szr.js';

/** A queue for a grid of `cells` cells. Items are { edges, ...info }: edges from tools/cordon.js. */
export function createQueue(cells) {
  const owners = new Uint16Array(cells * 2); // how many items cover each edge
  const items = [];
  let total = 0;

  const queue = {
    items,

    /** The km of cordon in the queue, not counting edges covered twice. */
    get total() {
      return total;
    },

    /** Adds an item to the end of the queue. Its `cost` is the km of edges no earlier item covers. */
    add(item) {
      const fresh = new Uint8Array(item.edges.length);
      let cost = 0;
      item.edges.forEach((edge, j) => {
        if (owners[edge]++ === 0) {
          fresh[j] = 1;
          cost++;
        }
      });
      const added = { ...item, fresh, cost };
      items.push(added);
      total += cost;
      return added;
    },

    /** Takes off the newest item, and returns it (or undefined). */
    undo() {
      const item = items.pop();
      if (!item) return undefined;
      for (const edge of item.edges) owners[edge]--;
      total -= item.cost;
      return item;
    },

    clear() {
      items.length = 0;
      owners.fill(0);
      total = 0;
    },

    /** How many of each item's edges are built once the crew has done `work` km: an array of counts. */
    built(work) {
      let left = Math.floor(work + 1e-9);
      let waiting = false; // the crew has not reached this item yet
      return items.map((item) => {
        if (waiting) return 0;
        if (left >= item.cost) {
          left -= item.cost;
          return item.edges.length;
        }
        let count = 0;
        while (count < item.edges.length && (!item.fresh[count] || left > 0)) {
          if (item.fresh[count]) left--;
          count++;
        }
        waiting = true;
        return count;
      });
    },

    /** Sets `blocks` (BLOCK_* bits per cell, see szr.js) to the edges built after `work` km. */
    fillBlocks(work, blocks) {
      blocks.fill(0);
      queue.built(work).forEach((count, k) => {
        const { edges } = items[k];
        for (let j = 0; j < count; j++) blocks[edges[j] >> 1] |= edges[j] & 1 ? BLOCK_SOUTH : BLOCK_EAST;
      });
    },
  };
  return queue;
}
