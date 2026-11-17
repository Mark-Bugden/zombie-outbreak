"""Fetches the Natural Earth boundaries the demo needs, and saves a small subset of them in Data/.

The 14 Czech regions (kraje) come from admin-1, and Czechia's four neighbours from admin-0. Both
are 1:10m layers from Natural Earth (public domain), pinned to one release. The neighbours are
clipped to a box around Czechia, since the demo only needs to know which country lies across
each stretch of the border.

Run with `uv run python -m zombie_outbreak.boundaries`. It downloads about 55 MB once.
"""

import json
import urllib.request
from pathlib import Path

from shapely.geometry import box, mapping, shape

NE_TAG = "v5.1.2"
NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{tag}/geojson/{layer}.geojson"
OUT_DIR = Path(__file__).resolve().parents[2] / "Data" / "Boundaries" / f"NaturalEarth-{NE_TAG}"

NEIGHBOURS = ("AUT", "DEU", "POL", "SVK")
# Lon/lat box around Czechia (12.1–18.9° E, 48.6–51.1° N) with a margin of about 100 km.
CLIP_BOX = box(10.5, 47.5, 20.5, 52.0)
# Decimal places kept in coordinates: 4 is about 10 m, far finer than the 1 km grid.
DIGITS = 4
# Natural Earth v5.1.2 truncates this region's English name.
NAME_EN_FIXES = {"Plzeň-": "Plzeň"}


def download(layer):
    with urllib.request.urlopen(NE_URL.format(tag=NE_TAG, layer=layer)) as response:
        return json.load(response)


def rounded(geometry):
    """Returns the geometry as GeoJSON with every coordinate rounded to DIGITS places."""

    def walk(coords):
        if isinstance(coords[0], (int, float)):
            return [round(c, DIGITS) for c in coords]
        return [walk(c) for c in coords]

    geojson = mapping(geometry)
    return {"type": geojson["type"], "coordinates": walk(geojson["coordinates"])}


def write(path, features):
    collection = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{path.relative_to(OUT_DIR.parents[2])}: {len(features)} features, {path.stat().st_size / 1000:.0f} KB")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    regions = []
    for feature in download("ne_10m_admin_1_states_provinces")["features"]:
        p = feature["properties"]
        if p["adm0_a3"] != "CZE":
            continue
        regions.append({
            "type": "Feature",
            "properties": {
                "code": p["iso_3166_2"],
                "name": p["name"],
                "name_en": NAME_EN_FIXES.get(p["name_en"], p["name_en"]),
            },
            "geometry": rounded(shape(feature["geometry"])),
        })
    regions.sort(key=lambda f: f["properties"]["code"])
    if len(regions) != 14:
        raise SystemExit(f"Expected Czechia's 14 regions in Natural Earth admin-1, found {len(regions)}")
    write(OUT_DIR / "czechia_regions.geojson", regions)

    neighbours = []
    for feature in download("ne_10m_admin_0_countries")["features"]:
        p = feature["properties"]
        if p["ADM0_A3"] not in NEIGHBOURS:
            continue
        neighbours.append({
            "type": "Feature",
            "properties": {"code": p["ISO_A2"], "name": p["NAME_EN"]},
            "geometry": rounded(shape(feature["geometry"]).intersection(CLIP_BOX)),
        })
    neighbours.sort(key=lambda f: f["properties"]["code"])
    write(OUT_DIR / "neighbours.geojson", neighbours)


if __name__ == "__main__":
    main()
