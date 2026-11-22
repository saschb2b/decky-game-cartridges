# Game cartridge format, version 1

A cartridge is a USB SSD that carries games. Plug it into any Bazzite PC or Steam Deck that has the
cartridge agent installed and its games appear in the Steam library; unplug it and they are hidden.
Saves never travel: every machine keeps its own.

The first cartridge, "Zelda", was built on the Bazzite PC (see the reference files in `cartridge/`
and `reference-zelda/`). This format is what that cartridge uses today.

## Drive

- One GPT partition, ext4, `-m 0 -O casefold`, root owned by uid/gid 1000, filesystem label = the
  cartridge name (e.g. `Zelda`). ext4 because stock SteamOS auto-mounts ext4 (not btrfs); Bazzite's
  own Steam "Format" makes btrfs, so it is not used. `tools/format-cartridge.sh` does this (root).
- Auto-mounted by the OS at `/run/media/<user>/<label>` (Bazzite and SteamOS both).
- Connect it to a USB 3 port: on USB 2 (480 Mbit/s) it reads ~40 MB/s, too slow for big games.

## Layout

```
cartridge.json            manifest (below)
README.txt                for humans: what this is, how to set up a new machine
cover.jpg                 optional cover image (600x900 portrait), named in the manifest
SteamLibrary/             optional Steam library folder for Steam's own games (see Steam games)
cartridge/lib.sh          shared launcher helpers (host data folder, CPU build pick, seeding, logs)
cartridge/agent/          cartridge-agent.py, install.sh, uninstall.sh (installed per machine)
games/<game id>/
  launch.sh               what Steam runs; self-locating (works at any mount path)
  art/                    portrait.png hero.png logo.png horizontal.png icon.png (Steam artwork)
  defaults/               default settings copied to the host on a game's first start there
  builds/znver4/ builds/v3/   when a game has CPU-specific builds (see CPU builds)
  ...                     the game's own files (game data, app folder)
```

`cartridge.json`:

```json
{
 "format": 1,
 "id": "zelda",
 "name": "Zelda",
 "games": [
  {"id": "oot", "title": "The Legend of Zelda - Ocarina of Time Remake",
   "launch": "games/oot/launch.sh", "art": "games/oot/art"}
 ]
}
```

- `id` identifies the cartridge across machines and mount paths; game `id`s are unique within it and
  also name the game's host folder, so the same game on two cartridges shares one save.
- `title` is the Steam library name. Steam Input keeps non-Steam controller layouts per name, so
  keep titles stable.
