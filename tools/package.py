#!/usr/bin/env python3
"""Build out/game-cartridges.zip in the layout Decky Loader installs."""

import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FOLDER = "game-cartridges"
FILES = ["plugin.json", "package.json", "main.py", "LICENSE", "README.md", "FORMAT.md", "dist/index.js",
         "backend/cart_worker.py", "templates/README.txt", "cartridge/lib.sh", "cartridge/agent/cartridge-agent.py",
         "cartridge/agent/install.sh", "cartridge/agent/uninstall.sh"]


def main():
    out = ROOT / "out" / f"{FOLDER}.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            info = zipfile.ZipInfo.from_file(ROOT / name, f"{FOLDER}/{name}")
            mode = 0o755 if name.endswith((".sh", "cartridge-agent.py", "cart_worker.py")) else 0o644
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, (ROOT / name).read_bytes())
    version = json.loads((ROOT / "package.json").read_text())["version"]
    print(json.dumps({"zip": str(out), "version": version,
                      "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
