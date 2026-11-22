#!/usr/bin/env bash
# Sets up game cartridges on this machine (once per machine, any Bazzite PC or Steam Deck):
# from then on, plugging in a cartridge adds its games to the Steam library, unplugging hides them.
# Run it from Desktop mode (Konsole) or over ssh:  bash /run/media/$USER/<cartridge>/cartridge/agent/install.sh
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
D=${XDG_DATA_HOME:-$HOME/.local/share}/game-cartridges/agent
UNIT=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/game-cartridges.service
command -v python3 >/dev/null || { echo "python3 is missing"; exit 1; }
mkdir -p "$D" "$(dirname "$UNIT")"
install -m 755 "$HERE/cartridge-agent.py" "$D/cartridge-agent.py"
install -m 755 "$HERE/uninstall.sh" "$D/uninstall.sh"
cat > "$UNIT" <<EOF
[Unit]
Description=Game cartridges: games on plugged-in cartridge drives appear in the Steam library

[Service]
ExecStart=/usr/bin/python3 -I $D/cartridge-agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable game-cartridges.service >/dev/null
systemctl --user restart game-cartridges.service
echo "Installed: game-cartridges.service (log: journalctl --user -u game-cartridges)"
# The agent adds shortcuts through Steam's local debug port (127.0.0.1 only), like Decky Loader.
# Steam opens it when this file exists; it takes effect the next time Steam starts.
FLAG=$HOME/.steam/steam/.cef-enable-remote-debugging
if [[ -d $HOME/.steam/steam && ! -e $FLAG ]]; then
    touch "$FLAG"
    echo "Steam's debug port was off: restart Steam once (or reboot) and the cartridge's games appear."
elif ! curl -s -m 2 http://127.0.0.1:8080/json >/dev/null 2>&1; then
    echo "Steam is not running or its debug port is not up yet: the games appear once Steam runs."
else
    echo "Steam is ready: the games of plugged-in cartridges appear in a few seconds."
fi
