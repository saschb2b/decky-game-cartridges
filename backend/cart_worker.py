#!/usr/bin/env python3
"""File work for the game cartridges plugin, run as the Decky user (never root), so everything it
creates on a cartridge or in the home folder belongs to that user. Progress goes to stdout as JSON lines.

  cart_worker.py size PATH                 {"bytes": N, "files": N}
  cart_worker.py copy SRC DST              copies the folder SRC to DST (DST must not exist yet)
  cart_worker.py remove PATH               deletes a folder
  cart_worker.py write FILE                writes stdin to FILE atomically
  cart_worker.py install-runtime SRC MP    copies the cartridge runtime (lib.sh, agent/) into MP/cartridge
  cart_worker.py mkdir PATH
  cart_worker.py rename SRC DST
"""
import json
import os
import re
import shutil
import stat
import sys
import time

CHUNK = 64 << 20  # sendfile chunk; also how often a big file is flushed, so progress means bytes on disk


def say(**fields):
    print(json.dumps(fields), flush=True)


def tree_size(path):
    total = files = 0
    for root, _dirs, names in os.walk(path):
        for name in names:
            st = os.lstat(os.path.join(root, name))
            if stat.S_ISREG(st.st_mode):
                total += st.st_size
                files += 1
    return total, files


def copy_tree(src, dst):
    total, files = tree_size(src)
    say(total=total, files=files)
    done = 0
    last = 0.0
    os.makedirs(dst)
    for root, dirs, names in os.walk(src):
        rel = os.path.relpath(root, src)
        out_root = dst if rel == "." else os.path.join(dst, rel)
        for name in dirs:
            s = os.path.join(root, name)
            d = os.path.join(out_root, name)
            if os.path.islink(s):
                os.symlink(os.readlink(s), d)
            else:
                os.mkdir(d)
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
        for name in names:
            s = os.path.join(root, name)
            d = os.path.join(out_root, name)
            st = os.lstat(s)
            if stat.S_ISLNK(st.st_mode):
                os.symlink(os.readlink(s), d)
                continue
            if not stat.S_ISREG(st.st_mode):
                continue
            with open(s, "rb") as fi, open(d, "wb") as fo:
                offset = 0
                while offset < st.st_size:
                    n = os.sendfile(fo.fileno(), fi.fileno(), offset, min(CHUNK, st.st_size - offset))
                    if n == 0:
                        break
                    offset += n
                    done += n
                    if st.st_size > CHUNK:
                        os.fdatasync(fo.fileno())
                    now = time.monotonic()
                    if now - last > 0.5:
                        say(done=done)
                        last = now
                os.fdatasync(fo.fileno())
            if offset != st.st_size:
                raise OSError(f"{s}: copied {offset} of {st.st_size} bytes")
            shutil.copystat(s, d, follow_symlinks=False)
    # Folder times last: writing into a folder changes its mtime.
    for root, _dirs, _names in os.walk(src):
        rel = os.path.relpath(root, src)
        shutil.copystat(root, dst if rel == "." else os.path.join(dst, rel))
    got, got_files = tree_size(dst)
    if (got, got_files) != (total, files):
        raise OSError(f"copy check failed: {got_files} files / {got} bytes, expected {files} / {total}")
    say(done=total)


def write_atomic(path, data):
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def install_runtime(src, mp):
    """lib.sh and agent/ from SRC into MP/cartridge. lib.sh only ever gains helpers, so the newer one
    (the one with every helper of the other) wins."""
    dst = os.path.join(mp, "cartridge")
    os.makedirs(os.path.join(dst, "agent"), exist_ok=True)
    for rel in ("lib.sh", "agent/cartridge-agent.py", "agent/install.sh", "agent/uninstall.sh"):
        s, d = os.path.join(src, rel), os.path.join(dst, rel)
        if not os.path.isfile(s):
            continue
        if os.path.isfile(d) and not _newer(s, d):
            continue
        with open(s, "rb") as f:
            write_atomic(d, f.read())
        os.chmod(d, 0o755 if rel.endswith((".sh", ".py")) else 0o644)


def _newer(src, dst):
    def text(p):
        with open(p, errors="replace") as f:
            return f.read()
    a, b = text(src), text(dst)
    if a == b:
        return False
    if src.endswith("cartridge-agent.py"):
        def version(t):
            return int((re.search(r"^AGENT_VERSION = (\d+)", t, re.M) or [0, 1])[1])
        return version(a) > version(b)

    def helpers(t):
        return set(re.findall(r"^([a-z_]+)\(\)", t, re.M))
    return helpers(a) > helpers(b) or (helpers(a) == helpers(b) and os.path.getmtime(src) > os.path.getmtime(dst))


def main():
    cmd, args = sys.argv[1], sys.argv[2:]
    try:
        if cmd == "size":
            total, files = tree_size(args[0])
            say(bytes=total, files=files)
        elif cmd == "copy":
            copy_tree(args[0], args[1])
        elif cmd == "remove":
            shutil.rmtree(args[0])
        elif cmd == "write":
            write_atomic(args[0], sys.stdin.buffer.read())
        elif cmd == "install-runtime":
            install_runtime(args[0], args[1])
        elif cmd == "mkdir":
            os.makedirs(args[0], exist_ok=True)
        elif cmd == "rename":
            os.rename(args[0], args[1])
        else:
            raise SystemExit(f"unknown command {cmd}")
    except OSError as e:
        say(error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
