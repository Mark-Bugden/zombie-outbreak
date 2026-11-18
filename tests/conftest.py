"""Shared test fixtures: the committed population grid, decoded."""

import base64
import json
import zlib
from pathlib import Path

import numpy as np
import pytest

GRID = Path(__file__).resolve().parents[1] / "demo" / "public" / "data" / "czechia.json"
DTYPES = {"uint8": "<u1", "uint16": "<u2"}


@pytest.fixture(scope="session")
def grid():
    """(data, population, labels): czechia.json's metadata and its two arrays, shaped height × width."""
    data = json.loads(GRID.read_text(encoding="utf-8"))
    shape = (data["height"], data["width"])

    def decode(field):
        raw = zlib.decompress(base64.b64decode(field["data"]))
        return np.frombuffer(raw, dtype=DTYPES[field["dtype"]]).reshape(shape)

    return data, decode(data["population"]), decode(data["labels"])