- Optional fields (readers ignore what they don't know, so the format stays 1): `"cover":
  "cover.jpg"` (image path on the cartridge, the label art), `"color": "#d1a23a"` (the shell colour
  UIs draw the cartridge in), and `"home": true` on a home cartridge (below).
- A new cartridge's `id` is its name in lowercase plus four random hex digits (`mario-3f2a`), so two
  friends' cartridges called "Games" don't collide. Renaming changes `name` and the ext4 label, never
  `id`.

## Home cartridge (a machine's internal storage)

`~/Games/HomeCartridge/` has the same layout (`cartridge.json` with `"id": "home"`, `"home": true`,
`cartridge/`, `games/<id>/`) and is always present. It never travels, it just gives games on
internal storage the same shape as games on a cartridge. So copying or moving a game anywhere
(cartridge to cartridge, cartridge to this machine, back) is the same operation:

1. copy `games/<id>/` to the target as `games/.<id>.partial`, check file count and bytes, rename it
2. bring `cartridge/` along when the target lacks it or has an older one (`lib.sh` only ever gains
   helpers, never changes one, so the copy with every helper of the other wins; the agent goes by
   `AGENT_VERSION`)
3. add the game's manifest entry (unchanged: `launch` and `art` are relative) to the target
4. for a move: drop the entry from the source manifest, then delete the source folder

Saves are not part of it: they are on the machine already (`cart_data`), whichever copy runs.

Which games can do this: games in this layout (a `games/<id>/` folder with a self-locating
`launch.sh` that keeps its writes in `cart_data`). Other non-Steam shortcuts (an AppImage in
`~/Games`, an emulator with its own config folder) have to be converted by hand first: give them a
`launch.sh` that sources `cartridge/lib.sh` and points their saves at `cart_data`, as the Zelda
games do. Steam's own games: see below.
## Host side (the rule that keeps saves home)

Everything a game writes goes to `~/.local/share/game-cartridges/<game id>/` on the machine it runs
on: saves, settings, keys, shader and pipeline caches, logs. The cartridge holds only shareable,
read-mostly data. Launchers get that folder from `cart_data <game id>` in `cartridge/lib.sh` and
seed `defaults/` into it on the first start (never overwriting). Launchers pick Steam Deck
friendly defaults when `cart_is_deck`.

## CPU builds

Games compiled by us ship `builds/znver4` (this PC: Zen 4, AVX-512) and/or `builds/v3`
(x86-64-v3: Steam Deck, Intel since Haswell, AMD since Zen 1). `cart_build <builds dir>` picks the
fastest one the CPU runs. Native builds must not need a newer glibc than SteamOS ships (keep the
highest `GLIBC_x` version at 2.41 or older) and bundle their non-system libraries.

## Agent (per machine)

`cartridge/agent/cartridge-agent.py`, a systemd user service (`game-cartridges.service`, installed by
`install.sh`). It is the only component that adds or hides Steam shortcuts for cartridge games (the
Decky plugin never does; it asks the agent to look again). It reads the home cartridge and every
mount under `/run/media`, `/media`, `/mnt` with a `cartridge.json` every 3 seconds (only the mount
table and manifests; Steam is contacted when something changed), wakes early on mount changes and on
`SIGUSR1`, and makes Steam match:

- one shortcut per game id. A game on several present cartridges gets one shortcut that runs the
  home copy if there is one, else the copy it already runs, else the first mounted one
- game present and not yet known: `SteamClient.Apps.AddShortcut` + name/exe/start dir + artwork
  (`SetCustomArtworkForApp`, slots 0 portrait, 1 hero, 2 logo, 3 wide; `SetShortcutIcon`)
- known game: unhide (`collectionStore.SetAppsAsHidden([id], false)`), point exe/start dir at the
  chosen copy when it changed (the game moved, or its cartridge mounted elsewhere), rename on a
  `title` change. The app id stays, and with it play time, collections and controller layout
- game on no present cartridge: hide it (kept with its app id, play time and settings)

It talks to Steam through the CEF debug port on 127.0.0.1:8080 (SharedJSContext), which exists when
`~/.steam/steam/.cef-enable-remote-debugging` is present (Decky Loader creates it; install.sh does
too). State: `~/.local/share/game-cartridges/agent-state.json`, keyed by game id (`AGENT_VERSION` 2;
version 1 keyed `<cartridge id>|<game id>` and is migrated on start, same app ids). Steam gives a
shortcut a new random app id each time it is added, which is why games are hidden, not deleted.

## Decky plugin

`main.py`, `src/` (repo root). A UI for cartridges in Game Mode: format a USB drive into an empty
cartridge (name, optional cover), list plugged-in cartridges and the home cartridge with free space,
cover, games and a USB 2 warning, copy/move/remove games, rename, change the cover, eject, and a
"Game cartridge..." entry in a game's options menu in the library. Its backend runs as root (for
`mkfs`); every file on a cartridge or in the home folder is written by `backend/cart_worker.py`
running as the user. It installs or updates the agent from its own copy when asked, and puts its
newest `cartridge/` runtime on every cartridge it formats or copies a game to.

In Steam, each plugged-in cartridge also gets a collection with its name holding its games. Steam
collections can't have a custom image, so the cover is shown in the plugin (and stays on the
cartridge for any other tool).

Formatting (also `tools/format-cartridge.sh`): one GPT partition, `mkfs.ext4 -m 0 -O casefold -E
nodiscard,root_owner=<uid>:<gid> -L <name, max 16 bytes>`, then mounted the way the OS auto-mounts a
plugged-in drive: `steamos-automount.sh add <partition>` (Bazzite `/usr/libexec/hwsupport`, SteamOS
`/usr/lib/hwsupport`), which mounts through udisks at `/run/media/<user>/<label>`. Its udev handler
skips synthetic `add` events ("not inserted recently"), so the script is called directly.
The plugin only offers USB disks with no mounts outside `/run/media`, `/media`, `/mnt`, and only
erases the drive the user confirmed (model, size and partitions are checked again before erasing).

Ejecting: the plugin first looks for programs that keep the drive busy (open files, working folder,
program or mapped library on it, like `fuser -m`). It lists them and closes the user's own ones only
when asked (Dusklight's `crashpad_handler`, for one, can outlive the game); Steam and the session are
never closed. Then it unmounts and powers the drive off.

## Steam games

A cartridge can carry a Steam library: `SteamLibrary/` at its root, added in Steam
(`SteamClient.InstallFolder.AddInstallFolder`) and labelled with the cartridge name. Steam games move
there with Steam's own "Move install folder" (`MoveInstallFolderForApp`); the plugin offers this for
installed Steam games. Worth it for big Steam games you play on your own machines: Steam does the
copying, updates and verification. Limits: on another machine the library has to be added once in
Steam's storage settings, and the game needs that account (or Family Sharing); unplugged, the games
show as not installed rather than hidden; and Proton prefixes (`steamapps/compatdata`) live in the
library, so saves of Proton games without Steam Cloud travel with the cartridge (the one exception to
"saves stay home").
