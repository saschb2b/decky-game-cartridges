"""Decky backend for game cartridges.

Runs as root (plugin flag "root") because formatting a drive needs it. Everything written on a
cartridge or in the user's home goes through backend/cart_worker.py running as the Decky user, so
files keep the user as owner. Steam shortcuts are not touched here: the cartridge agent
(game-cartridges.service, cartridge/agent/) is the only component that adds or hides them; this
backend asks it to look again (SIGUSR1) after changing a cartridge.
"""

import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import signal
import socket
import time

import decky

PLUGIN = Path(decky.DECKY_PLUGIN_DIR)
WORKER = PLUGIN / "backend" / "cart_worker.py"
RUNTIME_SRC = PLUGIN / "cartridge"
USER = decky.DECKY_USER
_pw = pwd.getpwnam(USER)
UID, GID = _pw.pw_uid, _pw.pw_gid
HOME = Path(decky.DECKY_USER_HOME)
DATA = HOME / ".local/share/game-cartridges"
AGENT_STATE = DATA / "agent-state.json"
AGENT_FILE = DATA / "agent" / "cartridge-agent.py"
HOME_CART = HOME / "Games" / "HomeCartridge"
RUN = Path(f"/run/user/{UID}")
MOUNT_ROOTS = ("/run/media/", "/media/", "/mnt/", "/var/run/media/")
SETTINGS = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"
IMAGE_EXT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
SYSTEM_MOUNTS = ("/", "/boot", "/boot/efi", "/efi", "/var", "/home", "/var/home", "/sysroot", "/usr", "/etc")
GAME_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
log = decky.logger


def host_env():
    """Decky's frozen Python sets LD_LIBRARY_PATH for itself; the host's tools need it gone."""
    return {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": str(HOME),
            "USER": USER, "LOGNAME": USER, "LANG": "C.UTF-8", "XDG_RUNTIME_DIR": str(RUN),
            "DBUS_SESSION_BUS_ADDRESS": f"unix:path={RUN}/bus"}


async def run(*args, as_user=False, stdin=None, timeout=120):
    """(returncode, stdout, stderr) of a host command, as root or as the Decky user."""
    extra = {"user": UID, "group": GID, "extra_groups": []} if as_user and os.getuid() == 0 else {}
    try:
        proc = await asyncio.create_subprocess_exec(
            *map(str, args), env=host_env(), stdin=asyncio.subprocess.PIPE if stdin is not None else None,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd="/", **extra)
        out, err = await asyncio.wait_for(proc.communicate(stdin), timeout)
    except (OSError, asyncio.TimeoutError) as error:
        return 1, "", str(error)
    return proc.returncode, out.decode(errors="replace").strip(), err.decode(errors="replace").strip()


async def worker(*args, stdin=None, timeout=600):
    code, out, err = await run("/usr/bin/python3", "-I", WORKER, *args, as_user=True, stdin=stdin, timeout=timeout)
    lines = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    if code != 0:
        problem = next((line["error"] for line in lines if "error" in line), err or f"worker {args[0]} failed")
        raise RuntimeError(problem)
    return lines[-1] if lines else {}


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


async def write_json(path, data):
    await worker("write", path, stdin=(json.dumps(data, indent=1, ensure_ascii=False) + "\n").encode())


def settings():
    return read_json(SETTINGS, {}) or {}


def save_settings(values):
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS.with_suffix(".tmp")
    tmp.write_text(json.dumps(values, indent=1))
    tmp.replace(SETTINGS)


# ---- mounts, drives -----------------------------------------------------------------------------------

def unescape(s):
    return s.replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")


def mounts():
    """[(mount point, source device)] for removable-media mounts."""
    found = []
    with open("/proc/self/mountinfo") as f:
        for line in f:
            left, _, right = line.partition(" - ")
            mp = unescape(left.split()[4])
            source = right.split()[1] if right else ""
            found.append((mp, source))
    return found


async def lsblk():
    code, out, _ = await run("lsblk", "-J", "-b", "-o",
                             "NAME,PATH,SIZE,TRAN,MODEL,VENDOR,SERIAL,TYPE,FSTYPE,LABEL,UUID,MOUNTPOINTS,FSUSED,FSSIZE,PKNAME")
    if code != 0:
        return []
    return json.loads(out).get("blockdevices", [])


