"""Checks the reference SZR model, zombie_outbreak.model."""

import numpy as np
import pytest
from scipy.integrate import solve_ivp

from zombie_outbreak.model import BLOCK_EAST, NEIGHBOUR_BASE, Params, State, seed, step

# Munz et al. (2009), basic model, without births and natural deaths (Π = δ = 0).
MUNZ = {"beta": 0.0095, "alpha": 0.005, "zeta": 0.0001}
STILL = {"diffusion": 0.0, "flee": 0.0}


def run(state, params, labels, steps, blocks=None):
    for _ in range(steps):
        step(state, params, labels, blocks)
    return state


def well_mixed(dt, days):
    """One cell of 500 people with one zombie, nothing moving, no cutoff."""
    state = State.start([[500.0]])
    seed(state, 0, 1)
    run(state, Params(**MUNZ, **STILL, threshold=0, epsilon=0, dt=dt), [[1]], round(days / dt))
    return np.array([state.S[0, 0], state.Z[0, 0], state.R[0, 0]])


def munz(days):
    b, a, z = MUNZ["beta"], MUNZ["alpha"], MUNZ["zeta"]

    def f(_, y):
        s, zz, r = y
        return [-b * s * zz, b * s * zz - a * s * zz + z * r, a * s * zz - z * r]

    return solve_ivp(f, (0, days), [499.0, 1.0, 0.0], method="DOP853", rtol=1e-12, atol=1e-12).y[:, -1]


def test_one_cell_follows_munz_equations():
    exact = munz(3)
    error = np.abs(well_mixed(1e-3, 3) - exact).max()
    assert error < 0.01 * 500


def test_steps_converge_at_first_order():
    exact = munz(3)
    coarse = np.abs(well_mixed(2e-3, 3) - exact).max()
    fine = np.abs(well_mixed(1e-3, 3) - exact).max()
    assert 1.7 < coarse / fine < 2.3


def test_zombies_below_the_threshold_cannot_bite():
    params = Params(beta=0.01, alpha=0, zeta=0, **STILL, threshold=1.0)
    faint = State.start([[1000.0]])
    seed(faint, 0, 0.9)
    step(faint, params, [[1]])
    assert faint.S[0, 0] == 1000.0 - 0.9
    strong = State.start([[1000.0]])
    seed(strong, 0, 1.0)
    step(strong, params, [[1]])
    assert strong.S[0, 0] < 1000.0 - 1.0


def test_humans_flee_towards_the_smaller_zombie_share():
    state = State(S=np.array([[100.0, 100.0]]), Z=np.array([[50.0, 0.0]]), R=np.zeros((1, 2)))
    step(state, Params(beta=0, alpha=0, zeta=0, diffusion=0, flee=1.0, dt=0.1), [[1, 1]])
    moved = 0.1 * 100 * (50 / 150)
    assert state.S == pytest.approx(np.array([[100 - moved, 100 + moved]]))


def test_zombies_crossing_the_border_are_exported_and_humans_stay():
    labels = [[NEIGHBOUR_BASE, 1, NEIGHBOUR_BASE + 1]]
    state = State(S=np.array([[0.0, 100.0, 0.0]]), Z=np.array([[0.0, 40.0, 0.0]]), R=np.zeros((1, 3)))
    step(state, Params(beta=0, alpha=0, zeta=0, diffusion=2.0, flee=2.0, dt=0.1), labels)
    assert state.exported == {NEIGHBOUR_BASE: pytest.approx(8.0), NEIGHBOUR_BASE + 1: pytest.approx(8.0)}
    assert state.Z.tolist() == [[0.0, 24.0, 0.0]]
    assert state.S.tolist() == [[0.0, 100.0, 0.0]]


def test_a_cordon_stops_zombies_and_humans():
    labels = np.ones((5, 8), int)
    blocks = np.zeros((5, 8), np.uint8)
    blocks[:, 3] |= BLOCK_EAST  # a wall between columns 3 and 4
    state = State.start(np.full((5, 8), 300.0))
    seed(state, 2 * 8 + 0, 50)
    run(state, Params(beta=0.002, alpha=0.0005, zeta=0.05, diffusion=2.0, flee=2.0), labels, 500, blocks)
    assert state.Z[:, :4].sum() > 0 or state.R[:, :4].sum() > 0
    assert (state.Z[:, 4:] == 0).all()
    assert (state.S[:, 4:] == 300.0).all()


def test_unstable_steps_are_refused():
    with pytest.raises(ValueError, match="diffusion"):
        Params(beta=0, alpha=0, zeta=0, diffusion=3.0, flee=0, dt=0.1).check()
    # At D dt = 0.25 a checkerboard pattern never decays, so the limit is 0.2.
    with pytest.raises(ValueError, match="diffusion"):
        Params(beta=0, alpha=0, zeta=0, diffusion=2.5, flee=0, dt=0.1).check()
    Params(beta=0, alpha=0, zeta=0, diffusion=2.0, flee=0, dt=0.1).check()
    with pytest.raises(ValueError, match="flee"):
        Params(beta=0, alpha=0, zeta=0, diffusion=0, flee=3.0, dt=0.1).check()


def test_the_books_balance_on_the_real_map(grid):
    # A crop around Ostrava that takes in the Polish border.
    data, population, labels = grid
    (ostrava,) = [c for c in data["cities"] if c["name"] == "Ostrava"]
    col, row = ostrava["cell"]
    rows, cols = slice(row - 25, row + 25), slice(col - 30, col + 30)
    crop_labels, crop_population = labels[rows, cols], population[rows, cols]
    assert (crop_labels >= NEIGHBOUR_BASE).any()

    state = State.start(crop_population)
    seed(state, 25 * 60 + 30, 200)
    start = state.total()
    params = Params(beta=0.001, alpha=0.0003, zeta=0.05, diffusion=2.0, flee=0.5)
    for _ in range(300):
        step(state, params, crop_labels)
        assert min(state.S.min(), state.Z.min(), state.R.min()) >= 0
    assert state.total() == pytest.approx(start, rel=1e-12)
    outside = crop_labels >= NEIGHBOUR_BASE
    assert not (state.S[outside].any() or state.Z[outside].any() or state.R[outside].any())
    poland = next(n["id"] for n in data["neighbours"] if n["code"] == "PL")
    assert state.exported.get(poland, 0) > 0
