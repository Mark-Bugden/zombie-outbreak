"""Checks that tests/fixtures/szr.json, which the JS solver's tests replay, still matches the reference model."""

import json

from zombie_outbreak import fixtures


def test_the_js_fixtures_are_current():
    committed = json.loads(fixtures.OUT.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(fixtures.build())), (
        "tests/fixtures/szr.json is out of date: run `uv run python -m zombie_outbreak.fixtures`"
    )


def test_the_cases_have_something_happening():
    for case in fixtures.build()["cases"]:
        expected = case["expected"]
        assert sum(expected["Z"]) > 1, case["name"]
        assert sum(expected["R"]) > 1, case["name"]
