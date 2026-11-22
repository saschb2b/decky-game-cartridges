#!/usr/bin/env bash
# Removes the game cartridges agent from this machine. Saves and settings in
# ~/.local/share/game-cartridges/<game> stay; delete that folder yourself if you want them gone.
# Shortcuts the agent made stay in Steam (hidden ones under Hidden); remove them in Steam if you like.
set -euo pipefail
systemctl --user disable --now game-cartridges.service 2>/dev/null || true
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/game-cartridges.service"
systemctl --user daemon-reload
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/game-cartridges/agent"
echo "game-cartridges agent removed"