def usb_speed(disk_name):
    """Link speed in Mbit/s of the USB device a disk hangs off (480 = USB 2), or None."""
    try:
        path = Path(os.path.realpath(f"/sys/block/{disk_name}"))
    except OSError:
        return None
    for parent in [path, *path.parents]:
        speed = parent / "speed"
        if (parent / "idVendor").exists() and speed.exists():
            try:
                return int(float(speed.read_text().strip()))
            except (OSError, ValueError):
                return None
    return None


def disk_of(devices, dev_path):
    """The whole-disk entry of lsblk that holds the partition (or disk) dev_path."""
    real = os.path.realpath(dev_path)
    for disk in devices:
        if disk.get("path") == real:
            return disk
        for part in disk.get("children") or []:
            if part.get("path") == real:
                return disk
    return None


def mountpoints(entry):
    return [m for m in (entry.get("mountpoints") or []) if m]


def is_cartridge_mount(mp):
    return os.path.isfile(os.path.join(mp, "cartridge.json"))


def top_entries(mp, limit=12):
    try:
        names = sorted(n for n in os.listdir(mp) if n not in ("lost+found", ".Trash-1000", ".trackerignore"))
    except OSError:
        return []
    return names[:limit] + ([f"... and {len(names) - limit} more"] if len(names) > limit else [])


def drive_token(disk):
    parts = [(p.get("name"), p.get("fstype"), p.get("uuid"), p.get("label"), p.get("size"))
             for p in disk.get("children") or []]
    raw = json.dumps([disk.get("path"), disk.get("serial"), disk.get("size"), disk.get("fstype"), parts])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def describe_drive(disk):
    parts = []
    for p in disk.get("children") or ([disk] if disk.get("fstype") else []):
        mps = mountpoints(p)
        parts.append({"name": p.get("name"), "size": p.get("size") or 0, "fstype": p.get("fstype"),
                      "label": p.get("label"), "mounts": mps, "used": p.get("fsused"),
                      "entries": top_entries(mps[0]) if mps else []})
    vendor = (disk.get("vendor") or "").strip()
    model = " ".join(x for x in (vendor if vendor not in ("ATA", "USB", "Generic") else "", (disk.get("model") or "").strip()) if x)
    return {"dev": disk["path"], "name": disk["name"], "model": model or disk["name"], "serial": disk.get("serial"),
            "size": disk.get("size") or 0, "speed": usb_speed(disk["name"]), "partitions": parts,
            "token": drive_token(disk)}


# ---- cartridges ---------------------------------------------------------------------------------------

def is_deck():
    try:
        return Path("/sys/class/dmi/id/board_vendor").read_text().strip() == "Valve"
    except OSError:
        return False


def agent_shortcuts():
    """{game id: {appid, hidden, exe, ...}} from the agent's state (agent 1 keyed '<cartridge>|<game>')."""
    state = read_json(AGENT_STATE, {}) or {}
    out = {}
    for key, entry in (state.get("shortcuts") or {}).items():
        gid = key.split("|", 1)[1] if "|" in key else key
        out.setdefault(gid, entry)
    return out


_sizes = {}  # (path, mtime of launch file) -> bytes
_sizing = set()


def game_size(path):
    try:
        key = (str(path), os.stat(path).st_mtime_ns)
    except OSError:
        return None
    if key in _sizes:
        return _sizes[key]
    if key not in _sizing:
        _sizing.add(key)
        asyncio.get_event_loop().create_task(_measure(key))
    return None


async def _measure(key):
    try:
        _sizes[key] = (await worker("size", key[0], timeout=600))["bytes"]
    except Exception as error:  # noqa: BLE001 - a size is only informative
        log.warning(f"size of {key[0]}: {error}")
    finally:
        _sizing.discard(key)


