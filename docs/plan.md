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
| Strains | Munz et al. (2009), Shamblers, Frenzied and Risers, chosen from a select. An Advanced group exposes β, α, ζ, D_Z and χ as sliders. |
| Visibility | Until the fixed detection day, the outbreak is hidden on the map, the chart and the status line: the map shows the starting population. Then it is shown as it is. Visitors know the starting city from the scenario. |
| Cordons | Drawn freehand while a "Draw cordon" mode is on. While it's off, the map ignores touch, so phones can still scroll. Undo and Clear. A stroke follows the grid lines between cells, so it is watertight. Proposed in 4a, not yet agreed: a stroke that ends near its start closes into a loop, and its ends join a nearby cordon or the national border. |
| Seal a region | Click a kraj, or choose it from a list. The list is the keyboard path. A seal closes the kraj's borders with other kraje only, so zombies can still cross its stretch of national border (Mark, 2026-11-18). A sealed kraj can't be sealed twice; only Undo and Clear remove a seal. |
| Building | Cordons and seals join one shared queue, built in the order they were drawn at a fixed speed in km per day, from the detection day on. One cell edge is 1 km. Proposed in 4a, not yet agreed: an edge another item already covers costs nothing. There is no budget: the queue's limited speed is the constraint. Plans can be drawn before detection. The run doesn't pause on detection (Mark, 2026-11-18). |
| Baseline | A run with no quarantine is simulated alongside, so the demo can say how many people were saved. Changes to the Advanced sliders apply live to both: the baseline re-runs from day 0 with each change on the same day (Mark, 2026-11-18). |
| Speed | 1×/2×/4×, where 1× is about 2 days per second. Play, Pause and Reset come from the kit. Reset, a new city or a new strain clears every cordon and seal (Mark, 2026-11-18). |
| End | When zombies are gone or on day 365, an end summary shows saved / sealed in / exported. "Sealed in" counts the humans in each area cut off from the largest connected part of Czechia that holds zombies able to bite (≥ 1 per km²) at the moment it closes. Each km² counts once (Mark, 2026-11-18). |
| Stage | The map fills the stage, with a small S/Z/R chart over empty space and the baseline drawn faintly. |
| Copy | Plain and neutral. |

## Look

The look is called "the lights go out":

- **Dark theme.** Population as sodium-amber (`#f6be55`) lights on the navy background, zombies glowing ember red (`#c13c36`), and the dead going dark.
- **Light theme.** Ink density on the pale background: viridis-blue (`#285388`) people and green (`#5ca24c`) zombies.

