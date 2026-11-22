#!/usr/bin/env python3
"""Game cartridges agent: plug in a drive with a cartridge.json at its root and its games appear in the
Steam library; unplug it and they are hidden again (kept under Hidden, with their play time). Runs as a
systemd user service (install.sh).

It watches the mount table, and talks to the running Steam client over its local debug port
(127.0.0.1:8080, the one Decky Loader uses too) to add and remove non-Steam shortcuts live, with the
cartridge's artwork. Nothing on the cartridge runs until you press Play on one of its games.

One Steam shortcut per game id: when a game moves to another cartridge (or to this machine's home
cartridge, ~/Games/HomeCartridge) its shortcut follows it and keeps its app id, play time and
controller layout. When a game is on several plugged-in cartridges, the home copy wins, then the copy
the shortcut already points at.

Steam's own games can live on a cartridge too, in a Steam library folder (SteamLibrary/). Steam manages
them; the agent only adds that folder to Steam while the cartridge is plugged in and removes it when the
cartridge is gone, so they show as installed exactly while the cartridge is there.

State (game id -> shortcut, Steam library folders the agent added): ~/.local/share/game-cartridges/agent-state.json
Log: journalctl --user -u game-cartridges
Re-reads the manifests every 3 s; `kill -USR1 <pid>` (the Decky plugin does this) checks right away.
"""
import base64
import json
import os
import select
import signal
import socket
import sys
import time
import urllib.request

AGENT_VERSION = 3
DATA = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "game-cartridges")
STATE_FILE = os.path.join(DATA, "agent-state.json")
HOME_CARTRIDGE = os.path.expanduser("~/Games/HomeCartridge")
CDP_LIST = "http://127.0.0.1:8080/json"
MOUNT_ROOTS = ("/run/media/", "/media/", "/mnt/", "/var/run/media/")
# Steam's custom artwork slots: portrait capsule, hero, logo, wide capsule.
ART = (("portrait.png", 0), ("hero.png", 1), ("logo.png", 2), ("horizontal.png", 3))
POLL_SECONDS = 3


def log(*parts):
    print(*parts, flush=True)


_last_wait = None


def log_wait(message):
    """Log a 'waiting for Steam' reason once, not on every retry."""
    global _last_wait
    if message != _last_wait:
        _last_wait = message
        log(message)


# ---- mounts and manifests --------------------------------------------------------------------------

def mount_points():
    points = []
    with open("/proc/self/mountinfo") as f:
        for line in f:
            mp = line.split()[4]
            mp = mp.replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")
            if mp.startswith(MOUNT_ROOTS):
                points.append(mp)
    return points


def read_manifest(mp):
    path = os.path.join(mp, "cartridge.json")
    try:
        with open(path) as f:
            manifest = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        log(f"{path}: unreadable ({e})")
        return None
    games = []
    root = os.path.realpath(mp)
    for game in manifest.get("games", []):
        try:
            gid, title, launch = str(game["id"]), str(game["title"]), str(game["launch"])
        except (KeyError, TypeError):
            log(f"{path}: game entry without id/title/launch: {game!r}")
            continue
        exe = os.path.realpath(os.path.join(mp, launch))
        if not exe.startswith(root + os.sep) or not os.path.isfile(exe):
            log(f"{path}: {gid}: launch file {launch!r} is missing or outside the cartridge")
            continue
        art = os.path.realpath(os.path.join(mp, game.get("art", os.path.dirname(launch) + "/art")))
        games.append({"id": gid, "title": title, "exe": exe, "dir": os.path.dirname(exe),
                      "art": art if art.startswith(root + os.sep) else None})
    return {"id": str(manifest.get("id") or os.path.basename(mp)), "name": manifest.get("name", ""), "games": games}


def cartridge_roots():
    """The home cartridge (when this machine has one) first, then the mounted ones."""
    roots = [HOME_CARTRIDGE] if os.path.isfile(os.path.join(HOME_CARTRIDGE, "cartridge.json")) else []
    return roots + sorted(mount_points())