def cartridge_info(mp, devices, shortcuts, home=False):
    manifest = read_json(os.path.join(mp, "cartridge.json"), {}) or {}
    existing = Path(mp)
    while not existing.is_dir() and existing != existing.parent:
        existing = existing.parent  # the home cartridge before its first game: the home drive's space
    st = os.statvfs(existing)
    default_name = ("This Deck" if is_deck() else "This PC") if home else os.path.basename(mp)
    info = {"mount": str(mp), "home": home, "exists": bool(manifest), "id": str(manifest.get("id") or ""),
            "name": manifest.get("name") or default_name, "format": manifest.get("format", 1),
            "free": st.f_bavail * st.f_frsize, "total": st.f_blocks * st.f_frsize,
            "cover": None, "speed": None, "model": None, "dev": None, "games": [], "steam_library": None}
    cover = manifest.get("cover")
    if cover:
        path = os.path.realpath(os.path.join(mp, cover))
        if path.startswith(os.path.realpath(mp) + os.sep) and os.path.isfile(path):
            info["cover"] = f"{cover}?{int(os.path.getmtime(path))}"
    for lib in ("SteamLibrary", "steamapps"):
        if os.path.isdir(os.path.join(mp, lib)):
            info["steam_library"] = os.path.join(mp, "SteamLibrary") if lib == "SteamLibrary" else str(mp)
    if not home:
        source = next((src for m, src in mounts() if m == str(mp)), None)
        disk = disk_of(devices, source) if source else None
        if disk:
            info.update(dev=disk["path"], model=describe_drive(disk)["model"], speed=usb_speed(disk["name"]))
    for game in manifest.get("games") or []:
        gid = str(game.get("id", ""))
        launch = str(game.get("launch") or f"games/{gid}/launch.sh")
        folder = os.path.join(mp, "games", gid)
        sc = shortcuts.get(gid) or {}
        here = sc.get("exe") == os.path.realpath(os.path.join(mp, launch))
        info["games"].append({"id": gid, "title": str(game.get("title") or gid), "launch": launch,
                              "present": os.path.isfile(os.path.join(mp, launch)),
                              "size": game_size(folder) if os.path.isdir(folder) else None,
                              "appid": sc.get("appid"), "active": here and not sc.get("hidden")})
    return info


async def all_cartridges(devices=None):
    devices = devices if devices is not None else await lsblk()
    shortcuts = agent_shortcuts()
    carts = [cartridge_info(str(HOME_CART), devices, shortcuts, home=True)]
    seen = set()
    for mp, _ in mounts():
        if mp.startswith(MOUNT_ROOTS) and mp not in seen and is_cartridge_mount(mp):
            seen.add(mp)
            carts.append(cartridge_info(mp, devices, shortcuts))
    return carts


def find_cartridge(carts, mount):
    cart = next((c for c in carts if c["mount"] == mount), None)
    if not cart:
        raise RuntimeError(f"no cartridge at {mount}")
    return cart


def load_manifest(mp):
    manifest = read_json(os.path.join(mp, "cartridge.json"))
    if not isinstance(manifest, dict):
        raise RuntimeError(f"{mp}: cartridge.json is missing or unreadable")
    manifest.setdefault("games", [])
    return manifest


async def ensure_home_cartridge():
    if os.path.isfile(HOME_CART / "cartridge.json"):
        return
    await worker("mkdir", HOME_CART / "games")
    await write_json(HOME_CART / "cartridge.json", {"format": 1, "id": "home", "name": "This Deck" if is_deck() else "This PC",
                                                     "home": True, "games": []})
    await worker("install-runtime", RUNTIME_SRC, HOME_CART)


async def write_readme(mp, name):
    text = (PLUGIN / "templates" / "README.txt").read_text().replace("@NAME@", name)
    await worker("write", os.path.join(mp, "README.txt"), stdin=text.encode())


# ---- the agent ----------------------------------------------------------------------------------------

def file_agent_version(path):
    try:
        match = re.search(r"^AGENT_VERSION = (\d+)", Path(path).read_text(), re.M)
    except OSError:
        return None
    return int(match[1]) if match else 1


