"""Configuration loading."""

import json
from pathlib import Path


def parse_config(path):
    """Read a JSON config file and return it as a dict."""
    return json.loads(Path(path).read_text(encoding="utf-8"))