def wanted_shortcuts(state):
    """{game id: game} for every game on the home cartridge and every mounted cartridge. A game found on
    several of them: the home copy, else the copy its shortcut already points at, else the first."""
    copies = {}
    for mp in cartridge_roots():
        manifest = read_manifest(mp)
        if manifest:
            for game in manifest["games"]:
                copies.setdefault(game["id"], []).append(dict(game, cartridge=manifest["id"], mount=mp))
    wanted = {}
    for gid, found in copies.items():
        current = state["shortcuts"].get(gid, {}).get("exe")
        wanted[gid] = next((g for g in found if g["mount"] == HOME_CARTRIDGE), None) \
            or next((g for g in found if g["exe"] == current), found[0])
    return wanted


def wanted_libraries():
    """{path: {cartridge, label}} for the Steam library folder (SteamLibrary/) of every mounted cartridge.
    Steam manages the games in it; the agent only adds the folder to Steam while the cartridge is plugged in."""
    wanted = {}
    for mp in sorted(mount_points()):
        manifest = read_manifest(mp)
        path = os.path.join(mp, "SteamLibrary")
        if manifest and os.path.isdir(path):
            wanted[path] = {"cartridge": manifest["id"], "label": manifest["name"] or os.path.basename(mp)}
    return wanted


# ---- Steam client over the Chrome DevTools Protocol --------------------------------------------------

class SteamUnavailable(Exception):
    pass


class Steam:
    """Evaluates JavaScript in Steam's SharedJSContext (where SteamClient and appStore live)."""

    def __init__(self):
        try:
            with urllib.request.urlopen(CDP_LIST, timeout=3) as r:
                targets = json.load(r)
        except OSError as e:
            raise SteamUnavailable(f"Steam's debug port is not answering ({e})") from e
        page = next((t for t in targets if t.get("title") == "SharedJSContext"), None)
        if not page:
            raise SteamUnavailable("Steam is starting (no SharedJSContext yet)")
        url = page["webSocketDebuggerUrl"]
        host_port, path = url[len("ws://"):].split("/", 1)
        host, port = host_port.rsplit(":", 1)
        self.sock = socket.create_connection((host, int(port)), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise SteamUnavailable("Steam closed the debug connection")
            head += chunk
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise SteamUnavailable(f"Steam refused the debug connection: {head[:80]!r}")
        self.buf = head.split(b"\r\n\r\n", 1)[1]
        self.next_id = 0

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass

    def _send(self, text, opcode=0x1):
        data = text.encode() if isinstance(text, str) else text
        n = len(data)
        header = bytes([0x80 | opcode])
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + n.to_bytes(2, "big")
        else:
            header += bytes([0x80 | 127]) + n.to_bytes(8, "big")
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data)) if n < 4096 else _mask(data, mask)
        self.sock.sendall(header + mask + masked)

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self.buf)))
            if not chunk:
                raise SteamUnavailable("Steam closed the debug connection")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _recv(self):
        message = b""
        while True:
            b0, b1 = self._read(2)
            opcode, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = int.from_bytes(self._read(2), "big")
            elif n == 127:
                n = int.from_bytes(self._read(8), "big")
            mask = self._read(4) if b1 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = _mask(payload, mask)
            if opcode == 0x9:
                self._send(payload, 0xA)
                continue
            if opcode == 0x8:
                raise SteamUnavailable("Steam closed the debug connection")
            message += payload
            if b0 & 0x80:
                return message.decode()

    def eval(self, expression):
        self.next_id += 1
        ident = self.next_id
        self._send(json.dumps({"id": ident, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True, "returnByValue": True}}))
        while True:
            msg = json.loads(self._recv())
            if msg.get("id") != ident:
                continue
            result = msg.get("result", {})
            if "exceptionDetails" in result:
                details = result["exceptionDetails"]
                raise RuntimeError(details.get("exception", {}).get("description") or details.get("text"))
            return result.get("result", {}).get("value")