async def agent_status():
    code, out, _ = await run("systemctl", "--user", "show", "-p", "ActiveState,MainPID,UnitFileState",
                             "game-cartridges.service", as_user=True, timeout=10)
    props = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    return {"installed": AGENT_FILE.is_file(), "running": props.get("ActiveState") == "active",
            "pid": int(props.get("MainPID") or 0), "version": file_agent_version(AGENT_FILE),
            "bundled": file_agent_version(RUNTIME_SRC / "agent" / "cartridge-agent.py")}


async def poke_agent():
    status = await agent_status()
    if not status["running"] or not status["pid"]:
        return
    if (status["version"] or 1) >= 2:
        os.kill(status["pid"], signal.SIGUSR1)
    else:  # agent 1 has no signal handler and only re-reads cartridges on mount changes
        await run("systemctl", "--user", "restart", "game-cartridges.service", as_user=True, timeout=20)


# ---- jobs ---------------------------------------------------------------------------------------------

class Job:
    def __init__(self, kind, title, **fields):
        self.id = secrets.token_hex(4)
        self.kind, self.title = kind, title
        self.state, self.message, self.error = "queued", "Waiting", None
        self.done = self.total = 0
        self.fields = fields
        self.proc = None
        self.cancelled = False
        self.finished_at = None
        self.samples = []  # (time, bytes done) over the last seconds, for the speed

    def progress(self, done):
        now = time.monotonic()
        self.done = done
        self.samples = [(t, d) for t, d in self.samples if now - t < 6] + [(now, done)]

    def rate(self):
        if len(self.samples) < 2 or self.state != "running":
            return None
        (t0, d0), (t1, d1) = self.samples[0], self.samples[-1]
        return (d1 - d0) / (t1 - t0) if t1 - t0 >= 1 else None

    def view(self):
        return {"id": self.id, "kind": self.kind, "title": self.title, "state": self.state, "message": self.message,
                "error": self.error, "done": self.done, "total": self.total, "rate": self.rate(),
                "age": round(time.time() - self.finished_at) if self.finished_at else None, **self.fields}


JOBS: list = []
_queue: asyncio.Queue = None


async def job_runner():
    while True:
        job, work = await _queue.get()
        if job.cancelled:
            continue
        job.state = "running"
        try:
            await work(job)
            job.state, job.message = "done", job.message if job.message != "Waiting" else "Done"
        except asyncio.CancelledError:
            job.state, job.message = "cancelled", "Cancelled"
            raise
        except Exception as error:  # noqa: BLE001 - reported to the user
            log.exception(f"job {job.title}")
            job.state, job.error = ("cancelled", None) if job.cancelled else ("failed", str(error))
            job.message = "Cancelled" if job.cancelled else "Failed"
        job.finished_at = time.time()
        try:
            await poke_agent()
        except Exception as error:  # noqa: BLE001
            log.warning(f"poke agent: {error}")


def enqueue(job, work):
    JOBS[:] = [j for j in JOBS if not (j.finished_at and time.time() - j.finished_at > 600)]
    JOBS.append(job)
    _queue.put_nowait((job, work))
    return job.view()


async def copy_with_progress(job, src, dst):
    args = ["/usr/bin/python3", "-I", str(WORKER), "copy", str(src), str(dst)]
    proc = await asyncio.create_subprocess_exec(*args, env=host_env(), stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.PIPE, cwd="/",
                                                **({"user": UID, "group": GID, "extra_groups": []} if os.getuid() == 0 else {}))
    job.proc = proc
    error = None
    async for raw in proc.stdout:
        try:
            line = json.loads(raw)
        except ValueError:
            continue
        job.total = line.get("total", job.total)
        if "done" in line:
            job.progress(line["done"])
        error = line.get("error", error)
    stderr = (await proc.stderr.read()).decode(errors="replace").strip()
    await proc.wait()
    job.proc = None
    if job.cancelled:
        raise RuntimeError("cancelled")
    if proc.returncode != 0:
        raise RuntimeError(error or (stderr.splitlines()[-1] if stderr else f"copy failed ({proc.returncode})"))


# ---- formatting ---------------------------------------------------------------------------------------

def make_label(name):
    """ext4 labels hold 16 bytes; the label is also the mount folder name, so no slashes."""
    label = re.sub(r"[/\\\x00-\x1f]", "", name).strip() or "Cartridge"
    while len(label.encode()) > 16:
        label = label[:-1]
    return label.strip()


