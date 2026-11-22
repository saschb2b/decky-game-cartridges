@NAME@ - GAME CARTRIDGE
=======================

This drive is a game cartridge. Plug it into a Bazzite PC or a Steam Deck and its games show up in
the Steam library; unplug it and they are hidden again. Saves and settings stay on each machine.

Use a USB 3 port (blue/teal/red, or USB-C). On a USB 2 port the games load very slowly.


NEW MACHINE (once per machine)
------------------------------
With the "Game Cartridges" Decky plugin: open it in the Quick Access menu and press
"Install service" if it asks.

Without Decky: Desktop mode -> Konsole (or ssh), then

    bash "/run/media/$USER/<this drive's name>/cartridge/agent/install.sh"

If it says so, restart Steam once (or reboot). Back in Game Mode the games are in the library.

That installs a small background service (game-cartridges) for your user only. It watches for
cartridges and adds/hides their games in Steam through Steam's local debug port (127.0.0.1:8080,
the same one Decky Loader uses). Nothing on a cartridge runs until you press Play.
Only plug in cartridges you trust: Play runs the cartridge's launch.sh.

Remove it again:  bash ~/.local/share/game-cartridges/agent/uninstall.sh


WHERE THINGS ARE
----------------
cartridge.json       what is on this cartridge (games, name, cover)
games/<game>/        game files, builds, artwork, default settings
cartridge/           launcher helpers and the agent
On each machine:     ~/.local/share/game-cartridges/<game>/  saves, settings, shader caches, logs
