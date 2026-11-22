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
`install.sh`). It watches `/proc/self/mountinfo` and, for every mount under `/run/media`, `/media`,
`/mnt` with a `cartridge.json`, makes Steam match:

- game present and not yet known: `SteamClient.Apps.AddShortcut` + name/exe/start dir + artwork
  (`SetCustomArtworkForApp`, slots 0 portrait, 1 hero, 2 logo, 3 wide; `SetShortcutIcon`)
- known game whose cartridge is back: unhide (`collectionStore.SetAppsAsHidden([id], false)`), fix
  the exe/start dir if the mount path changed
- cartridge gone: hide its games (kept with their app id, play time and settings)

It talks to Steam through the CEF debug port on 127.0.0.1:8080 (SharedJSContext), which exists when
`~/.steam/steam/.cef-enable-remote-debugging` is present (Decky Loader creates it; install.sh does
too). State: `~/.local/share/game-cartridges/agent-state.json`, keyed `<cartridge id>|<game id>`.
Steam gives a shortcut a new random app id each time it is added, which is why games are hidden on
unplug instead of deleted.
