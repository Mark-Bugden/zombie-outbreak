# Source data

Raw inputs to the data prep in [`src/zombie_outbreak/`](../src/zombie_outbreak/). The demo never reads these directly. It reads `demo/public/data/czechia.json`, which `uv run python -m zombie_outbreak.grid` builds from them.

| Path | What it is | Licence |
| --- | --- | --- |
| `PopDensity/Czechia/2020/` | WorldPop's 2020 population density for the Czech Republic: people per km² on a 30 arc-second lat/lon grid, country total adjusted to the UN estimate. The PDF is WorldPop's description of the dataset. [doi:10.5258/SOTON/WP00675](https://dx.doi.org/10.5258/SOTON/WP00675) | CC BY 4.0 |
| `Boundaries/NaturalEarth-v5.1.2/` | Natural Earth 1:10m boundaries: the 14 Czech regions (admin-1), and Czechia's four neighbours (admin-0) clipped to a box around Czechia. Written by `uv run python -m zombie_outbreak.boundaries`. | Public domain |

The WorldPop cells are not 1 km². At Czechia's latitude they are about 0.6 × 0.93 km, so adding up the densities as if each cell were 1 km² gives about 19 million people instead of 10.7 million. The prep multiplies each density by its cell's true area before regridding.
