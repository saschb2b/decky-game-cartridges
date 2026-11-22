import re

import pytest


def test_label_fits_ext4_and_has_no_path_characters(plugin):
    assert plugin.make_label("Zelda") == "Zelda"
    assert plugin.make_label("a/b\\c\x01") == "abc"
    assert plugin.make_label("   ") == "Cartridge"
    label = plugin.make_label("Ünïcödé Cartridge Name")
    assert len(label.encode()) <= 16
    label.encode().decode()  # never cut inside a character


def test_cartridge_id(plugin):
    assert re.fullmatch(r"mario-games-[0-9a-f]{4}", plugin.make_id("Mario & Games!"))
    assert re.fullmatch(r"cartridge-[0-9a-f]{4}", plugin.make_id("!!!"))
    assert len(plugin.make_id("x" * 80).rsplit("-", 1)[0]) == 24


@pytest.mark.parametrize("gid,ok", [("oot", True), ("xc3-dlc.2", True), ("../etc", False), ("a/b", False),
                                    (".hidden", False), ("", False), ("x" * 65, False)])
def test_game_ids_cannot_leave_the_games_folder(plugin, gid, ok):
    assert bool(plugin.GAME_ID.match(gid)) is ok


def test_load_manifest(plugin, tmp_path):
    with pytest.raises(RuntimeError):
        plugin.load_manifest(str(tmp_path))
    (tmp_path / "cartridge.json").write_text('{"format": 1, "id": "x"}')
    assert plugin.load_manifest(str(tmp_path))["games"] == []
