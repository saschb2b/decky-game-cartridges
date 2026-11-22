# Game Cartridges

USB SSDs as game cartridges for Bazzite and SteamOS. Plug one in and its games appear in the Steam
library; unplug it and they are hidden again. Saves stay on each machine. The format is described in
[FORMAT.md](FORMAT.md).

This repository has three parts:

- `cartridge/`: what every cartridge carries (launcher helpers `lib.sh`, and the agent that shows
  and hides games in Steam). Machines without Decky only need the agent.
- the Decky plugin (`main.py`, `backend/`, `src/`): formats drives into cartridges and manages
  them from the Quick Access menu in Game Mode.
- `tools/format-cartridge.sh`: formatting from a shell, without the plugin.

## Using the plugin

Open the Quick Access menu (the `…` button), then the plug icon, then **Game Cartridges**.

**First time on a machine.** If the panel says the cartridge service is missing or outdated, press
**Install** or **Update**. That sets up `game-cartridges.service` for your user (no system changes).

**Make a cartridge.** Plug in an SSD. It shows under **New cartridge**. Pick it, type a name (Steam's
keyboard opens when you select the field), and optionally choose a cover image (PNG, JPEG or WebP
from your home folder or a drive; it is cropped to a 2:3 portrait). Without one, the label shows the hero art of the cartridge's games,
taking turns every few seconds when there are several. **Erase and make cartridge…**
shows the drive's model, size and what is on it, and erases it only after you confirm. The drive
becomes an empty ext4 cartridge, mounted at `/run/media/<you>/<name>`.

**See what's on a cartridge.** Each plugged-in cartridge has its own section: cover, free space, and
its games. A warning appears when the drive runs at USB 2 speed (480 Mbit/s); move it to a USB 3
port (blue, teal or USB-C), or games load very slowly. **This PC** (or **This Deck**) is the
machine's internal storage in the same layout (`~/Games/HomeCartridge`).

**Copy, move or remove a game.** Select a game in the panel, or open the game's options menu in the
Steam library and choose **Game cartridge…**. Pick **Copy** or **Move** next to a target
(another cartridge or This PC), or **Remove from …**. Progress shows at the top of the panel with
speed and time left; **Cancel** stops a copy and deletes the partial files. A moved game keeps its
Steam entry, play time and controller layout.

**Manage a cartridge.** **Manage cartridge…** renames it (the drive label follows; the mount folder
changes the next time it is plugged in), adds or changes the cover, adds a Steam library to it,
and ejects it safely.

**Steam games.** For an installed Steam game, **Game cartridge…** moves it with Steam's own "Move
install folder" into a Steam library on the cartridge (it offers to create one). That suits your own
machines: on another one, add the library once in Steam's storage settings, and the game needs your
account or Family Sharing.

In Steam each plugged-in cartridge also gets a collection with its name. Steam collections can't
show a custom picture, so the cover appears in the plugin.

**Friends' machines without Decky.** They run the agent from the cartridge once (Desktop mode,
Konsole): `bash /run/media/$USER/<name>/cartridge/agent/install.sh`. Its `README.txt` says the same.

## Which games can go on a cartridge

Games in the cartridge layout: a `games/<id>/` folder with a self-locating `launch.sh` that keeps
saves and settings in `~/.local/share/game-cartridges/<id>/` (see the Zelda reference in
`reference-zelda/`). Other non-Steam shortcuts need converting by hand first. Steam games go through
a Steam library on the cartridge (above).

## Building and installing

```bash
pnpm install
pnpm run build
python3 tools/package.py          # out/game-cartridges.zip, Decky's plugin layout
```

`tools/install.sh` builds, copies the zip to a machine and installs it through Decky's own installer,
confirming Decky's prompt over Steam's debug port. It needs an SSH tunnel to that port:

```bash
ssh -N -L 18090:127.0.0.1:8080 user@machine
```

```bash
HOST=user@machine tools/install.sh
```

The plugin's backend runs as root (Decky's `root` flag) so it can format drives; everything it writes
on a cartridge or in your home folder is written as your user. Steam shortcuts are only ever added
by the agent, so the plugin and the agent never both add the same game.

Logs: Decky's plugin log (`~/homebrew/logs/game-cartridges/`), and the agent's
`journalctl --user -u game-cartridges`.
