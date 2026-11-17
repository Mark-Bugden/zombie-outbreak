# Plan: Quantifying the Quarantine

This is the agreed plan for rebuilding this project as an interactive demo for mark-bugden.github.io. It was settled with Mark on 2026-11-17, before any code was written. The site's requirements are in `site-contract-zombie-outbreak.md`, which lives outside this repo, and in the [demo-kit README](https://github.com/Mark-Bugden/demo-kit#readme). This document covers what we're building on top of them.

## The goal

The demo puts a zombie outbreak on a real population map of Czechia. A visitor:

1. picks a starting city and a zombie strain
2. can't see the outbreak until it's detected
3. then draws cordons and seals regions, which a single building crew completes over time
4. sees how many people the quarantine saved compared with a run where nothing was done.

## The model

The model is the humans-zombies-removed (SZR) model of Munz et al. (2009), "When Zombies Attack!: Mathematical Modelling of an Outbreak of Zombie Infection", run as a reaction-diffusion system on a grid:

```
∂S/∂t = −β S Z + ∇·(χ S ∇Z)                 humans are bitten, and flee from nearby zombies
∂Z/∂t =  β S Z − α S Z + ζ R + D_Z ΔZ        zombies spread, are destroyed, and the dead rise
∂R/∂t =  α S Z − ζ R
```

- **Units.** S, Z and R are densities in people per km². The terms are mass action, so crowded cells spread the outbreak faster. The original notebook used βSI/N, which ignored density.
- **Movement.** Zombies diffuse. Humans drift down the zombie gradient, and the solver uses an upwind scheme for that term. Nothing else moves.
- **Cutoff.** On each step, any cell with fewer than about one zombie is set to zero. Without the cutoff, the deterministic model spreads vanishingly small fractions of a zombie everywhere, and no cordon could ever hold.
- **Cordons.** A cordon blocks movement across the cell edges it covers, for every compartment.
- **National border.** Zombies that cross the border leave the model. They are counted as exported to Germany, Poland, Austria or Slovakia, depending on which neighbour's border they cross.
- **Numerics.** Explicit time steps with operator splitting, and dt chosen so D·dt/dx² ≤ 0.25. The JS solver is tested against a NumPy reference implementation.

## The map

- **Population.** WorldPop 2020, UN-adjusted, 1 km. The data is already in `Data/PopDensity/Czechia/2020/`.
- **Projection fix.** The raster is 30 arc-second lat/lon. At 50°N its cells are about 0.6 × 0.93 km, or about 0.54 km², so treating them as 1 km² overcounts the population by about 1.85×. It is also why the old maps looked stretched sideways. We resample to an equal-area 1 km grid (EPSG:3035, ETRS89-LAEA) and check that the total population is about 10.7M.
- **Boundaries.** From Natural Earth (public domain), 1:10m: admin-1 for the 14 kraje, and admin-0 for the neighbouring countries in the exported tally. Both are rasterised onto the same grid.

## The experience

| | |
| --- | --- |
| Scenarios | Prague, Brno, Ostrava. |
| Strains | Munz et al. (2009), Shamblers, Frenzied and Risers, set with the kit's `preset()`. An Advanced group exposes β, α, ζ, D_Z and χ as sliders. |
| Visibility | Zombies are hidden on the map and the chart until the fixed detection day, then shown as they are. |
| Cordons | Drawn freehand while a "Draw cordon" mode is on. While it's off, the map ignores touch, so phones can still scroll. Undo and Clear. |
| Seal a region | Click a kraj, or choose it from a list. The list is the keyboard path. |
| Building | Cordons and seals join one shared queue, built in the order they were drawn at a fixed speed in km per day. There is no budget: the queue's limited speed is the constraint. |
| Baseline | A run with no quarantine is simulated alongside, so the demo can say how many people were saved. |
| Speed | 1×/2×/4×, where 1× is about 2 days per second. Play, Pause and Reset come from the kit. |
| End | When zombies are gone or on day 365, an end summary shows saved / sealed in / exported. |
| Stage | The map fills the stage, with a small S/Z/R chart over empty space and the baseline drawn faintly. |
| Copy | Plain and neutral. |

## Look

The look is called "the lights go out":

- **Dark theme.** Population as sodium-amber (`#F6BE55`) lights on the navy background, zombies glowing H-alpha red (`#C2391B`), and the dead going dark.
- **Light theme.** Ink density on the pale background, with red zombies.

