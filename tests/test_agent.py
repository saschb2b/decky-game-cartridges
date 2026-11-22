import json
import os

from conftest import make_cartridge


def test_manifest_lists_games_with_resolved_paths(agent, tmp_path):
    cart = make_cartridge(tmp_path / "Zelda", "zelda", ["oot", "wwhd"])
    manifest = agent.read_manifest(str(cart))
    assert manifest["id"] == "zelda"
    assert [g["id"] for g in manifest["games"]] == ["oot", "wwhd"]
    oot = manifest["games"][0]
    assert oot["exe"] == os.path.realpath(cart / "games/oot/launch.sh")
    assert oot["art"] == os.path.realpath(cart / "games/oot/art")


def test_manifest_skips_launchers_outside_the_cartridge_or_missing(agent, tmp_path):
    cart = make_cartridge(tmp_path / "C", "c", ["good"])
    (tmp_path / "evil.sh").write_text("#!/bin/sh\n")
    data = json.loads((cart / "cartridge.json").read_text())
    data["games"] += [
        {"id": "escape", "title": "Escape", "launch": "../evil.sh"},
        {"id": "gone", "title": "Gone", "launch": "games/gone/launch.sh"},
        {"id": "broken"},
    ]
    (cart / "cartridge.json").write_text(json.dumps(data))
    assert [g["id"] for g in agent.read_manifest(str(cart))["games"]] == ["good"]


def test_manifest_missing_or_unreadable(agent, tmp_path):
    assert agent.read_manifest(str(tmp_path)) is None
    (tmp_path / "cartridge.json").write_text("{not json")
    assert agent.read_manifest(str(tmp_path)) is None


def test_manifest_id_falls_back_to_folder_name(agent, tmp_path):
    cart = tmp_path / "Old"
    cart.mkdir()
    (cart / "cartridge.json").write_text(json.dumps({"format": 1, "games": []}))
    assert agent.read_manifest(str(cart))["id"] == "Old"


def test_same_game_on_two_cartridges_prefers_home_then_current_shortcut(agent, tmp_path, monkeypatch):
    home = make_cartridge(tmp_path / "home", "home", ["oot"])
    a = make_cartridge(tmp_path / "A", "a", ["oot", "totk"])
    b = make_cartridge(tmp_path / "B", "b", ["totk"])
    monkeypatch.setattr(agent, "HOME_CARTRIDGE", str(home))
    monkeypatch.setattr(agent, "cartridge_roots", lambda: [str(home), str(a), str(b)])

    b_totk = os.path.realpath(b / "games/totk/launch.sh")
    wanted = agent.wanted_shortcuts({"shortcuts": {"totk": {"exe": b_totk}}})
    assert wanted["oot"]["mount"] == str(home)
    assert wanted["totk"]["exe"] == b_totk

    wanted = agent.wanted_shortcuts({"shortcuts": {}})
    assert wanted["totk"]["mount"] == str(a)


def test_migrate_state_keeps_one_shortcut_per_game(agent):
    state = {"shortcuts": {
        "zelda|oot": {"appid": 1, "hidden": True},
        "copy|oot": {"appid": 2, "hidden": False},
        "zelda|wwhd": {"appid": 3},
    }}
    migrated = agent.migrate_state(state)
    assert migrated["version"] == agent.AGENT_VERSION
    assert migrated["shortcuts"]["oot"]["appid"] == 2  # the visible one stays
    assert migrated["shortcuts"]["wwhd"]["appid"] == 3
    assert migrated["orphans"] == [1]


def test_in_sync(agent):
    wanted = {"oot": {"exe": "/c/oot.sh", "title": "OoT"}}
    shown = {"exe": "/c/oot.sh", "title": "OoT", "hidden": False}
    assert agent._in_sync({"shortcuts": {"oot": shown, "old": {"exe": "/x", "title": "X", "hidden": True}}}, wanted)
    assert not agent._in_sync({"shortcuts": {"oot": dict(shown, hidden=True)}}, wanted)
    assert not agent._in_sync({"shortcuts": {"oot": dict(shown, exe="/other.sh")}}, wanted)
    assert not agent._in_sync({"shortcuts": {"oot": shown, "old": {"exe": "/x", "title": "X"}}}, wanted)
    assert not agent._in_sync({"shortcuts": {"oot": shown}, "orphans": [5]}, wanted)
