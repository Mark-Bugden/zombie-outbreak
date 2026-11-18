"""The SZR (humans, zombies, removed) model on the population grid: the reference implementation.

The demo's solver, demo/src/sim/szr.js, is a port of this module. Its tests compare it with fixtures
written from here (`uv run python -m zombie_outbreak.fixtures`), so keep the two in step: same
operations, in the same order.

The state holds three numbers per 1 km² cell, so densities and head counts are the same numbers:
S (humans), Z (zombies) and R (the removed: the dead, who can rise as zombies). Each step of length
dt days applies, in order:

1. Encounters and rising, cell by cell. This is Munz et al. (2009) without births or natural deaths:
       bites = S (1 − exp(−β Z dt))   if Z ≥ threshold, else 0
       kills = Z (1 − exp(−α S dt))
       rises = R (1 − exp(−ζ dt))
       S −= bites;  Z += bites − kills + rises;  R += kills − rises
   For small dt these are β S Z dt, α S Z dt and ζ R dt, the paper's terms. The exponential form
   keeps every compartment non-negative at any dt.
2. Zombies wander: diffusion across every open cell edge, at rate D dt / dx² with dx = 1 km. Edges
   into a neighbouring country are open. Zombies that cross them are exported: counted against that
   country and removed from the grid.
3. Humans flee: across every open edge between two Czech cells, humans move from the cell with the
   larger zombie share, z = Z / (S + Z), towards the smaller, at χ dt S (z_i − z_j) of the source
   cell's humans. Using the share rather than Z keeps the flow bounded at any density. Humans do not
   cross the national border.
4. Clean-up: zombies below `epsilon` in a cell are cleared, and counted so the books still balance.

The threshold is the cutoff that lets quarantines work. Below about one zombie per km², zombies
cannot bite. A thin tail of zombies spreading ahead of the front, or leaking past a cordon, can
therefore drift and be destroyed but cannot start new outbreaks. This is the cutoff Brunet and
Derrida introduced for pulled fronts, and it gives the same results at any dt. Blocked edges
(cordons) stop all movement across them.
"""

from dataclasses import dataclass, field

import numpy as np

# Labels: 1–20 are Czech regions, and from NEIGHBOUR_BASE up neighbouring countries (see grid.py).
NEIGHBOUR_BASE = 21
# Bits of `blocks`, per cell: its east edge, and its south edge, is blocked by a cordon.
BLOCK_EAST = 1
BLOCK_SOUTH = 2
# The largest D dt / dx² a step allows (see Params.check).
MAX_DIFFUSION_STEP = 0.2


@dataclass(frozen=True)
class Params:
    beta: float  # bites: per human, per zombie per km², per day
    alpha: float  # zombies destroyed: per zombie, per human per km², per day
    zeta: float  # share of the removed rising as zombies, per day
    diffusion: float  # D: how fast zombies wander, km² per day
    flee: float  # χ: how fast humans flee down the zombie share, per day
    threshold: float = 1.0  # zombies per km² below which they cannot bite
    epsilon: float = 1e-3  # zombies per km² below which a cell is cleared
    dt: float = 0.1  # days per step

    def check(self):
        """Raises ValueError unless every rate is non-negative and the step is stable."""
        for name in ("beta", "alpha", "zeta", "diffusion", "flee", "threshold", "epsilon"):
            if not getattr(self, name) >= 0:
                raise ValueError(f"{name} must be non-negative, got {getattr(self, name)}")
        if not self.dt > 0:
            raise ValueError(f"dt must be positive, got {self.dt}")
        # 0.25 is the stability limit of the explicit 5-point step, but at it a checkerboard pattern
        # (amplification 1 − 8 D dt = −1) flips sign every step and never decays. At 0.2 it dies away.
        if self.diffusion * self.dt > MAX_DIFFUSION_STEP:
            raise ValueError(f"diffusion × dt must be at most {MAX_DIFFUSION_STEP} for a smooth, stable step, got {self.diffusion * self.dt}")
        if 4 * self.flee * self.dt > 1:
            raise ValueError(f"4 × flee × dt must be at most 1 for a stable step, got {4 * self.flee * self.dt}")


