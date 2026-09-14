"""Entry point."""

from .settings import parse_config


def run(config_path):
    config = parse_config(config_path)
    return config.get("name", "unnamed")
