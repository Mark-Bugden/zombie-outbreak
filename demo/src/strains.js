// The zombie strains and the run's fixed settings. The strains' values were tuned on the full map
// (see docs/plan.md): they are illustrative choices, not estimates.

// Days per step. Every strain's D × DT must stay at most 0.2 and 4 × flee × DT at most 1 (see szr.js).
export const DT = 0.1;
// The run stops on this day, or earlier if every zombie is gone.
export const LAST_DAY = 365;
// Zombies at the start, in the scenario's city.
export const PATIENTS_ZERO = 10;
// Settings every run shares: the cutoff below which zombies cannot bite, and the clean-up level.
export const FIXED = { threshold: 1, epsilon: 1e-3, dt: DT };

export const STRAINS = [
  {
    key: 'munz',
    label: 'Munz et al. (2009)',
    // Munz et al.'s basic-model rates, reading their population of 500 as 500 people per km².
    params: { beta: 0.0095, alpha: 0.005, zeta: 0.0001, diffusion: 1.0, flee: 0.5 },
  },
  {
    key: 'shamblers',
    label: 'Shamblers',
    params: { beta: 0.005, alpha: 0.003, zeta: 0.001, diffusion: 0.8, flee: 0.5 },
  },
  {
    key: 'frenzied',
    label: 'Frenzied',
    params: { beta: 0.015, alpha: 0.003, zeta: 0.001, diffusion: 2.0, flee: 0.5 },
  },
  {
    key: 'risers',
    label: 'Risers',
    // Humans win most fights (α > β), but the destroyed rise again within days.
    params: { beta: 0.007, alpha: 0.010, zeta: 0.3, diffusion: 1.0, flee: 0.5 },
  },
];

// The Advanced sliders, one per parameter. The maxima keep every step stable at DT.
const fixed = (digits) => (value) => value.toFixed(digits);
export const SLIDERS = [
  { name: 'beta', label: 'Bites (β)', min: 0, max: 0.02, step: 0.0005, format: fixed(4) },
  { name: 'alpha', label: 'Humans fighting back (α)', min: 0, max: 0.02, step: 0.0005, format: fixed(4) },
  { name: 'zeta', label: 'The dead rising (ζ)', min: 0, max: 0.5, step: 0.0001, format: fixed(4) },
  { name: 'diffusion', label: 'Zombies wandering (D)', min: 0, max: 2, step: 0.1, format: (v) => `${v.toFixed(1)} km²/day` },
  { name: 'flee', label: 'Humans fleeing (χ)', min: 0, max: 2.5, step: 0.1, format: (v) => `${v.toFixed(1)}/day` },
];