def _mask(data, mask):
    n = len(data)
    full = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "little") ^ int.from_bytes(full, "little")).to_bytes(n, "little")


JS_READY = "typeof SteamClient !== 'undefined' && typeof appStore !== 'undefined' && appStore.allApps.length > 0"
JS_EXISTS = "(id => !!appStore.GetAppOverviewByAppID(id))({appid})"
JS_HIDDEN = "collectionStore.BIsHidden({appid})"
JS_SET_HIDDEN = "collectionStore.SetAppsAsHidden([{appid}], {hidden})"
JS_FOLDERS = ("SteamClient.InstallFolder.GetInstallFolders().then(fs => fs.map(f => "
              "({index: f.nFolderIndex, path: f.strFolderPath, mounted: f.bIsMounted, label: f.strUserLabel})))")
# Steam can take minutes to notice an unplugged drive on its own. Asking it to remove the folder makes it
# look, and it drops the folder at once when it is gone. True once Steam no longer lists it.
JS_REMOVE_FOLDER = """(async () => {{
  SteamClient.InstallFolder.RemoveInstallFolder({index});
  for (let n = 0; n < 12; n++) {{
    await new Promise(r => setTimeout(r, 250));
    if (!(await SteamClient.InstallFolder.GetInstallFolders()).some(f => f.nFolderIndex === {index})) return true;
  }}
  return false;
}})()"""


def sync_libraries(steam, state, wanted):
    """Steam's library folders follow the cartridges: a plugged-in cartridge's SteamLibrary/ is added (its
    games show as installed), and removed again once the cartridge is gone (they show as not installed).
    A folder that is still on disk is never removed. Returns True when nothing is left to do."""
    libs = state.setdefault("libraries", {})
    folders = {os.path.normpath(f["path"]): f for f in steam.eval(JS_FOLDERS) or []}
    for path, info in sorted(wanted.items()):
        folder = folders.get(os.path.normpath(path))
        if not folder:
            index = steam.eval(f"SteamClient.InstallFolder.AddInstallFolder({json.dumps(path)})")
            if not isinstance(index, int) or index < 0:
                raise RuntimeError(f"Steam did not add the library {path} ({index!r})")
            steam.eval(f"SteamClient.InstallFolder.SetFolderLabel({index}, {json.dumps(info['label'])})")
            log(f"added Steam library {path} of cartridge {info['cartridge']}")
        elif folder["label"] != info["label"]:
            steam.eval(f"SteamClient.InstallFolder.SetFolderLabel({folder['index']}, {json.dumps(info['label'])})")
        if libs.get(path) != info:
            libs[path] = info
            save_state(state)
    done = True
    for path in sorted(set(libs) - set(wanted)):
        folder = folders.get(os.path.normpath(path))
        if folder and not os.path.isdir(path):
            if not steam.eval(JS_REMOVE_FOLDER.format(index=folder["index"])):
                done = False  # Steam kept it: try again on the next check
                continue
            log(f"removed Steam library {path} of cartridge {libs[path]['cartridge']}: the folder is gone")
        # Not in Steam any more, or still on disk (its manifest went unreadable): Steam's entry stays as it is.
        del libs[path]
        save_state(state)
    return done


def js_add(game):
    return f"""(async () => {{
  const name = {json.dumps(game['title'])}, exe = {json.dumps(game['exe'])}, dir = {json.dumps(game['dir'])};
  const id = await SteamClient.Apps.AddShortcut(name, exe, dir, "");
  SteamClient.Apps.SetShortcutName(id, name);
  SteamClient.Apps.SetShortcutExe(id, JSON.stringify(exe));
  SteamClient.Apps.SetShortcutStartDir(id, JSON.stringify(dir));
  return id;
}})()"""


