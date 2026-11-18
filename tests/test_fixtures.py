"""Checks that tests/fixtures/szr.json, which the JS solver's tests replay, still matches the reference model."""

import json
import math

from zombie_outbreak import fixtures

# NumPy's expm1 and friends differ in the last bit or two between platforms (the fixtures are
# written on Windows; CI runs Linux), so numbers are compared to within this relative tolerance.
# A change to the model shows up far above it.
TOLERANCE = 1e-10


def mismatches(committed, current, path="fixture"):
    """Every place where the two JSON structures differ, beyond TOLERANCE for numbers."""
    if isinstance(committed, dict) and isinstance(current, dict):
        if committed.keys() != current.keys():
            return [f"{path}: keys {sorted(committed)} vs {sorted(current)}"]
        return [m for key in committed for m in mismatches(committed[key], current[key], f"{path}.{key}")]
    if isinstance(committed, list) and isinstance(current, list):
        if len(committed) != len(current):
            return [f"{path}: length {len(committed)} vs {len(current)}"]
        return [m for i, (a, b) in enumerate(zip(committed, current)) for m in mismatches(a, b, f"{path}[{i}]")]
    if isinstance(committed, (int, float)) and isinstance(current, (int, float)) and not isinstance(committed, bool):
        return [] if math.isclose(committed, current, rel_tol=TOLERANCE, abs_tol=TOLERANCE) else [f"{path}: {committed} vs {current}"]
    return [] if committed == current else [f"{path}: {committed!r} vs {current!r}"]


def test_the_js_fixtures_are_current():
    committed = json.loads(fixtures.OUT.read_text(encoding="utf-8"))
    current = json.loads(json.dumps(fixtures.build()))
    found = mismatches(committed, current)
    assert not found, (
        "tests/fixtures/szr.json is out of date: run `uv run python -m zombie_outbreak.fixtures`\n"
        + "\n".join(found[:10])
    )


def test_a_model_change_would_be_caught():
    current = json.loads(json.dumps(fixtures.build()))
    changed = json.loads(json.dumps(current))
    zombies = changed["cases"][0]["expected"]["Z"]
    zombies[zombies.index(max(zombies))] *= 1 + 1e-6
    assert mismatches(changed, current)


def test_the_cases_have_something_happening():
    for case in fixtures.build()["cases"]:
        expected = case["expected"]
        assert sum(expected["Z"]) > 1, case["name"]
        assert sum(expected["R"]) > 1, case["name"]
