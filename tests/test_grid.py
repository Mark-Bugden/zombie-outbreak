"""Checks the committed population grid, demo/public/data/czechia.json, that zombie_outbreak.grid writes."""

import base64
import json
import zlib
from pathlib import Path

import numpy as np
import pytest

GRID = Path(__file__).resolve().parents[1] / "demo" / "public" / "data" / "czechia.json"
DTYPES = {"uint8": "<u1", "uint16": "<u2"}


@pytest.fixture(scope="module")
def grid():
    data = json.loads(GRID.read_text(encoding="utf-8"))
    shape = (data["height"], data["width"])

    def decode(field):
        raw = zlib.decompress(base64.b64decode(field["data"]))
        return np.frombuffer(raw, dtype=DTYPES[field["dtype"]]).reshape(shape)

    return data, decode(data["population"]), decode(data["labels"])


def test_total_matches_the_data_and_czechia(grid):
    data, population, _ = grid
    assert population.sum(dtype=np.int64) == data["population"]["total"]
    # WorldPop's UN-adjusted 2020 total for Czechia is about 10.7 million. Counting each 30"
    # cell as 1 km², as the original notebooks did, gives about 19 million.
    assert 10_500_000 < data["population"]["total"] < 10_900_000


def test_cells_are_square_kilometres(grid):
    data, _, labels = grid
    assert data["crs"] == "EPSG:3035" and data["cellSize"] == 1000
    # Czechia covers 78,871 km², so on an equal-area 1 km grid it should cover about that many cells.
    assert 78_000 < (labels < 21).sum() < 79_500


def test_every_cell_is_a_region_or_a_neighbour(grid):
    data, _, labels = grid
    region_ids = {r["id"] for r in data["regions"]}
    neighbour_ids = {n["id"] for n in data["neighbours"]}
    assert region_ids == set(range(1, 15))
    assert {n["code"] for n in data["neighbours"]} == {"AT", "DE", "PL", "SK"}
    assert set(np.unique(labels)) == region_ids | neighbour_ids


def test_nobody_lives_outside_czechia(grid):
    _, population, labels = grid
    assert population[labels >= 21].sum() == 0


def test_the_grid_edge_is_all_neighbour(grid):
    # The solver relies on this to skip bounds checks.
    _, _, labels = grid
    edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    assert (edge >= 21).all()


def test_region_summaries_match_the_cells(grid):
    data, population, labels = grid
    for region in data["regions"]:
        cells = labels == region["id"]
        assert region["cells"] == cells.sum()
        assert region["population"] == population[cells].sum(dtype=np.int64)
    by_code = {r["code"]: r for r in data["regions"]}
    # Prague is the densest region by far.
    densities = {code: r["population"] / r["cells"] for code, r in by_code.items()}
    assert max(densities, key=densities.get) == "CZ-PR"


@pytest.mark.parametrize("city, region", [("Prague", "CZ-PR"), ("Brno", "CZ-JM"), ("Ostrava", "CZ-MO")])
def test_cities_start_in_their_region(grid, city, region):
    data, population, labels = grid
    (start,) = [c for c in data["cities"] if c["name"] == city]
    col, row = start["cell"]
    assert start["region"] == region
    assert data["regions"][labels[row, col] - 1]["code"] == region
    assert population[row, col] > 1000