@dataclass
class State:
    S: np.ndarray
    Z: np.ndarray
    R: np.ndarray
    exported: dict = field(default_factory=dict)  # neighbour label → zombies exported
    cleared: float = 0.0
    day: float = 0.0

    @classmethod
    def start(cls, population):
        """Everyone human: S is the population, Z and R are zero."""
        S = np.asarray(population, dtype=np.float64).copy()
        return cls(S, np.zeros_like(S), np.zeros_like(S))

    def total(self):
        """Everyone on the grid, plus everyone exported and cleared: constant from step to step."""
        return float(self.S.sum() + self.Z.sum() + self.R.sum()) + sum(self.exported.values()) + self.cleared


def seed(state, cell, zombies):
    """Turns up to `zombies` of the humans in a cell (a flat index) into zombies."""
    index = np.unravel_index(cell, state.S.shape)
    turned = min(float(zombies), float(state.S[index]))
    state.S[index] -= turned
    state.Z[index] += turned


def _open_edges(labels, blocks):
    """Open east and south edges: for zombies (any edge touching Czechia) and for humans (inside only)."""
    inside = labels < NEIGHBOUR_BASE
    free_e = (blocks[:, :-1] & BLOCK_EAST) == 0
    free_s = (blocks[:-1, :] & BLOCK_SOUTH) == 0
    zombie_e = free_e & (inside[:, :-1] | inside[:, 1:])
    zombie_s = free_s & (inside[:-1, :] | inside[1:, :])
    human_e = free_e & inside[:, :-1] & inside[:, 1:]
    human_s = free_s & inside[:-1, :] & inside[1:, :]
    return inside, zombie_e, zombie_s, human_e, human_s


def _apply(values, east, south):
    """values_i − east_i + east_(i−1) − south_i + south_(i−w), in that order, for signed edge flows."""
    out = values.copy()
    out[:, :-1] -= east
    out[:, 1:] += east
    out[:-1, :] -= south
    out[1:, :] += south
    return out


def step(state, params, labels, blocks=None):
    """Advances the state by one step of params.dt days, in place."""
    params.check()
    labels = np.asarray(labels)
    blocks = np.zeros(labels.shape, np.uint8) if blocks is None else np.asarray(blocks)
    inside, zombie_e, zombie_s, human_e, human_s = _open_edges(labels, blocks)
    dt = params.dt

    # 1. Encounters and rising.
    S, Z, R = state.S, state.Z, state.R
    bites = np.where(Z >= params.threshold, S * -np.expm1(-params.beta * Z * dt), 0.0)
    kills = Z * -np.expm1(-params.alpha * S * dt)
    rises = R * -np.expm1(-params.zeta * dt)
    S = S - bites
    Z = Z + (bites - kills + rises)
    R = R + (kills - rises)

    # 2. Zombies wander, and those that cross the border are exported.
    rate = params.diffusion * dt
    east = np.where(zombie_e, rate * (Z[:, :-1] - Z[:, 1:]), 0.0)
    south = np.where(zombie_s, rate * (Z[:-1, :] - Z[1:, :]), 0.0)
    Z = _apply(Z, east, south)
    for label in np.unique(labels[~inside]):
        cells = labels == label
        crossed = float(Z[cells].sum())
        if crossed > 0:
            state.exported[int(label)] = state.exported.get(int(label), 0.0) + crossed
    Z[~inside] = 0.0

    # 3. Humans flee down the zombie share.
    walking = S + Z
    share = np.divide(Z, walking, out=np.zeros_like(Z), where=walking > 0)
    flight = params.flee * dt
    d = share[:, :-1] - share[:, 1:]
    east = np.where(human_e, flight * np.where(d > 0, S[:, :-1] * d, S[:, 1:] * d), 0.0)
    d = share[:-1, :] - share[1:, :]
    south = np.where(human_s, flight * np.where(d > 0, S[:-1, :] * d, S[1:, :] * d), 0.0)
    S = _apply(S, east, south)

    # 4. Clean-up.
    faint = Z < params.epsilon
    state.cleared += float(Z[faint].sum())
    Z[faint] = 0.0

    state.S, state.Z, state.R = S, Z, R
    state.day += dt