def make_id(name):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:24] or "cartridge"
    return f"{slug}-{secrets.token_hex(2)}"


async def wait_for_mount(part, seconds=25):
    real = os.path.realpath(part)
    for _ in range(seconds * 4):
        for mp, source in mounts():
            if source == real and mp.startswith(MOUNT_ROOTS):
                return mp
        await asyncio.sleep(0.25)
    return None


async def mount_partition(part, label):
    """Mount the way the OS auto-mounts a plugged-in drive (SteamOS/Bazzite's steamos-automount: udisks,
    /run/media/<user>/<label>, the user's mount options). Its udev handler ignores synthetic add events
    ("not inserted recently"), so the script is called directly; a udev event and a plain mount are
    fallbacks for other systems."""
    name = os.path.basename(part)
    for script in ("/usr/libexec/hwsupport/steamos-automount.sh", "/usr/lib/hwsupport/steamos-automount.sh"):
        if os.path.exists(script):
            await run(script, "add", name, timeout=60)
            mp = await wait_for_mount(part, 5)
            if mp:
                return mp
    await run("udevadm", "trigger", "--action=add", f"/sys/class/block/{name}")
    mp = await wait_for_mount(part, 8)
    if mp:
        return mp
    mp = f"/run/media/{USER}/{label}"
    os.makedirs(mp, exist_ok=True)
    code, _, err = await run("mount", "-o", "rw,noatime,lazytime", part, mp)
    if code != 0:
        raise RuntimeError(f"formatted, but mounting failed: {err}")
    return mp


async def unmount_disk(disk):
    await run("sync", timeout=300)
    for part in [*(disk.get("children") or []), disk]:
        for mp in mountpoints(part):
            if mp in SYSTEM_MOUNTS or not mp.startswith(MOUNT_ROOTS):
                raise RuntimeError(f"{part['path']} is mounted at {mp}; refusing")
            code, _, err = await run("umount", mp, timeout=60)
            if code != 0:
                _, users, _ = await run("fuser", "-vm", mp, timeout=10)
                raise RuntimeError(f"{mp} is busy (is a game from it still running?): {err} {users}".strip())


# ---- plugin API ---------------------------------------------------------------------------------------