These colours live as demo-local tokens in `demo/src/demo.css`, scoped to `[data-demo]`, and the chart uses them too. demo-kit v0.1.0's frame tokens predate the site's redesign. We leave them alone here, and update the kit once this demo ships (see Milestones).

Still to check: H-alpha red on the dark background has lower contrast than the site's own pairs. Test it, and adjust the zombie colour on dark if needed.

## Repo layout (target)

```
demo/                  the site bundle, built with demo-kit (see the site contract)
  src/main.js          frame, controls and wiring
  src/sim/             the model: pure functions plus the worker entry
  src/render/          map and chart drawing
  src/tools/           cordon drawing and region sealing
  public/data/         written by the prep script, and committed
  test/                node:test
src/zombie_outbreak/   Python: data prep, reference model, renders for the stills
tests/                 pytest
legacy/                the original notebooks, with outputs stripped
docs/                  this plan and the draft write-up
pyproject.toml         a uv project
```

- **Data format.** Not settled yet; to decide in step 2. Lean: one JSON file holding the grid metadata (size, cell size, CRS, origin) and base64-encoded typed arrays (population per cell as Uint16, kraj id, neighbour id for border cells). If size matters, deflate them and decode with `DecompressionStream`. The bundle must stay under 2 MB, and data files can only be `.json`, `.csv` or `.js`.
- **CI.** The site contract's `demo.yml` stays exactly as specified. Tests (node:test, pytest, and the check of JS against Python) go in a separate workflow.

## Milestones

### 0. Rewrite history (done 2026-11-17)
- [x] Use `git filter-repo` in a scratch clone to remove these paths from every commit:
  - the XYZ CSVs
  - `.ipynb_checkpoints/` and `.DS_Store`
  - `imgs/`, `movies/` and the loose images and GIFs
  - the Germany data
- [x] Mark reviews the result.
- [x] With Mark's explicit go-ahead: force-push `main` and the `v0.1.0` tag (the stub release and its zip keep working), and delete the merged `demo-stub` branch.
- Result: the packed history went from 44.9 MiB to 8.4 MiB, most of it past versions of `SketchFile.ipynb` with their outputs. GitHub keeps PR #1's commits permanently, so the old blobs stay on its servers, but fresh clones shrink.

### 1. Clean up the repo (PR)
- [x] Move the notebooks to `legacy/` with outputs stripped. Delete `streamlit/`.
- [x] Rewrite `README.md`, add a `.gitignore`, and commit this plan.

### 2. Data prep (PR)
- [ ] Set up the uv project. Reproject the population data, rasterise the kraje and neighbours, and write `demo/public/data/`.
- [ ] Sanity checks: total population, the largest cities in the right places, and the kraj populations against official figures.

### 3. Model, map and chart: release `v0.2.0`, status `in-progress`
- [ ] NumPy reference model, with pytest invariants (populations stay non-negative; S+Z+R is conserved apart from border losses).
- [ ] JS solver in a worker, tested against the NumPy model on a small grid.
- [ ] Map rendering and theming, the inset chart, scenarios and strains, the speed control, and the status line.
- [ ] Rewrite the manifest: summary, tags, and `about`. Update `built`.

### 4. Quarantine: release `v1.0.0`, status `live`
- [ ] Detection delay, freehand cordons, region sealing, and the shared build queue.
- [ ] Baseline run, saved / sealed in / exported, and the end summary.
- [ ] Render the stills from the simulation: `static.webp` at day 0, and thumb/og mid-outbreak with a cordon.
- [ ] Model card (sources: WorldPop, Natural Earth, Munz et al. 2009) and the draft write-up in `docs/writeup.md`.
- [ ] Mark bumps the tag in the site's `data/projects.yaml` and takes the write-up out of draft.

### 5. After this demo: demo-kit `v0.2.0`
- [ ] Separate PR on demo-kit: the site's redesign tokens and fonts, dark as the default, and this demo's map tokens added to the kit. Then bump this demo to the new kit version.

## Open questions

- **"Sealed in".** How exactly to count it, for example the humans inside closed areas that contain zombies at the moment of sealing. Decide while building step 4.
- **Munz parameters.** The paper uses counts in a well-mixed population of 500, so converting them to density units is a judgement call. The write-up should say so.
- **Calibration.** The strain parameters, the detection day and the build speed are set by hand so the game is balanced. The demo copy and the write-up should call them illustrative choices, not estimates.