def add_shortcut(steam, game):
    appid = steam.eval(js_add(game))
    if not isinstance(appid, int):
        raise RuntimeError(f"AddShortcut returned {appid!r}")
    art = game.get("art")
    if art:
        for name, slot in ART:
            path = os.path.join(art, name)
            if os.path.isfile(path):
                with open(path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                steam.eval(f"SteamClient.Apps.SetCustomArtworkForApp({appid}, {json.dumps(b64)}, 'png', {slot})")
        icon = os.path.join(art, "icon.png")
        if os.path.isfile(icon):
            steam.eval(f"SteamClient.Apps.SetShortcutIcon({appid}, {json.dumps(icon)})")
    return appid


# ---- reconcile ------------------------------------------------------------------------------------

def load_state():
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {"shortcuts": {}}
    return migrate_state(state)


def migrate_state(state):
    """Agent 1 kept one shortcut per '<cartridge id>|<game id>'; agent 2 keeps one per game id. The same
    game on two cartridges had two shortcuts: the first stays, the others are hidden ('orphans')."""
    shortcuts, orphans = {}, list(state.get("orphans", []))
    for key, entry in sorted(state.get("shortcuts", {}).items(), key=lambda kv: (kv[1].get("hidden", False), kv[0])):
        gid = key.split("|", 1)[1] if "|" in key else key
        if gid in shortcuts:
            orphans.append(entry["appid"])
        else:
            shortcuts[gid] = entry
    state["shortcuts"], state["version"] = shortcuts, AGENT_VERSION
    if orphans:
        state["orphans"] = orphans
    return state


def save_state(state):
    os.makedirs(DATA, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=1, sort_keys=True)
    os.replace(tmp, STATE_FILE)


def _in_sync(state, wanted):
    have = state["shortcuts"]
    for key, game in wanted.items():
        entry = have.get(key)
        if not entry or entry.get("hidden") or entry["exe"] != game["exe"] or entry["title"] != game["title"]:
            return False
    return not state.get("orphans") and all(entry.get("hidden") for key, entry in have.items() if key not in wanted)


def _libraries_in_sync(state, wanted):
    return set(state.get("libraries", {})) == set(wanted)


def reconcile(state):
    """Make Steam match the mounted cartridges: their games shown, games of absent cartridges hidden.
    Hiding (not deleting) keeps each game's Steam entry, play time and settings for the next time the
    cartridge is plugged in. Returns True when nothing is left to do."""
    wanted = wanted_shortcuts(state)
    libraries = wanted_libraries()
    have = state["shortcuts"]
    if _in_sync(state, wanted) and _libraries_in_sync(state, libraries) and not state.get("verify"):
        return True
    try:
        steam = Steam()
    except SteamUnavailable as e:
        log_wait(f"waiting for Steam: {e}")
        return False
    try:
        if not steam.eval(JS_READY):
            log_wait("waiting for Steam's library to load")
            return False
        for appid in list(state.get("orphans", [])):
            if steam.eval(JS_EXISTS.format(appid=appid)) and not steam.eval(JS_HIDDEN.format(appid=appid)):
                steam.eval(JS_SET_HIDDEN.format(appid=appid, hidden="true"))
                log(f"hid duplicate shortcut {appid} (one shortcut per game now)")
            state["orphans"].remove(appid)
            save_state(state)
        state.pop("orphans", None)
        for key in sorted(set(have) - set(wanted)):
            entry = have[key]
            if not steam.eval(JS_EXISTS.format(appid=entry["appid"])):
                del have[key]  # deleted in Steam by hand: forget it
            elif not entry.get("hidden") or not steam.eval(JS_HIDDEN.format(appid=entry["appid"])):
                steam.eval(JS_SET_HIDDEN.format(appid=entry["appid"], hidden="true"))
                entry["hidden"] = True
                log(f"hid {entry['title']!r} (appid {entry['appid']}): no plugged-in cartridge has it")
            save_state(state)
        for key, game in sorted(wanted.items()):
            entry = have.get(key)
            if entry and steam.eval(JS_EXISTS.format(appid=entry["appid"])):
                appid = entry["appid"]
                if entry["exe"] != game["exe"]:
                    steam.eval(f"SteamClient.Apps.SetShortcutExe({appid}, {json.dumps(json.dumps(game['exe']))})")
                    steam.eval(f"SteamClient.Apps.SetShortcutStartDir({appid}, {json.dumps(json.dumps(game['dir']))})")
                    log(f"{game['title']!r}: now runs from cartridge {game['cartridge']} at {game['mount']}")
                if entry["title"] != game["title"]:
                    steam.eval(f"SteamClient.Apps.SetShortcutName({appid}, {json.dumps(game['title'])})")
                    log(f"renamed {entry['title']!r} to {game['title']!r} (appid {appid})")
                if entry.get("hidden") or steam.eval(JS_HIDDEN.format(appid=appid)):
                    steam.eval(JS_SET_HIDDEN.format(appid=appid, hidden="false"))
                    log(f"showed {game['title']!r} (appid {appid}) from cartridge {game['cartridge']} at {game['mount']}")
            else:
                appid = add_shortcut(steam, game)
                log(f"added {game['title']!r} (appid {appid}) from cartridge {game['cartridge']} at {game['mount']}")
            have[key] = {"appid": appid, "title": game["title"], "exe": game["exe"], "cartridge": game["cartridge"],
                         "hidden": False}
            save_state(state)
        if not sync_libraries(steam, state, libraries):
            return False
        state.pop("verify", None)
        save_state(state)
        global _last_wait
        _last_wait = None
        return True
    except (SteamUnavailable, OSError, RuntimeError) as e:
        log_wait(f"Steam call failed, retrying: {e}")
        return False
    finally:
        steam.close()


def main():
    state = load_state()
    state["verify"] = True  # after a restart (or Steam's), check that our shortcuts still exist
    log(f"game cartridges agent {AGENT_VERSION}: watching {HOME_CARTRIDGE} and {', '.join(MOUNT_ROOTS)}")
    mountinfo = open("/proc/self/mountinfo")
    poller = select.poll()
    poller.register(mountinfo, select.POLLPRI | select.POLLERR)
    # SIGUSR1 (sent by the Decky plugin after it changed a cartridge): check now, and verify Steam.
    wake_r, wake_w = os.pipe()
    os.set_blocking(wake_r, False)
    os.set_blocking(wake_w, False)
    signal.set_wakeup_fd(wake_w)
    signal.signal(signal.SIGUSR1, lambda *_: None)
    poller.register(wake_r, select.POLLIN)
    last_steam_pid = None
    while True:
        steam_pid = _steam_pid()
        if steam_pid != last_steam_pid:
            last_steam_pid = steam_pid
            state["verify"] = True  # Steam (re)started: check our shortcuts again
        # A check with nothing to do only reads the mount table and the manifests (no Steam connection),
        # so manifest edits are picked up too. The mount table and SIGUSR1 wake us early.
        reconcile(state)
        events = poller.poll(POLL_SECONDS * 1000)
        for fd, _ in events:
            if fd == wake_r:
                while True:
                    try:
                        if not os.read(wake_r, 64):
                            break
                    except BlockingIOError:
                        break
                state["verify"] = True
                log("checking now (asked by signal)")
            else:
                mountinfo.seek(0)
                mountinfo.read()
                time.sleep(1.5)  # let the automounter finish before reading the cartridge


def _steam_pid():
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            try:
                with open(f"/proc/{pid}/comm") as f:
                    if f.read().strip() == "steam":
                        return pid
            except OSError:
                pass
    return None


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        print("ok" if reconcile(load_state() | {"verify": True}) else "not done")
    else:
        main()
