#!/usr/bin/env bash
# Build, copy to the PC and install through Decky's own installer (its prompt confirmed over Steam's CEF).
# Needs a tunnel to Steam's debug port:  ssh -N -L 18090:127.0.0.1:8080 HOST   (CEF=http://127.0.0.1:18090)
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${HOST:?set HOST to the machine, e.g. HOST=user@bazzite-pc}
export CEF=${CEF:-http://127.0.0.1:18090}
SSH_OPTS=(-o BatchMode=yes ${KNOWN_HOSTS:+-o UserKnownHostsFile=$KNOWN_HOSTS})
pnpm run build >/dev/null
info=$(python3 tools/package.py)
sha=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['sha256'])" "$info")
version=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['version'])" "$info")
ssh "${SSH_OPTS[@]}" "$HOST" 'mkdir -p ~/.cache/game-cartridges-dev'
scp -q "${SSH_OPTS[@]}" out/game-cartridges.zip "$HOST:.cache/game-cartridges-dev/"
home=$(ssh "${SSH_OPTS[@]}" "$HOST" 'echo $HOME')
node tools/deck.mjs eval SharedJSContext "DeckyBackend.call('utilities/install_plugin', 'file://$home/.cache/game-cartridges-dev/game-cartridges.zip', 'Game Cartridges', '$version', '$sha', 0).then(() => 'requested')"
# Decky shows its confirmation after a moment; press it as soon as it is there.
for _ in $(seq 1 10); do
    sleep 1.5
    result=$(node tools/deck.mjs eval Big-Picture '(() => { const b = Array.from(document.querySelectorAll("button.DialogButton")).find(e => /^(Install|Installieren|Reinstall|Neu installieren|Update|Aktualisieren)/.test(e.textContent.trim())); if (!b) return ""; b.click(); return "confirmed: " + b.textContent.trim(); })()')
    case $result in *confirmed*) echo "$result"; break ;; esac
done
