"""Writes tests/fixtures/szr.json: runs of the reference model that the demo's JS solver must reproduce.

Each case gives a small grid (labels, population, cordon blocks), the zombies seeded, the parameters
and the number of steps, with the reference model's state at the end. demo/test/szr.test.js replays
them, and tests/test_fixtures.py checks this file still matches the model.

Run with `uv run python -m zombie_outbreak.fixtures` after any change to model.py.
"""

import base64
import json
import zlib
from dataclasses import asdict
from pathlib import Path

import numpy as np

from .model import BLOCK_EAST, BLOCK_SOUTH, NEIGHBOUR_BASE, Params, State, seed, step

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "szr.json"
GRID = ROOT / "demo" / "public" / "data" / "czechia.json"


def synthetic():
    """10 × 12 cells: two regions, neighbours on the west and east, a town, and a partial cordon."""
    height, width = 10, 12
    rows, cols = np.mgrid[0:height, 0:width]
    labels = np.where(cols < 6, 1, 2)
    labels[:, 0] = NEIGHBOUR_BASE
    labels[:, -1] = NEIGHBOUR_BASE + 1
    population = np.where(labels < NEIGHBOUR_BASE, (rows * 7 + cols * 13) % 50 * 10 + 5, 0).astype(float)
    population[4, 3] = 2000.0
    blocks = np.zeros((height, width), np.uint8)
    blocks[2:6, 7] |= BLOCK_EAST
    blocks[6, 4:8] |= BLOCK_SOUTH
    params = Params(beta=0.01, alpha=0.004, zeta=0.05, diffusion=1.0, flee=1.0)
    return "synthetic", labels, population, blocks, [(4 * width + 3, 20.0)], params, 200


def prague():
    """32 × 32 cells of the real map around Prague's start cell, with no cordons."""
    data = json.loads(GRID.read_text(encoding="utf-8"))
    shape = (data["height"], data["width"])
    decode = lambda f, t: np.frombuffer(zlib.decompress(base64.b64decode(f["data"])), t).reshape(shape)  # noqa: E731
    population, labels = decode(data["population"], "<u2"), decode(data["labels"], "<u1")
    (city,) = [c for c in data["cities"] if c["name"] == "Prague"]
    col, row = city["cell"]
    rows, cols = slice(row - 16, row + 16), slice(col - 16, col + 16)
    params = Params(beta=0.0005, alpha=0.0002, zeta=0.02, diffusion=2.0, flee=0.5)
    return ("prague", labels[rows, cols].astype(int), population[rows, cols].astype(float),
            np.zeros((32, 32), np.uint8), [(16 * 32 + 16, 50.0)], params, 300)


def run(case):
    name, labels, population, blocks, seeds, params, steps = case
    state = State.start(population)
    for cell, zombies in seeds:
        seed(state, cell, zombies)
    for _ in range(steps):
        step(state, params, labels, blocks)
    height, width = labels.shape
    return {
        "name": name,
        "width": width,
        "height": height,
        "labels": labels.ravel().tolist(),
        "population": population.ravel().tolist(),
        "blocks": blocks.ravel().tolist(),
        "seeds": [[cell, zombies] for cell, zombies in seeds],
        "params": asdict(params),
        "steps": steps,
        "expected": {
            "S": state.S.ravel().tolist(),
            "Z": state.Z.ravel().tolist(),
            "R": state.R.ravel().tolist(),
            "exported": {str(k): v for k, v in sorted(state.exported.items())},
            "cleared": state.cleared,
            "day": state.day,
        },
    }


def build():
    return {
        "about": "Runs of the reference SZR model (src/zombie_outbreak/model.py) for the JS solver to reproduce. "
                 "Arrays are row by row from the north-west cell. Written by src/zombie_outbreak/fixtures.py.",
        "cases": [run(synthetic()), run(prague())],
    }


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1000:.0f} KB")


if __name__ == "__main__":
    main()
