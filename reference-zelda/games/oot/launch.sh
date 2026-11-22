#!/usr/bin/env bash
# Ocarina of Time (Switch 2 version) in Fritchii (Frizti's Lichii fork), native Linux.
# Cartridge: game/ocarina-of-time.nup, builds/<znver4|v3>/, defaults/user/ (settings + keys).
# Host: $(cart_data oot)/user (saves, settings, shader caches, logs), mesa-cache/ (prepared pipelines).
set -euo pipefail
GAME=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$GAME/../../cartridge/lib.sh"
DATA=$(cart_data oot)
BUILD=$(cart_build "$GAME/builds")
mkdir -p "$DATA"
if [[ ! -d $DATA/user ]]; then
    # First start on this machine: default settings and keys, with the host's own folders.
    cart_seed "$GAME/defaults/user" "$DATA/user"
    sed -i "s|@USER_DIR@|$DATA/user|g" "$DATA/user/config/qt-config.ini"
    if cart_is_deck; then
        # Handheld: the Switch's handheld mode renders for the Deck's 800p screen.
        sed -i 's|^use_docked_mode\\default=.*|use_docked_mode\\default=false|; s|^use_docked_mode=.*|use_docked_mode=0|' \
            "$DATA/user/config/qt-config.ini"
    fi
fi
cart_session_env
export QT_QPA_PLATFORM=xcb
export SDL_VIDEODRIVER=x11
# AMD's RGBA8 copies of uneven-mip ASTC textures: not needed on RADV (no seams), ~7% faster without.
export EDEN_NX2_UNEVEN_MIP_RGBA8="${EDEN_NX2_UNEVEN_MIP_RGBA8:-0}"
# Prepared pipelines go to Mesa's disk cache: one fixed host folder, big enough for all 120k.
export MESA_SHADER_CACHE_DIR=$DATA/mesa-cache
export MESA_SHADER_CACHE_MAX_SIZE=16G
# Fritchii uses ./user as its portable folder, so start it in the host folder.
cd "$DATA"
exec "$GAME/builds/$BUILD/run-lichii" -f -g "$GAME/game/ocarina-of-time.nup" "$@"
