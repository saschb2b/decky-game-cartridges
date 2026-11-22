#!/usr/bin/env python3
"""Game cartridges agent: plug in a drive with a cartridge.json at its root and its games appear in the
Steam library; unplug it and they are hidden again (kept under Hidden, with their play time). Runs as a systemd user service (install.sh).

It watches the mount table, and talks to the running Steam client over its local debug port
(127.0.0.1:8080, the one Decky Loader uses too) to add and remove non-Steam shortcuts live, with the
cartridge's artwork. Nothing on the cartridge runs until you press Play on one of its games.

State (which shortcut belongs to which cartridge): ~/.local/share/game-cartridges/agent-state.json
Log: journalctl --user -u game-cartridges
"""
import base64
import json
import os
import select
import socket
import sys
import time
import urllib.request

DATA = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "game-cartridges")
STATE_FILE = os.path.join(DATA, "agent-state.json")
CDP_LIST = "http://127.0.0.1:8080/json"
MOUNT_ROOTS = ("/run/media/", "/media/", "/mnt/", "/var/run/media/")
# Steam's custom artwork slots: portrait capsule, hero, logo, wide capsule.
ART = (("portrait.png", 0), ("hero.png", 1), ("logo.png", 2), ("horizontal.png", 3))
RECHECK_SECONDS = 10


def log(*parts):
    print(*parts, flush=True)


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


def wanted_shortcuts():
    """{key: game} for every game on every mounted cartridge. key = '<cartridge id>|<game id>'."""
    wanted = {}
    for mp in mount_points():
        manifest = read_manifest(mp)
        if manifest:
            for game in manifest["games"]:
                wanted.setdefault(f"{manifest['id']}|{game['id']}", dict(game, cartridge=manifest["id"], mount=mp))
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
            raise SteamUnavailable(f"Steam's debug port is not answering ({e})")
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
            return json.load(f)
    except (OSError, ValueError):
        return {"shortcuts": {}}


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
        if not entry or entry.get("hidden") or entry["exe"] != game["exe"]:
            return False
    return all(entry.get("hidden") for key, entry in have.items() if key not in wanted)


def reconcile(state):
    """Make Steam match the mounted cartridges: their games shown, games of absent cartridges hidden.
    Hiding (not deleting) keeps each game's Steam entry, play time and settings for the next time the
    cartridge is plugged in. Returns True when nothing is left to do."""
    wanted = wanted_shortcuts()
    have = state["shortcuts"]
    if _in_sync(state, wanted) and not state.get("verify"):
        return True
    try:
        steam = Steam()
    except SteamUnavailable as e:
        log(f"waiting for Steam: {e}")
        return False
    try:
        if not steam.eval(JS_READY):
            log("waiting for Steam's library to load")
            return False
        for key in sorted(set(have) - set(wanted)):
            entry = have[key]
            if not steam.eval(JS_EXISTS.format(appid=entry["appid"])):
                del have[key]  # deleted in Steam by hand: forget it
            elif not entry.get("hidden") or not steam.eval(JS_HIDDEN.format(appid=entry["appid"])):
                steam.eval(JS_SET_HIDDEN.format(appid=entry["appid"], hidden="true"))
                entry["hidden"] = True
                log(f"hid {entry['title']!r} (appid {entry['appid']}): cartridge {entry['cartridge']} is not plugged in")
            save_state(state)
        for key, game in sorted(wanted.items()):
            entry = have.get(key)
            if entry and steam.eval(JS_EXISTS.format(appid=entry["appid"])):
                appid = entry["appid"]
                if entry["exe"] != game["exe"]:
                    steam.eval(f"SteamClient.Apps.SetShortcutExe({appid}, {json.dumps(json.dumps(game['exe']))})")
                    steam.eval(f"SteamClient.Apps.SetShortcutStartDir({appid}, {json.dumps(json.dumps(game['dir']))})")
                    log(f"{game['title']!r}: cartridge now at {game['mount']}")
                if entry.get("hidden") or steam.eval(JS_HIDDEN.format(appid=appid)):
                    steam.eval(JS_SET_HIDDEN.format(appid=appid, hidden="false"))
                    log(f"showed {game['title']!r} (appid {appid}) from cartridge {game['cartridge']} at {game['mount']}")
            else:
                appid = add_shortcut(steam, game)
                log(f"added {game['title']!r} (appid {appid}) from cartridge {game['cartridge']} at {game['mount']}")
            have[key] = {"appid": appid, "title": game["title"], "exe": game["exe"], "cartridge": game["cartridge"],
                         "hidden": False}
            save_state(state)
        state.pop("verify", None)
        save_state(state)
        return True
    except (SteamUnavailable, OSError, RuntimeError) as e:
        log(f"Steam call failed, retrying: {e}")
        return False
    finally:
        steam.close()


def main():
    state = load_state()
    state["verify"] = True  # after a restart (or Steam's), check that our shortcuts still exist
    log(f"game cartridges agent: watching {', '.join(MOUNT_ROOTS)}")
    mountinfo = open("/proc/self/mountinfo")
    poller = select.poll()
    poller.register(mountinfo, select.POLLPRI | select.POLLERR)
    done = False
    last_steam_pid = None
    while True:
        steam_pid = _steam_pid()
        if steam_pid != last_steam_pid:
            last_steam_pid = steam_pid
            state["verify"] = True  # Steam (re)started: shortcuts may need checking
            done = False
        if not done:
            done = reconcile(state)
        events = poller.poll(RECHECK_SECONDS * 1000 if done else 3000)
        if events:
            mountinfo.seek(0)
            mountinfo.read()
            time.sleep(1.5)  # let the automounter finish (and the filesystem settle) before reading
            done = False


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