class Plugin:
    async def _main(self):
        global _queue
        _queue = asyncio.Queue()
        self.runner = asyncio.get_event_loop().create_task(job_runner())
        log.info(f"game cartridges backend up (uid {os.getuid()}, user {USER})")

    async def _unload(self):
        for job in JOBS:
            if job.proc:
                job.cancelled = True
                job.proc.kill()
        self.runner.cancel()

    async def _uninstall(self):
        pass

    async def get_state(self):
        devices = await lsblk()
        carts = await all_cartridges(devices)
        cart_devs = {c["dev"] for c in carts if c.get("dev")}
        drives = []
        for disk in devices:
            if disk.get("type") != "disk" or disk.get("tran") != "usb" or disk["path"] in cart_devs:
                continue
            mps = [mp for p in [disk, *(disk.get("children") or [])] for mp in mountpoints(p)]
            if any(is_cartridge_mount(mp) or not mp.startswith(MOUNT_ROOTS) for mp in mps):
                continue  # a cartridge already, or holds system mounts (never offered for erasing)
            drives.append(describe_drive(disk))
        return {"cartridges": carts, "drives": drives, "agent": await agent_status(),
                "jobs": [j.view() for j in JOBS], "home_path": str(HOME_CART), "deck": is_deck()}

    async def get_token(self):
        """Changes whenever drives, mounts, manifests or the agent's shortcuts change (cheap to poll)."""
        parts = [str(sorted(os.listdir("/sys/block")))]
        for mp, source in mounts():
            if mp.startswith(MOUNT_ROOTS) or mp == str(HOME_CART):
                parts.append(f"{mp}|{source}")
        for path in [HOME_CART / "cartridge.json", AGENT_STATE,
                     *(Path(mp) / "cartridge.json" for mp, _ in mounts() if mp.startswith(MOUNT_ROOTS))]:
            try:
                parts.append(f"{path}|{path.stat().st_mtime_ns}")
            except OSError:
                pass
        parts.extend(f"{j.id}|{j.state}" for j in JOBS)
        return hashlib.sha1("\n".join(parts).encode()).hexdigest()

    async def get_jobs(self):
        return [j.view() for j in JOBS]

    async def get_cover(self, mount):
        manifest = read_json(os.path.join(mount, "cartridge.json"), {}) or {}
        cover = manifest.get("cover")
        if not cover:
            return None
        path = os.path.realpath(os.path.join(mount, cover))
        if not path.startswith(os.path.realpath(mount) + os.sep):
            return None
        return self._data_url(path)

    def _data_url(self, path, limit=40 << 20):
        mime = IMAGE_EXT.get(os.path.splitext(path)[1].lower())
        if not mime or not os.path.isfile(path) or os.path.getsize(path) > limit:
            return None
        return f"data:{mime};base64," + base64.b64encode(Path(path).read_bytes()).decode()

    async def read_image(self, path):
        """An image the user picked (for a cover), as a data URL. Only from the home folder or a drive."""
        real = os.path.realpath(path)
        home = os.path.realpath(HOME)  # /home is a symlink to /var/home on Bazzite and SteamOS
        if not (real.startswith(home + os.sep) or real.startswith(MOUNT_ROOTS)):
            return None
        return self._data_url(real)

    async def get_game_art(self, mount, game_id):
        """Small artwork for a game on a cartridge (icon, else portrait), as a data URL."""
        if not GAME_ID.match(game_id):
            return None
        manifest = read_json(os.path.join(mount, "cartridge.json"), {}) or {}
        game = next((g for g in manifest.get("games") or [] if g.get("id") == game_id), None)
        if not game:
            return None
        art = os.path.realpath(os.path.join(mount, game.get("art") or f"games/{game_id}/art"))
        if not art.startswith(os.path.realpath(mount) + os.sep):
            return None
        for name in ("portrait.png", "icon.png"):
            url = self._data_url(os.path.join(art, name), 4 << 20)
            if url:
                return url
        return None

    async def set_cover(self, mount, jpeg_b64):
        carts = await all_cartridges()
        cart = find_cartridge(carts, mount)
        if cart["home"]:
            await ensure_home_cartridge()
        manifest = load_manifest(mount)
        if jpeg_b64:
            await worker("write", os.path.join(mount, "cover.jpg"), stdin=base64.b64decode(jpeg_b64))
            manifest["cover"] = "cover.jpg"
        else:
            manifest.pop("cover", None)
        await write_json(os.path.join(mount, "cartridge.json"), manifest)
        return True

    async def rename_cartridge(self, mount, name):
        name = name.strip()
        if not name:
            raise RuntimeError("the name is empty")
        carts = await all_cartridges()
        cart = find_cartridge(carts, mount)
        if cart["home"]:
            await ensure_home_cartridge()
        manifest = load_manifest(mount)
        manifest["name"] = name
        await write_json(os.path.join(mount, "cartridge.json"), manifest)
        if not cart["home"]:
            source = next((src for m, src in mounts() if m == mount), None)
            if source and source.startswith("/dev/"):
                code, _, err = await run("e2label", source, make_label(name))
                if code != 0:
                    log.warning(f"e2label {source}: {err}")
                # The kernel sends no uevent for a relabel; refresh udev's view (lsblk, by-label).
                await run("udevadm", "trigger", "--action=change", f"/sys/class/block/{os.path.basename(source)}")
        return True

    async def set_steam_library(self, mount):
        """Creates the SteamLibrary folder on a cartridge (the frontend then adds it in Steam)."""
        find_cartridge(await all_cartridges(), mount)
        path = os.path.join(mount, "SteamLibrary")
        await worker("mkdir", path)
        return path

    async def eject(self, mount):
        devices = await lsblk()
        source = next((src for m, src in mounts() if m == mount), None)
        disk = disk_of(devices, source) if source else None
        if not disk or disk.get("tran") != "usb":
            raise RuntimeError(f"{mount} is not on a USB drive")
        await unmount_disk(disk)
        await poke_agent()
        code, _, err = await run("udisksctl", "power-off", "-b", disk["path"], "--no-user-interaction", timeout=30)
        if code != 0:
            log.warning(f"power-off {disk['path']}: {err}")
        return True

    async def install_agent(self):
        code, out, err = await run("bash", RUNTIME_SRC / "agent" / "install.sh", as_user=True, timeout=60)
        if code != 0:
            raise RuntimeError(err or out or "install.sh failed")
        return out

    async def cancel_job(self, job_id):
        job = next((j for j in JOBS if j.id == job_id), None)
        if job and job.state in ("queued", "running"):
            job.cancelled = True
            if job.proc:
                job.proc.kill()
            if job.state == "queued":
                job.state, job.message, job.finished_at = "cancelled", "Cancelled", time.time()
        return True

    async def copy_game(self, src_mount, game_id, dst_mount, move):
        """Copies (or moves) games/<id> to another cartridge (or the home cartridge) as a job."""
        if not GAME_ID.match(game_id):
            raise RuntimeError(f"bad game id {game_id!r}")
        carts = await all_cartridges()
        src, dst = find_cartridge(carts, src_mount), find_cartridge(carts, dst_mount)
        if src_mount == dst_mount:
            raise RuntimeError("source and target are the same cartridge")
        game = next((g for g in load_manifest(src_mount)["games"] if g.get("id") == game_id), None)
        if not game:
            raise RuntimeError(f"{src['name']} has no game {game_id}")
        if dst["exists"] and any(g["id"] == game_id for g in dst["games"]):
            raise RuntimeError(f"{dst['name']} already has {game['title']}")
        verb = "Moving" if move else "Copying"
        job = Job("move" if move else "copy", f"{verb} {game['title']} to {dst['name']}",
                  game=game_id, src=src_mount, dst=dst_mount, subject=game["title"], src_name=src["name"],
                  dst_name=dst["name"])

        async def work(job):
            folder = os.path.join(src_mount, "games", game_id)
            job.message = "Measuring the game"
            size = (await worker("size", folder, timeout=900))["bytes"]
            if dst["home"]:
                await ensure_home_cartridge()
            free = os.statvfs(dst_mount).f_bavail * os.statvfs(dst_mount).f_frsize
            if size + (512 << 20) > free:
                raise RuntimeError(f"not enough space on {dst['name']}: needs {size / 1e9:.1f} GB, "
                                   f"{free / 1e9:.1f} GB free")
            target = os.path.join(dst_mount, "games", game_id)
            partial = os.path.join(dst_mount, "games", f".{game_id}.partial")
            if os.path.lexists(target):
                raise RuntimeError(f"{target} already exists")
            if os.path.lexists(partial):
                await worker("remove", partial, timeout=900)
            await worker("mkdir", os.path.join(dst_mount, "games"))
            await worker("install-runtime", RUNTIME_SRC, dst_mount)
            # Games source ../../cartridge/lib.sh: bring the source's if it has helpers ours lacks.
            await worker("install-runtime", os.path.join(src_mount, "cartridge"), dst_mount)
            job.message = "Copying files"
            try:
                await copy_with_progress(job, folder, partial)
            except BaseException:
                if os.path.lexists(partial):
                    await worker("remove", partial, timeout=900)
                raise
            await worker("rename", partial, target)
            manifest = load_manifest(dst_mount)
            manifest["games"] = [g for g in manifest["games"] if g.get("id") != game_id] + [game]
            await write_json(os.path.join(dst_mount, "cartridge.json"), manifest)
            if move:
                job.message = "Removing the original"
                manifest = load_manifest(src_mount)
                manifest["games"] = [g for g in manifest["games"] if g.get("id") != game_id]
                await write_json(os.path.join(src_mount, "cartridge.json"), manifest)
                await poke_agent()  # the shortcut moves to the new copy before the old one goes
                await worker("remove", folder, timeout=1800)
            job.message = f"{'Moved' if move else 'Copied'} to {dst['name']}"

        return enqueue(job, work)

    async def remove_game(self, mount, game_id):
        if not GAME_ID.match(game_id):
            raise RuntimeError(f"bad game id {game_id!r}")
        cart = find_cartridge(await all_cartridges(), mount)
        game = next((g for g in load_manifest(mount)["games"] if g.get("id") == game_id), None)
        if not game:
            raise RuntimeError(f"{cart['name']} has no game {game_id}")
        job = Job("remove", f"Removing {game['title']} from {cart['name']}", game=game_id, src=mount,
                  subject=game["title"], src_name=cart["name"])

        async def work(job):
            manifest = load_manifest(mount)
            manifest["games"] = [g for g in manifest["games"] if g.get("id") != game_id]
            await write_json(os.path.join(mount, "cartridge.json"), manifest)
            await poke_agent()
            folder = os.path.join(mount, "games", game_id)
            if os.path.isdir(folder):
                job.message = "Deleting files"
                await worker("remove", folder, timeout=1800)
            job.message = f"Removed from {cart['name']}"

        return enqueue(job, work)

    async def format_drive(self, dev, token, name, cover_b64):
        """Erases a USB drive and makes it an empty cartridge. token: from get_state, so the drive the user
        confirmed (model, size, partitions) is the one that gets erased."""
        name = (name or "").strip()
        if not name:
            raise RuntimeError("the cartridge needs a name")
        devices = await lsblk()
        disk = next((d for d in devices if d.get("path") == dev), None)
        if not disk or disk.get("type") != "disk" or disk.get("tran") != "usb":
            raise RuntimeError(f"{dev} is not a plugged-in USB drive")
        if drive_token(disk) != token:
            raise RuntimeError("the drive changed since you confirmed; look at it again")
        if not re.fullmatch(r"/dev/sd[a-z]+", disk["path"]):
            raise RuntimeError(f"{dev} is not a USB disk this plugin can format")
        info = describe_drive(disk)
        label = make_label(name)
        job = Job("format", f"Making {info['model']} the cartridge {name}", dev=dev, subject=name,
                  src_name=info["model"])

        async def work(job):
            job.message = "Unmounting"
            await unmount_disk(disk)
            job.message = "Erasing"
            for part in disk.get("children") or []:
                await run("wipefs", "-a", part["path"])
            code, _, err = await run("wipefs", "-a", disk["path"])
            if code != 0:
                raise RuntimeError(f"wipefs: {err}")
            code, _, err = await run("parted", "--script", disk["path"], "mklabel", "gpt",
                                     "mkpart", "cartridge", "ext4", "0%", "100%")
            if code != 0:
                raise RuntimeError(f"parted: {err}")
            await run("udevadm", "settle", timeout=30)
            part = None
            for _ in range(40):
                fresh = next((d for d in await lsblk() if d.get("path") == disk["path"]), None)
                children = (fresh or {}).get("children") or []
                if len(children) == 1 and os.path.exists(children[0]["path"]):
                    part = children[0]["path"]
                    break
                await asyncio.sleep(0.25)
            if not part:
                raise RuntimeError("the new partition did not show up")
            job.message = "Creating the file system"
            code, _, err = await run("mkfs.ext4", "-q", "-F", "-m", "0", "-O", "casefold",
                                     "-E", f"nodiscard,root_owner={UID}:{GID}", "-L", label, part, timeout=600)
            if code != 0:
                raise RuntimeError(f"mkfs.ext4: {err}")
            await run("sync", timeout=120)
            await run("udevadm", "settle", timeout=30)
            job.message = "Mounting"
            mp = await mount_partition(part, label)
            job.message = "Writing cartridge files"
            await worker("mkdir", os.path.join(mp, "games"))
            await worker("install-runtime", RUNTIME_SRC, mp)
            manifest = {"format": 1, "id": make_id(name), "name": name, "games": []}
            if cover_b64:
                await worker("write", os.path.join(mp, "cover.jpg"), stdin=base64.b64decode(cover_b64))
                manifest["cover"] = "cover.jpg"
            await write_json(os.path.join(mp, "cartridge.json"), manifest)
            await write_readme(mp, name)
            job.fields["mount"] = mp
            job.message = f"Ready at {mp}"

        return enqueue(job, work)
