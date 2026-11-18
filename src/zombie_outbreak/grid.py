"""Builds the demo's population grid: Czechia on an equal-area 1 km grid, with its regions and borders.

Reads WorldPop's 2020 population density raster for Czechia and the Natural Earth boundaries saved
by `zombie_outbreak.boundaries`, and writes demo/public/data/czechia.json.

The WorldPop raster is on a 30 arc-second lat/lon grid, so its cells are not 1 km²: at 50° N they
are about 0.6 × 0.93 km. Its values are densities (people per km²), so each cell's population is
its density times its true area. Those populations are then summed onto 1 km cells of the
ETRS89-LAEA grid (EPSG:3035), which is equal-area, so every cell is exactly 1 km².

Run with `uv run python -m zombie_outbreak.grid`.
"""

import base64
import json
import math
import zlib
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Geod, Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
import shapely
from scipy.ndimage import distance_transform_edt
from shapely.geometry import shape

# Labels: 1–14 are the Czech regions in code order, and neighbours start at NEIGHBOUR_BASE.
from .model import NEIGHBOUR_BASE

ROOT = Path(__file__).resolve().parents[2]
WORLDPOP = ROOT / "Data" / "PopDensity" / "Czechia" / "2020" / "cze_pd_2020_1km_UNadj.tif"
BOUNDARIES = ROOT / "Data" / "Boundaries" / "NaturalEarth-v5.1.2"
OUT = ROOT / "demo" / "public" / "data" / "czechia.json"

CRS = "EPSG:3035"
CELL = 1000  # metres
# Cells of neighbouring country kept around Czechia's bounding box, so every Czech cell has four
# neighbours inside the grid and the solver never has to check the grid's edges.
MARGIN = 2
# Scenario starting points: the main square of each city, as latitude and longitude.
CITIES = (
    ("Prague", 50.0875, 14.4213),
    ("Brno", 49.1951, 16.6083),
    ("Ostrava", 49.8353, 18.2925),
)
# The outbreak starts in the most populous cell within this many cells of the square.
SEED_RADIUS = 3

SOURCES = (
    {
        "name": "WorldPop, Czech Republic 2020 population density, 1 km, UN adjusted",
        "licence": "CC BY 4.0",
        "url": "https://dx.doi.org/10.5258/SOTON/WP00675",
    },
    {
        "name": "Natural Earth v5.1.2, 1:10m admin-0 and admin-1 boundaries",
        "licence": "Public domain",
        "url": "https://www.naturalearthdata.com/",
    },
)


def row_areas_km2(transform, height):
    """The true area of the source raster's cells, one value per row (it depends only on latitude)."""
    geod = Geod(ellps="WGS84")
    west, east = transform.c, transform.c + transform.a
    areas = np.empty(height)
    for row in range(height):
        north = transform.f + row * transform.e
        south = north + transform.e
        area, _ = geod.polygon_area_perimeter([west, east, east, west], [south, south, north, north])
        areas[row] = abs(area) / 1e6
    return areas


def nearest_fill(labels):
    """Copies each unlabelled (zero) cell's value from the nearest labelled cell."""
    indices = distance_transform_edt(labels == 0, return_distances=False, return_indices=True)
    return labels[tuple(indices)]


def rasterise(path, first_id, to_grid, out_shape, grid_transform):
    """Burns each feature of a GeoJSON file into a grid as first_id, first_id + 1, ... by cell centre."""
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    project = lambda xy: np.column_stack(to_grid(xy[:, 0], xy[:, 1]))  # noqa: E731
    shapes = [(shapely.transform(shape(f["geometry"]), project), first_id + i) for i, f in enumerate(features)]
    grid = rasterize(shapes, out_shape=out_shape, transform=grid_transform, fill=0, dtype="uint8")
    return [f["properties"] for f in features], grid


def encode(array):
    """A little-endian typed array, zlib-compressed and base64-encoded (DecompressionStream('deflate') reads zlib)."""
    raw = np.ascontiguousarray(array, dtype=array.dtype.newbyteorder("<")).tobytes()
    return base64.b64encode(zlib.compress(raw, 9)).decode("ascii")


