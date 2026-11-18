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
∂S/∂t = −β S Z [Z ≥ θ] + ∇·(χ S ∇z)                 humans are bitten, and flee from zombies
∂Z/∂t =  β S Z [Z ≥ θ] − α S Z + ζ R + D_Z ΔZ        zombies spread, are destroyed, and the dead rise
∂R/∂t =  α S Z − ζ R                                  where z = Z / (S + Z) is the zombie share
```

The reference implementation is `src/zombie_outbreak/model.py`, whose docstring gives the exact step. `demo/src/sim/szr.js` is its port.

- **Units.** S, Z and R are densities in people per km². The terms are mass action, so crowded cells spread the outbreak faster. The original notebook used βSI/N, which ignored density.
- **Movement.** Zombies diffuse. Humans flee down the gradient of the zombie *share* z, upwind. Using the share rather than Z keeps the flow bounded at any density. Nothing else moves.
- **Cutoff.** Zombies can bite only in cells with at least θ ≈ 1 zombie per km². This is Brunet and Derrida's cutoff for pulled fronts. Without it, the deterministic model spreads vanishingly small fractions of a zombie everywhere, they all grow, and no cordon could ever hold. With it, a thin tail of zombies ahead of the front, or past a cordon, can drift and be destroyed but cannot seed new outbreaks.
  - The first plan was to set such cells to zero on each step instead. Taken literally, that stalls fronts in sparse areas, because a cell can never build up to one zombie over several steps, and it makes results depend on dt.
  - Cells under ε = 0.001 zombies are still cleared, to keep the arrays clean. They are counted, so the books balance.
- **Cordons.** A cordon blocks movement across the cell edges it covers, for every compartment.
- **National border.** Zombies that cross the border leave the model. They are counted as exported to Germany, Poland, Austria or Slovakia, depending on which neighbour's border they cross. Humans don't cross the border, so fleeing stays inside Czechia.
- **Numerics.** Each step is split into encounters, wandering, fleeing and clean-up, in that order. Encounters use an exponential update (S·(1 − e^(−βZ dt)) and so on), which matches the equations to first order and keeps every compartment non-negative at any dt. The step needs D·dt ≤ 0.2 km² and 4χ·dt ≤ 1. The textbook stability limit for diffusion is 0.25, but at it a checkerboard pattern flips sign every step and never decays. That showed up as hatching in the first strain trials.

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

These colours come from demo-kit v0.2.0's tokens, which match the site's design. The map reads `--color-bg`, `--color-surface`, `--color-text`, `--color-border` and `--color-curve`, and will read `--color-halpha` for zombies in 3c. The one demo-local token is `--zo-people` in `demo/src/demo.css`: sodium amber on dark, `--color-muted` on light. Like the kit, the demo is dark unless `<html data-theme="light">`.

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

- **Data format (settled in step 2).** One file, `demo/public/data/czechia.json`, about 140 KB. It holds the grid's metadata (size, cell size, CRS, origin), the regions, neighbours and city starts, and two typed arrays: population per cell (Uint16) and labels (Uint8: 1–14 are kraje, 21–24 are AT/DE/PL/SK). Both arrays are zlib-compressed and base64-encoded, and `demo/src/grid.js` decodes them with `DecompressionStream`. The grid is 511 × 319 cells with a margin of neighbouring country at least 2 cells deep, so every Czech cell has four neighbours inside the grid. The bundle must stay under 2 MB, and data files can only be `.json`, `.csv` or `.js`.
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
- [x] Set up the uv project. Reproject the population data, rasterise the kraje and neighbours, and write `demo/public/data/`.
- [x] Sanity checks: total population, the largest cities in the right places, and the kraj populations against official figures.
- Results:
  - The total is 10.75M (the 1 km² assumption gave 19.3M), and the regridding keeps it exactly.
  - The Czech cells cover 78,653 km², against an official area of 78,871 km².
  - Each city start lands in its own kraj.
- Caveats:
  - Natural Earth's 1:10m Moravian-Silesian/Olomouc boundary is coarse. Moravian-Silesian gets about 5,800 km², compared with about 5,400 km² officially.
  - WorldPop puts 1.56M people in Central Bohemia, against ČSÚ's 1,385,141 on 1 Jan 2020 (12.5% high). Its area is right (10,914 km² against ČSÚ's 10,928), so the excess is WorldPop's distribution, which is only constrained to the national total, not the regridding. Moravian-Silesian is 2% low (1.18M against 1,200,539). Both caveats affect only the per-region totals.

### 3. Model, map and chart: release `v0.2.0`, status `in-progress`
Split into three PRs.

**3a. The map (PR)**
- [x] Draw the population grid on the stage: "lights go out" colours from demo-local `--zo-*` tokens, light and dark themes, region and national borders, and a status-line readout of the cell under the pointer.
- [x] Checked in Edge: standalone, with phone layout, and embedded as the site does it (under `/demos/zombie-outbreak/`, with `data-embedded` and `data-theme`).

**3b. The model (PR)**
- [x] NumPy reference model (`src/zombie_outbreak/model.py`), with pytest checks:
  - one cell follows Munz's equations (solved with SciPy), converging at first order in dt
  - nobody's count goes negative, and the total is conserved once exports and clearing are counted
  - the cutoff, fleeing, border export, cordons, and the stability guard.
- [x] JS solver (`demo/src/sim/szr.js`). It replays two fixtures written from the reference model (`tests/fixtures/szr.json`) to within 1e-14 relative.
  - Speed on the full grid (163,009 cells, Node 24 on Mark's PC): about 1.6 ms per step early in an outbreak, and 4 ms with zombies everywhere.
  - It only visits Czech cells and the rim just across the border, and skips work that would only add zeros. Both shortcuts are exact.

**3c. Running it (PR, then release)**
- [x] Run the solver in a worker (`demo/src/sim/worker.js`, inlined into `demo.js` with `?worker&inline`).
  - The worker also paints each frame (`render/paint.js`), so only one pixel buffer crosses to the main thread. That buffer is handed back and reused.
  - The worker's logic is a plain module (`sim/engine.js`) that Node tests drive directly.
  - The main thread keeps the clock at 2 simulated days per second at 1×. Measured in Edge: 1.99 at 1× and 7.99 at 4×.
  - Still for step 4: the baseline. It doesn't depend on anything the visitor does, so it can run ahead in the same worker, or once per scenario and strain.
- [x] The outbreak on the map, the inset chart, scenarios and strains, the speed control, and the live status line with a hover readout.
  - **Rendering.** Mark chose brighter embers. People are amber light, sodium to white. Zombies are drawn as either embers (steady red where they hold the land) or the front (bright red rising to white where bites are happening now, from β S Z), whichever is stronger. The dead add nothing.
  - **Chart.** Drawn on the canvas rather than with Observable Plot, which would add a few hundred KB for three lines. It sits in the empty corner above Moravia and is hidden on stages narrower than 560 px.
  - **Strains,** tuned on the full map with Mark (2026-11-18). These are illustrative settings, not estimates. Flee χ = 0.5 in all of them, and dt = 0.1 day.

    | Strain | β | α | ζ | D | From Prague: Brno / Ostrava reached |
    | --- | --- | --- | --- | --- | --- |
    | Munz et al. (2009) | 0.0095 | 0.005 | 0.0001 | 1.0 | day 137 / 196 |
    | Shamblers | 0.005 | 0.003 | 0.001 | 0.8 | day 232 / 328 |
    | Frenzied | 0.015 | 0.003 | 0.001 | 2.0 | day 60 / 86 |
    | Risers | 0.007 | 0.010 | 0.3 | 1.0 | day 236 / 338 |

    - The Munz values are verified against the paper: page 5 ("Values used in Figure 3 were α = 0.005, β = 0.0095, ζ = 0.0001 and δ = 0.0001") and its code (`N = 500`). We read N = 500 as 500 people per km² and drop δ, since there are no natural deaths over a year.
    - Because transmission is mass action, cities fall within days (Prague's core is about 5,000 per km²), and the front then slows to 1–2 km a day in the countryside.
    - The first trial set Frenzied's D to 2.5 (D·dt = 0.25), which showed checkerboard hatching. That's why the step now requires D·dt ≤ 0.2.
- [x] Rewrite the manifest: status `in-progress`, the summary, tags and `about`, with the WorldPop credit its CC BY licence requires, and `built`.
- [x] Render the stills from the demo (`scripts/stills.py`): `static.webp` on day 0, and thumb/og with Munz from Prague on day 120. Step 4 re-runs it with a cordon.

### 4. Quarantine: release `v1.0.0`, status `live`
- [ ] Detection delay, freehand cordons, region sealing, and the shared build queue.
- [ ] Baseline run, saved / sealed in / exported, and the end summary.
- [ ] Re-render the stills (`scripts/stills.py`), with thumb/og showing a cordon.
- [ ] Model card (sources: WorldPop, Natural Earth, Munz et al. 2009) and the draft write-up in `docs/writeup.md`.
- [ ] Mark bumps the tag in the site's `data/projects.yaml` and takes the write-up out of draft.

### 5. demo-kit `v0.2.0` (done 2026-11-18, ahead of schedule)
- [x] Separate PR on demo-kit, done by another agent: the site's redesign tokens and fonts, dark as the default, and the tokens this demo's map needs (`--color-curve`, `--color-sodium`, `--color-halpha`).
- [x] Bump this demo to it. The map's colours now come from the kit's tokens, and its pixels are unchanged apart from the stage's rounded corners.

## Open questions

- **"Sealed in".** How exactly to count it, for example the humans inside closed areas that contain zombies at the moment of sealing. Decide while building step 4.
- **Munz parameters.** The paper uses counts in a well-mixed population of 500, so converting them to density units is a judgement call. The write-up should say so.
- **Calibration.** The strain parameters, the detection day and the build speed are set by hand so the game is balanced. The demo copy and the write-up should call them illustrative choices, not estimates.
