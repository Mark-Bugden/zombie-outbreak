# Quantifying the Quarantine

A simulation of a zombie outbreak across a real population map of Czechia, with quarantine tools. Visitors pick a city and a zombie strain, then draw cordons and seal regions to stop the outbreak. The demo reports how many people the quarantine saved compared with doing nothing.

The model is the humans–zombies–removed (SZR) model of Munz et al. (2009), run as a reaction-diffusion system on a 1 km population grid.

**Status:** being rebuilt. The demo bundle currently released for the site is a stub. The plan, design decisions and milestones are in [docs/plan.md](docs/plan.md).

## Repository layout

| Path | What it is |
| --- | --- |
| [`demo/`](demo/) | The interactive demo for [mark-bugden.github.io](https://mark-bugden.github.io/), built with [demo-kit](https://github.com/Mark-Bugden/demo-kit). Its README explains how to run and build it. |
| [`Data/`](Data/) | Source data: WorldPop's 2020 population density raster for Czechia (see below). |
| [`docs/`](docs/) | The plan, and later the write-up. |
| [`legacy/`](legacy/) | The original 2023 notebooks, kept for reference. |

## Running the demo

```sh
cd demo
npm install
npm run dev
```

## Data

Population density comes from WorldPop: Czech Republic, 2020, 1 km resolution (30 arc-seconds), with country totals adjusted to match the UN estimates. It is available under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

> WorldPop (www.worldpop.org - School of Geography and Environmental Science, University of Southampton; Department of Geography and Geosciences, University of Louisville; Departement de Geographie, Universite de Namur) and Center for International Earth Science Information Network (CIESIN), Columbia University (2018). Global High Resolution Population Denominators Project - Funded by The Bill and Melinda Gates Foundation (OPP1134076). https://dx.doi.org/10.5258/SOTON/WP00675

## Licence

The code is under the [MIT License](LICENSE). The WorldPop data in [`Data/`](Data/) is not covered by it: it stays under its own CC BY 4.0 licence (see Data above).

## History

The project started in February 2023 as a pair of Jupyter notebooks and a Streamlit app. They ran an SIR model with migration on population maps of Germany and Czechia. In November 2026 it was rebuilt as an interactive browser demo. The repository history was rewritten at the same time to remove generated images and duplicate data files. The notebooks remain in [`legacy/`](legacy/).
