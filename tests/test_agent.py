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


class FakeSteam:
    """Steam's library folder calls, as the agent sends them."""

    def __init__(self, agent, folders):
        self.agent = agent
        self.folders = folders
        self.refuse = False  # [{index, path, mounted, label}]
        self.calls = []

    def eval(self, js):
        self.calls.append(js)
        if js == self.agent.JS_FOLDERS:
            return [dict(f) for f in self.folders]
        if js.startswith("SteamClient.InstallFolder.AddInstallFolder("):
            path = json.loads(js[js.index("(") + 1:-1])
            index = max([f["index"] for f in self.folders] + [0]) + 1
            self.folders.append({"index": index, "path": path, "mounted": True, "label": ""})
            return index
        if js.startswith("SteamClient.InstallFolder.SetFolderLabel("):
            index, label = js[js.index("(") + 1:-1].split(", ", 1)
            next(f for f in self.folders if f["index"] == int(index))["label"] = json.loads(label)
            return None
        if js.startswith(self.agent.JS_REMOVE_FOLDER.split("{index}")[0].replace("{{", "{")):
            index = int(js.split("RemoveInstallFolder(", 1)[1].split(")", 1)[0])
            if self.refuse:
                return False
            self.folders = [f for f in self.folders if f["index"] != index]
            return True
        raise AssertionError(js)


def test_cartridge_steam_library_follows_the_cartridge(agent, tmp_path, monkeypatch):
    monkeypatch.setattr(agent, "save_state", lambda state: None)
    cart = make_cartridge(tmp_path / "Zelda", "zelda", ["oot"], name="Zelda")
    (cart / "SteamLibrary").mkdir()
    bare = make_cartridge(tmp_path / "Bare", "bare", ["x"])
    monkeypatch.setattr(agent, "mount_points", lambda: [str(cart), str(bare)])
    wanted = agent.wanted_libraries()
    library = str(cart / "SteamLibrary")
    assert wanted == {library: {"cartridge": "zelda", "label": "Zelda"}}

    steam = FakeSteam(agent, [{"index": 0, "path": "/home/me/.local/share/Steam", "mounted": True, "label": ""}])
    state = {"shortcuts": {}}
    assert agent.sync_libraries(steam, state, wanted)
    assert [f["path"] for f in steam.folders] == ["/home/me/.local/share/Steam", library]
    assert steam.folders[1]["label"] == "Zelda"
    assert state["libraries"] == wanted
    assert agent._libraries_in_sync(state, wanted)

    # Plugged in again: nothing is added twice.
    assert agent.sync_libraries(steam, state, wanted)
    assert len(steam.folders) == 2

    # Unplugged: the folder is gone from disk, Steam drops it when asked. If it does not, the next check retries.
    (cart / "SteamLibrary").rmdir()
    assert not agent._libraries_in_sync(state, {})
    steam.refuse = True
    assert not agent.sync_libraries(steam, state, {})
    assert len(steam.folders) == 2 and library in state["libraries"]
    steam.refuse = False
    assert agent.sync_libraries(steam, state, {})
    assert [f["index"] for f in steam.folders] == [0]
    assert state["libraries"] == {}


def test_a_library_still_on_disk_is_never_removed(agent, tmp_path, monkeypatch):
    monkeypatch.setattr(agent, "save_state", lambda state: None)
    library = tmp_path / "Old" / "SteamLibrary"
    library.mkdir(parents=True)
    steam = FakeSteam(agent, [{"index": 3, "path": str(library), "mounted": True, "label": "Old"}])
    state = {"libraries": {str(library): {"cartridge": "old", "label": "Old"}}}
    assert agent.sync_libraries(steam, state, {})
    assert len(steam.folders) == 1 and state["libraries"] == {}