def build():
    with rasterio.open(WORLDPOP) as src:
        density = src.read(1).astype(np.float64)
        valid = src.read_masks(1) > 0
        src_transform, src_crs, src_bounds = src.transform, src.crs, src.bounds

    # People in each source cell, and the area of Czechia each one covers.
    areas = np.broadcast_to(row_areas_km2(src_transform, density.shape[0])[:, None], density.shape)
    people = np.where(valid, density * areas, 0.0)
    czech_km2 = np.where(valid, areas, 0.0)

    # The target grid: Czechia's bounds in EPSG:3035, snapped outward to whole cells, plus the margin.
    west, south, east, north = transform_bounds(src_crs, CRS, *src_bounds, densify_pts=101)
    x0 = (math.floor(west / CELL) - MARGIN) * CELL
    y0 = (math.floor(south / CELL) - MARGIN) * CELL
    x1 = (math.ceil(east / CELL) + MARGIN) * CELL
    y1 = (math.ceil(north / CELL) + MARGIN) * CELL
    width, height = (x1 - x0) // CELL, (y1 - y0) // CELL
    grid_transform = from_origin(x0, y1, CELL, CELL)

    def regrid(values):
        out = np.zeros((height, width), np.float64)
        reproject(values, out, src_transform=src_transform, src_crs=src_crs,
                  dst_transform=grid_transform, dst_crs=CRS, resampling=Resampling.sum)
        return out

    population = regrid(people)
    coverage = regrid(czech_km2) / (CELL / 1000) ** 2

    # A cell is Czech if WorldPop covers at least half of it. The population of the partial cells
    # left outside moves to the nearest Czech cell, so the national total is kept.
    inside = coverage >= 0.5
    _, (rows, cols) = distance_transform_edt(~inside, return_indices=True)
    outside_people = np.where(inside, 0.0, population)
    np.add.at(population, (rows[outside_people > 0], cols[outside_people > 0]), outside_people[outside_people > 0])
    population[~inside] = 0.0

    # Regions inside Czechia and neighbouring countries outside it, each filled out to the nearest
    # boundary where Natural Earth's coarser outlines leave gaps.
    to_grid = Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform
    regions, region_grid = rasterise(BOUNDARIES / "czechia_regions.geojson", 1, to_grid, (height, width), grid_transform)
    neighbours, neighbour_grid = rasterise(BOUNDARIES / "neighbours.geojson", NEIGHBOUR_BASE, to_grid, (height, width), grid_transform)
    labels = np.where(inside, nearest_fill(region_grid), nearest_fill(neighbour_grid)).astype(np.uint8)

    counts = np.rint(population)
    if counts.max() > np.iinfo(np.uint16).max:
        raise SystemExit(f"A cell holds {counts.max():.0f} people, too many for uint16")
    counts = counts.astype(np.uint16)

    cities = []
    for name, lat, lon in CITIES:
        x, y = to_grid(lon, lat)
        col, row = int((x - x0) // CELL), int((y1 - y) // CELL)
        r = SEED_RADIUS
        window = np.where(inside[row - r:row + r + 1, col - r:col + r + 1], counts[row - r:row + r + 1, col - r:col + r + 1], 0)
        dr, dc = np.unravel_index(window.argmax(), window.shape)
        seed_row, seed_col = row - r + int(dr), col - r + int(dc)
        cities.append({"name": name, "cell": [seed_col, seed_row], "region": regions[labels[seed_row, seed_col] - 1]["code"]})

    data = {
        "about": "The population of Czechia on an equal-area 1 km grid, for the Quantifying the Quarantine demo. Written by src/zombie_outbreak/grid.py.",
        "encoding": "Each `data` field is a typed array of width × height cells, row by row from the top-left (north-west) cell, little-endian, zlib-compressed and base64-encoded.",
        "sources": list(SOURCES),
        "crs": CRS,
        "cellSize": CELL,
        "origin": [x0, y1],
        "width": int(width),
        "height": int(height),
        "population": {"total": int(counts.sum(dtype=np.int64)), "dtype": "uint16", "data": encode(counts)},
        "labels": {
            "about": f"1–{len(regions)} are the Czech regions below, and {NEIGHBOUR_BASE}+ the neighbouring countries.",
            "dtype": "uint8",
            "data": encode(labels),
        },
        "regions": [
            {
                "id": i + 1,
                "code": p["code"],
                "name": p["name"],
                "nameEn": p["name_en"],
                "cells": int((labels == i + 1).sum()),
                "population": int(counts[labels == i + 1].sum(dtype=np.int64)),
            }
            for i, p in enumerate(regions)
        ],
        "neighbours": [{"id": NEIGHBOUR_BASE + i, "code": p["code"], "name": p["name"]} for i, p in enumerate(neighbours)],
        "cities": cities,
    }
    checks = {
        "source_total": float(people.sum()),
        "grid_total_before_rounding": float(population.sum()),
        "naive_total": float(np.where(valid, density, 0).sum()),
    }
    return data, checks


def main():
    data, checks = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    print(f"Source total, density × true cell area:  {checks['source_total']:>12,.0f}")
    print(f"Naive total, density × 1 km² per cell:    {checks['naive_total']:>12,.0f}")
    print(f"Grid total, before / after rounding:      {checks['grid_total_before_rounding']:>12,.0f} / {data['population']['total']:,}")
    print(f"Grid: {data['width']} × {data['height']} cells, {sum(r['cells'] for r in data['regions']):,} of them Czech (km²)")
    for r in data["regions"]:
        print(f"  {r['code']:6} {r['nameEn']:18} {r['population']:>10,}  {r['cells']:>6,} km²")
    for c in data["cities"]:
        print(f"  start: {c['name']:8} cell {c['cell']} in {c['region']}")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1000:.0f} KB")


if __name__ == "__main__":
    main()
