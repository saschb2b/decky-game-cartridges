"""The launcher helpers in cartridge/lib.sh, run through bash."""

import os
import subprocess

from conftest import ROOT


def bash(script, **env):
    result = subprocess.run(["bash", "-c", f'. "{ROOT}/cartridge/lib.sh"\n{script}'], capture_output=True, text=True,
                            env={**os.environ, **env})
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def test_host_folder_follows_xdg_data_home(tmp_path):
    assert bash("cart_data oot", XDG_DATA_HOME=str(tmp_path))[1] == f"{tmp_path}/game-cartridges/oot"


def test_seed_copies_defaults_but_never_overwrites(tmp_path):
    defaults, host = tmp_path / "defaults", tmp_path / "host"
    (defaults / "config").mkdir(parents=True)
    (defaults / "config" / "a.ini").write_text("default")
    (defaults / "config" / "b.ini").write_text("default")
    (host / "config").mkdir(parents=True)
    (host / "config" / "a.ini").write_text("mine")
    assert bash(f'cart_seed "{defaults}" "{host}"')[0] == 0
    assert (host / "config" / "a.ini").read_text() == "mine"
    assert (host / "config" / "b.ini").read_text() == "default"
    assert bash(f'cart_seed "{tmp_path}/missing" "{host}"')[0] == 0


def test_build_choice(tmp_path):
    (tmp_path / "v3").mkdir()
    assert bash(f'cart_build "{tmp_path}"', CART_BUILD="znver4")[1] == "znver4"
    level = bash("cart_cpu_level")[1]
    assert level in ("znver4", "v3", "base")
    code, out, err = bash(f'cart_build "{tmp_path}"')
    if level == "base":
        assert code == 1 and "no build" in err
    else:
        assert (code, out) == (0, "v3")


def test_log_rotation_keeps_five(tmp_path):
    for i in range(7):
        bash(f'cart_logs "{tmp_path}" && echo run{i} > "{tmp_path}/last_run.log"')
    names = sorted(os.listdir(tmp_path))
    assert names == ["last_run.1.log", "last_run.2.log", "last_run.3.log", "last_run.4.log", "last_run.log"]
    assert (tmp_path / "last_run.log").read_text().strip() == "run6"
    assert (tmp_path / "last_run.4.log").read_text().strip() == "run2"