Since step 10, these colours are demo-kit v0.4.0's colour roles, which the site shares: people take the main highlight (`--color-accent`) and zombies the contrasting one (`--color-accent-2`), in the map and the chart. The map also reads `--color-bg`, `--color-surface`, `--color-text`, `--color-border` and `--color-curve`. The demo's own colours, in `demo/src/demo.css`, are the densest people and the front at its strongest (`--zo-people-peak`, `--zo-front-peak`) and the dead (`--zo-dead`). Like the kit, the demo is dark unless `<html data-theme="light">`.

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
  - Still for step 4: the baseline. It doesn't depend on anything the visitor does, so it can run ahead in a second worker (4b).
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
- [x] Released `v0.2.0` on 2026-11-18 ([release](https://github.com/Mark-Bugden/zombie-outbreak/releases/tag/v0.2.0)), after checking the downloaded zip with the validator.
  - To show it on the site, Mark bumps the tag in the site's `data/projects.yaml`. The project is listed only once its write-up isn't a draft.

### 4. Quarantine: release `v1.0.0`, status `live`
Split into three PRs, like step 3.

**4a. The quarantine tools (PR)**
- [x] Detection delay, freehand cordons, region sealing, and the shared build queue.
  - **Cordons** (`tools/cordon.js`). A stroke snaps to grid corners and follows the grid lines between them, one cell edge at a time, so it has no gaps. Tests check that random closed loops are watertight, and that zombies never cross a closed ring around Prague on the real map.
  - **Seals.** A seal is the kraj's borders with other kraje, traced as paths so the crew builds it like a drawn line. Tests check that a seal encloses exactly its kraj.
  - **The crew** (`sim/crew.js`). One queue, in the order drawn. The worker's engine counts the km built and blocks each edge as it is finished; the main thread keeps a copy of the queue to draw it: built cordon solid, planned dashed, and a dot where the crew is working.
  - **Hidden, then truth.** Until the detection day, the worker paints the starting population with no zombies, the chart is empty, and the status line and hover readout show only where people live.
  - Building every edge as it is finished costs about 1.1 ms per step while the crew works (3.8 ms against 2.7 ms, Node, on the full map).
- [x] Calibrated with Mark (2026-11-18): **detection on day 7, and a crew building 40 km a day.** These are illustrative choices, made so that a quarantine can win but has to be quick and generous. Trials used the real engine, with the plan drawn on detection day: a ring centred on the starting city some margin beyond the visible outbreak (cells with at least one zombie), or a straight north–south line across the country 20 km beyond it. Survivors on day 365, out of 10.75M:

  | Strain, city | Reach on day 7 | Narrowest ring that held | A tighter ring | Line | No quarantine |
  | --- | --- | --- | --- | --- | --- |
  | Munz, Prague | 30 km | +20 km: 396 km, closed day 17, 8.17M | +10 km: 0.02M | 5.33M | 0.02M |
  | Munz, Brno | 23 km | +10 km: 268 km, 9.91M | | 6.79M | 0.02M |
  | Munz, Ostrava | 25 km | +10 km: 142 km, 9.77M | | 9.25M | 0.02M |
  | Frenzied, Prague | 44 km | +65 km: 654 km, closed day 24, 5.17M | +45 km: 0.06M | 5.08M | 0.02M |
  | Frenzied, Brno | 36 km | +30 km: 373 km, 8.96M | +20 km: 0.02M | 6.54M | 0.02M |
  | Frenzied, Ostrava | 42 km | +10 km: 156 km, 9.56M | | 8.91M | 0.02M |
  | Shamblers, Prague / Brno / Ostrava | 24 / 18 / 19 km | +10 km: 8.54 / 10.01 / 9.90M | | 5.51 / 6.91 / 9.35M | 0.06 / 0.54 / 2.58M |
  | Risers, Prague / Brno / Ostrava | 24 / 17 / 19 km | +10 km: 8.54 / 10.03 / 9.92M | | 5.49 / 6.92 / 9.35M | 0.05 / 0.44 / 2.67M |

  - Every ring either held completely or failed completely: a failed ring left 0.02–0.06M alive, as with no quarantine. In the failures drawn for the montage, the zombies escaped through the stretch built last.
  - A city falls within about 3 days (1.43M people are bitten by day 3 under Munz from Prague), and by detection zombies are 17–44 km out. Sealing only the starting kraj never holds around Prague, whose kraj is about 13 km in radius. It holds around Ostrava against every strain but Frenzied (Moravian-Silesian, 232 km, closed on day 13: with Munz, 9.57M survive and 400k zombies are exported), and around Brno only against Risers (South Moravian, 418 km, closed on day 18). Once a city has fallen, fronts move about 1.5 km a day (Munz) and 3.3 km a day (Frenzied), from Prague between days 14 and 42. A ring costs about 8 km per km of radius, so it can only win if the crew outbuilds the front by about that factor.
  - Ostrava is easy for every strain: half of any ring around it lies outside Czechia, where it costs nothing, and zombies that cross the border leave the model.
  - Other settings tried, as the margin a ring around Prague needed: at 30 km a day, Munz needs +30 km and no ring holds Frenzied, so a line is the best plan there; at 60 km a day, Munz needs +10–20 km and Frenzied +30 km. Detecting on day 5, 10 or 14 instead of 7 needed the same margins, except that Frenzied at 60 km a day needed +45 km from day 10 on.
  - These trials are a best case: the simulated visitor draws a perfect circle on the day of detection. A real one loses 2 days for every second they take at 1×, unless they plan before detection.

**4b. Saved, sealed in, exported (PR)**
- [x] Baseline run, saved / sealed in / exported, and the end summary.
  - **The baseline** (`sim/baseline.js`) is the same engine in a second worker, without painting: it runs ahead 10 days per request, sampled every half day, and finished baselines are cached by city, strain and slider changes. A slider change mid-run applies to both runs from the same day: the main worker reports the day it took effect, and once the sliders rest for 0.4 s the baseline re-runs from day 0 with the change on that day.
  - **Saved** is the survivors at the end minus the baseline's. Once anything is planned, the status line also gives the difference so far, and the chart draws the baseline's humans as a dashed line.
  - **Sealed in** (`sim/enclosures.js`). Walls are tracked as a union-find over grid corners: built cordon, plus the national border, which humans can't cross. An edge whose two ends are already joined closes off an area; only then are the areas labelled, and each one other than the largest that holds zombies able to bite counts its humans, each km² once. The count is kept if the cordon is later undone, since it records the moment of closing.
  - **Exported** is the model's tally of zombies that crossed into each neighbour.
  - **The end summary** is a card under the map with the four numbers. "Saved" says "Comparing…" until the baseline has finished.

**4c. Stills, write-up and release (PR, then release)**
- [x] Re-render the stills (`scripts/stills.py`), with thumb/og showing a cordon: Munz from Prague, with a 55 km ring drawn before detection, on day 30, as the front reaches the finished ring.
- [x] The draft write-up in `docs/writeup.md`. Its figures come from the trials above; the two papers it cites were checked (Munz et al. 2009 in *Infectious Disease Modelling Research Progress*, pp. 133–150; Brunet and Derrida 1997, *Phys. Rev. E* 56, 2597–2604).
- No model card. This demo doesn't need one (Mark, 2026-11-18); the data and the paper are credited in the manifest's `about`.
- [x] Manifest: status `live`, and `built`.
- [x] Released `v1.0.0` on 2026-11-18 ([release](https://github.com/Mark-Bugden/zombie-outbreak/releases/tag/v1.0.0)), after checking the downloaded zip with the validator.
- [x] Mark bumps the tag in the site's `data/projects.yaml` and takes the write-up out of draft (done 2026-11-18).

### 5. demo-kit `v0.2.0` (done 2026-11-18, ahead of schedule)
- [x] Separate PR on demo-kit, done by another agent: the site's redesign tokens and fonts, dark as the default, and the tokens this demo's map needs (`--color-curve`, `--color-sodium`, `--color-halpha`).
- [x] Bump this demo to it. The map's colours now come from the kit's tokens, and its pixels are unchanged apart from the stage's rounded corners.

### 6. Improvements after v1.0.0: release `v1.1.0`
Agreed with Mark on 2026-11-19. Copy edits and better thumbnails come after this, in a later round.

**6a. The demo (PR)**
- [x] **Layout.** The chart moves out of the map's corner to a full-width panel above the map. The map takes the frame's full width too, in the map's own shape, up to the manifest's height (now 620 px). The controls go below the transport and status line, in a row, on every width. The chart now shows on phones as well.
- [x] **The chart as a timeline.** Days 0 to 365 across the full width, with gridlines, day labels, a line for today and a dashed line for the detection day. It shows the true numbers from day 0, even before detection; the map, the status line and the hover readout stay hidden until then.
- [x] **Detection.** Tools stay unlocked before detection, and the run doesn't pause (Mark, 2026-11-19). On detection, a notice over the map says "Infection detected. Build blockades to stop the spread of infection." (Mark's wording).
- [x] **Wording.** "Cordon" becomes "blockade" in everything visitors read: the controls, the status line, the manifest and the write-up. The code keeps `cordon`.
- [x] **The dead get a colour.** Zombies and the dead are painted together, in a colour mixed from red and grey by their shares, so a city with more dead than zombies looks grey. Dark: ash grey (`#9aa6b8`). Light: charcoal (`#2f3642`); people become ochre ink instead of slate, rising to dark brown rather than black, and the front deepens to dark red rather than black, so that nothing alive looks dead. The chart's dead line takes the same grey.
  - The agreed ochre was `#b07a1a`. The palette check put it too close to H-alpha red (ΔE 14.1, and 6.9 for deuteranopes), so it is `#b8860b` (ΔE 17.1 and 10.3).
- [x] **Hover readout.** The region under the pointer, with its totals: humans, zombies and dead (before detection, its people at the start). This replaces the per-km² readout.
- Proposed in 6a, not yet agreed:
  - pointing at a region outlines it, which also shows what a click would seal
  - pointing at the chart reads off any day so far, with a crosshair and a tooltip
  - the dashed no-quarantine line shows only once something is planned, since until then it is the same run
  - the notice goes after 8 seconds, on a click, or when a blockade or seal is added (replaced in step 7).

**6b. Light and dark images (kit `v0.3.0`, site, demo)**
- [x] demo-kit `v0.3.0` (tagged 2026-11-19, [demo-kit#4](https://github.com/Mark-Bugden/demo-kit/pull/4)): the bundle contract allows two optional files, `thumb-light.webp` and `static-light.webp`, for the light theme, and the validator checks them.
- [x] The site ([Mark-Bugden.github.io#11](https://github.com/Mark-Bugden/Mark-Bugden.github.io/pull/11)): the project card and the demo's loading still use the light image under the light theme, when the bundle has one; the site's validator moves to kit `v0.3.0`.
- [x] This demo: bump the kit, and render both themes' stills (`og.jpg` stays single, since link previews have no theme).
- [x] Released `v1.1.0` on 2026-11-19 ([release](https://github.com/Mark-Bugden/zombie-outbreak/releases/tag/v1.1.0)), after checking the downloaded zip with the validator. The site moved to it in [Mark-Bugden.github.io#12](https://github.com/Mark-Bugden/Mark-Bugden.github.io/pull/12), with the write-up's cordon → blockade change.
  - From here on I tag releases and bump the site's tags, not Mark (Mark, 2026-11-19).

### 7. Tweaks: release `v1.2.0`
Asked for by Mark on 2026-11-19.
- [x] **The outbreak shows from day 0.** The map, the status line and the hover readout show zombies before detection too. Detection now only starts the crew (and the notice). The status line says "outbreak not yet detected" until then.
- [x] **Fewer controls.** "Seal a region" (the list), Undo and Clear are gone: a click on a region seals it, and Reset is the only way to take a seal or blockade back. Drawing moves into Advanced as **Manual blockades**. The controls are now the city, strain and speed in a row, with Advanced under them across the full width when open, its rates side by side.
  - Without the list, sealing has no keyboard path.
- [x] **Speed** starts at 2×.
- [x] **The notice** says "Infection detected. Click on a region to build blockades and try to stop the spread." (Mark's wording), and stays until the first seal or blockade, a click on it, or a new run.
- [x] Copy that these made wrong: the manifest's quarantine paragraph and one sentence of the write-up.
- [x] Released `v1.2.0` on 2026-11-19 ([release](https://github.com/Mark-Bugden/zombie-outbreak/releases/tag/v1.2.0)); the site moved to it in [Mark-Bugden.github.io#13](https://github.com/Mark-Bugden/Mark-Bugden.github.io/pull/13), with the write-up's changed sentence.

### 8. Controls on the side, and the demo fits the window: release `v1.3.0`
Asked for by Mark on 2026-11-19: the controls go back on the side, and the whole demo should be visible without scrolling.
- [x] **Controls on the side.** On wide frames the controls are a 16rem rail beside the chart, the map and the status line, as the kit lays them out. On narrow frames they stay below the map, so the chart and the map come first.
- [x] **It fits the window.** The chart's height follows the window's (120 to 180 px, 20% of it), and the map's stage takes the map's shape at the main column's width, up to the manifest's 620 px and to what the window leaves after the chart and the status line. Measured in Edge, the rail, chart, map and status line all fit at 1920×960, 1440×800, 1280×720, 1366×650, 1024×700 and 820×1100; on a 390×760 phone, the chart, map and status line fit, with the controls below.
- [x] Released `v1.3.0` on 2026-11-19 ([release](https://github.com/Mark-Bugden/zombie-outbreak/releases/tag/v1.3.0)); the site moved to it in [Mark-Bugden.github.io#14](https://github.com/Mark-Bugden/Mark-Bugden.github.io/pull/14).

### 9. Release on merge, and fit below the site's title: release `v1.4.0`
Asked for by Mark on 2026-11-19: each change should be one PR that goes live when it merges, and the demo should be fully visible when its project page opens.
- [x] **Release on merge.** `demo/package.json`'s `version` is the release. A PR that changes the demo must bump it, or CI fails. When it merges, the Demo workflow builds the bundle, sets `built` to that day, releases `v<version>` and starts the site's build (with the `SITE_DEPLOY_TOKEN` secret). The site now takes each project's latest release ([Mark-Bugden.github.io#16](https://github.com/Mark-Bugden/Mark-Bugden.github.io/pull/16)), so there's no tag to push and no site PR.
- [x] **Fits below the site's title.** On the project page, the title is now the only thing above the demo ([Mark-Bugden.github.io#17](https://github.com/Mark-Bugden/Mark-Bugden.github.io/pull/17)). The site sets `--dk-fit-height` to the window's height less what sits above the demo, and `--zo-fit` reads it in place of `100dvh`. Standalone, nothing changes. Measured with the site's branch: fits at 1920×960, 1536×730 and 1440×790. At 1366×650 it is 37 px short, held by the stage's 14rem minimum.
- [x] Merging released `v1.4.0` on 2026-11-19.

### 10. The shared palette: release `v1.5.0`
Agreed with Mark on 2026-11-19 (see doctor-who-ratings' plan, "A shared palette"): the site and the demos share three colour roles, which demo-kit v0.4.0 provides.
- [x] **Kit v0.4.0.** People take the main highlight, `--color-accent`, and zombies the contrasting one, `--color-accent-2`. That replaces `--color-sodium` for people, `--color-halpha` for zombies, and the light theme's ochre. Dark barely changes: zombies go from H-alpha `#c2391b` to ember `#c13c36`. On light, people are viridis blue `#285388` and zombies green `#5ca24c`.
- [x] **The light theme's deeper shades.** Mark chose from three options rendered on the same run (2026-11-20). The densest people deepen to navy `#0f253f` and the front to deep green `#2d5923`, the same darkening the ochre and red had, and the dead stay charcoal `#2f3642`. That charcoal is ΔE 13 from the people and 7.7 from the navy, closer than the ochre was. The other options were the dead in pale grey (faint in the chart, at 2:1) or in a neutral charcoal with no deeper shades.
- [x] **No colour names in the copy.** "What you're seeing" named amber, red and grey, which no longer fit the light theme. It now says the map is coloured like the chart, as a stand-in until Mark rewrites the paragraph. The opening still's alt text drops "in amber".
- [x] Re-render the stills with `scripts/stills.py`.
- [ ] Merging releases `v1.5.0`.

## Open questions

- **Munz parameters.** The paper uses counts in a well-mixed population of 500, so converting them to density units is a judgement call. The write-up should say so.
- **Calibration.** The strain parameters, the detection day and the build speed are set by hand so the game is balanced. The demo copy and the write-up should call them illustrative choices, not estimates.
