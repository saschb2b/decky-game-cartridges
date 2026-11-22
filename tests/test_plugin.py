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


ACF = """"AppState"
{
	"appid"		"813230"
	"name"		"ANIMAL WELL"
	"StateFlags"		"4"
	"installdir"		"Animal Well"
	"SizeOnDisk"		"36000000"
	"UserConfig"
	{
		"language"		"english"
	}
}
"""


def test_parse_vdf(plugin):
    data = plugin.parse_vdf(ACF + '// comment\n"x" { "path" "C:\\\\Games" "q" "say \\"hi\\"" }')
    assert data["appstate"]["name"] == "ANIMAL WELL"
    assert data["appstate"]["userconfig"] == {"language": "english"}
    assert data["x"] == {"path": "C:\\Games", "q": 'say "hi"'}
    with pytest.raises(ValueError):
        plugin.parse_vdf('"a" { } }')


def steam_library(root, apps):
    """A Steam library folder with an appmanifest per (appid, name, installed)."""
    steamapps = root / "steamapps"
    (steamapps / "common").mkdir(parents=True)
    for appid, name, installed in apps:
        acf = ACF.replace("813230", str(appid)).replace("ANIMAL WELL", name).replace("Animal Well", name)
        if not installed:
            acf = acf.replace('"StateFlags"\t\t"4"', '"StateFlags"\t\t"1026"')
        (steamapps / f"appmanifest_{appid}.acf").write_text(acf)
        (steamapps / "common" / name).mkdir()
    return root


def test_steam_games_on_a_cartridge(plugin, tmp_path):
    cart = tmp_path / "Zelda"
    cart.mkdir()
    (cart / "cartridge.json").write_text('{"format": 1, "id": "zelda", "name": "Zelda", "games": []}')
    steam_library(cart / "SteamLibrary", [(813230, "ANIMAL WELL", True), (5, "Half Done", False)])
    (cart / "SteamLibrary" / "steamapps" / "appmanifest_9.acf").write_text("garbage {")
    info = plugin.cartridge_info(str(cart), [], {})
    assert info["steam_library"] == str(cart / "SteamLibrary")
    games = {g["id"]: g for g in info["games"]}
    assert set(games) == {"steam:5", "steam:813230"}
    well = games["steam:813230"]
    assert (well["kind"], well["appid"], well["title"]) == ("steam", 813230, "ANIMAL WELL")
    assert (well["size"], well["present"]) == (36000000, True)
    assert games["steam:5"]["present"] is False


def test_machine_libraries_leave_out_cartridges(plugin, tmp_path, monkeypatch):
    home = tmp_path / "home"
    root = steam_library(home / ".local/share/Steam", [(1, "Internal", True)])
    sd = steam_library(tmp_path / "sdcard", [(2, "On SD", True)])
    cart = steam_library(tmp_path / "Zelda" / "SteamLibrary", [(3, "On cartridge", True)])
    gone = tmp_path / "unplugged"
    (root / "steamapps" / "libraryfolders.vdf").write_text(
        '"libraryfolders" { "0" { "path" "%s" } "1" { "path" "%s" } "2" { "path" "%s" } "3" { "path" "%s" } }'
        % (root, sd, cart, gone))
    monkeypatch.setattr(plugin, "HOME", home)
    libraries = plugin.machine_steam_libraries([str(tmp_path / "Zelda")])
    assert libraries == [str(root), str(sd)]
