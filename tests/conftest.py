"""Loads the plugin backend, the agent and the copy worker as modules, without Decky or Steam."""

import getpass
import importlib.util
import logging
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def plugin(tmp_path_factory):
    """main.py with a stand-in for the `decky` module Decky Loader provides at runtime."""
    home = tmp_path_factory.mktemp("home")
    decky = types.ModuleType("decky")
    decky.DECKY_PLUGIN_DIR = str(ROOT)
    decky.DECKY_USER = getpass.getuser()
    decky.DECKY_USER_HOME = str(home)
    decky.DECKY_PLUGIN_SETTINGS_DIR = str(tmp_path_factory.mktemp("settings"))
    decky.logger = logging.getLogger("decky")
    sys.modules["decky"] = decky
    return load("plugin_main", "main.py")


@pytest.fixture(scope="session")
def agent(tmp_path_factory):
    data = tmp_path_factory.mktemp("xdg-data")
    mp = pytest.MonkeyPatch()
    mp.setenv("XDG_DATA_HOME", str(data))
    module = load("cartridge_agent", "cartridge/agent/cartridge-agent.py")
    mp.undo()
    return module


@pytest.fixture(scope="session")
def worker():
    return load("cart_worker", "backend/cart_worker.py")


def make_cartridge(root, cid, games, name=None):
    """A cartridge folder with a manifest and a launch.sh per game id."""
    import json

    root.mkdir(parents=True, exist_ok=True)
    entries = []
    for gid in games:
        game = root / "games" / gid
        game.mkdir(parents=True)
        (game / "launch.sh").write_text("#!/bin/sh\n")
        entries.append({"id": gid, "title": gid.upper(), "launch": f"games/{gid}/launch.sh"})
    (root / "cartridge.json").write_text(json.dumps({"format": 1, "id": cid, "name": name or cid, "games": entries}))
    return root
