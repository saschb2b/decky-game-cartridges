import json
import os

import pytest


def test_copy_tree_copies_files_links_and_times(worker, tmp_path, capsys):
    src = tmp_path / "src"
    (src / "data" / "deep").mkdir(parents=True)
    (src / "launch.sh").write_text("#!/bin/sh\n")
    (src / "data" / "deep" / "big.bin").write_bytes(os.urandom(300_000))
    os.symlink("data/deep/big.bin", src / "link")
    os.utime(src / "launch.sh", (1_000_000, 1_000_000))

    worker.copy_tree(str(src), str(tmp_path / "dst"))

    dst = tmp_path / "dst"
    assert (dst / "data" / "deep" / "big.bin").read_bytes() == (src / "data" / "deep" / "big.bin").read_bytes()
    assert os.readlink(dst / "link") == "data/deep/big.bin"
    assert os.stat(dst / "launch.sh").st_mtime == 1_000_000
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert lines[0] == {"total": 300_000 + 10, "files": 2}
    assert lines[-1] == {"done": 300_000 + 10}


def test_copy_tree_refuses_an_existing_target(worker, tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "dst").mkdir()
    with pytest.raises(FileExistsError):
        worker.copy_tree(str(tmp_path / "src"), str(tmp_path / "dst"))


def test_runtime_update_never_downgrades_the_agent(worker, tmp_path):
    plugin = tmp_path / "plugin"
    (plugin / "agent").mkdir(parents=True)
    (plugin / "lib.sh").write_text("cart_data() {\n}\n")
    (plugin / "agent" / "cartridge-agent.py").write_text("AGENT_VERSION = 2\n")
    cart = tmp_path / "cart"
    (cart / "cartridge" / "agent").mkdir(parents=True)
    (cart / "cartridge" / "lib.sh").write_text("cart_data() {\n}\ncart_newer() {\n}\n")
    (cart / "cartridge" / "agent" / "cartridge-agent.py").write_text("AGENT_VERSION = 3\n")

    worker.install_runtime(str(plugin), str(cart))
    assert (cart / "cartridge" / "agent" / "cartridge-agent.py").read_text() == "AGENT_VERSION = 3\n"
    assert "cart_newer" in (cart / "cartridge" / "lib.sh").read_text()

    (plugin / "agent" / "cartridge-agent.py").write_text("AGENT_VERSION = 4\n")
    worker.install_runtime(str(plugin), str(cart))
    assert (cart / "cartridge" / "agent" / "cartridge-agent.py").read_text() == "AGENT_VERSION = 4\n"
    assert os.access(cart / "cartridge" / "agent" / "cartridge-agent.py", os.X_OK)
