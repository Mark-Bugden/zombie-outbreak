# Legacy notebooks

These are the project's original notebooks from February–March 2023, kept for reference. Their outputs have been stripped, and they are no longer maintained.

| Notebook | What it is |
| --- | --- |
| `SketchFile.ipynb` | The working notebook: it loads the population raster, runs an SIR model with migration on Germany's map, and renders the GIF. |
| `GenerateGifs.ipynb` | An unfinished attempt to turn the sketch into reusable functions. |

They will not run as they are. They expect the Germany data, which has been removed, and paths relative to the repository root. They also have known modelling problems, which the new demo fixes. [`docs/plan.md`](../docs/plan.md) lists them: the cell areas, density-independent transmission, losses at the border, and leakage through cordons.
