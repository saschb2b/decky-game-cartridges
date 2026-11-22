#!/usr/bin/env bash
# The Wind Waker HD: ZeldaWWHDRecomp v0.5.1, a static recompilation (native x86-64, Vulkan).
# Cartridge: game/ (EUR disc files), builds/<znver4|v3>/, defaults/user/ (settings + controls).
# Host: $(cart_data wwhd)/save (saves), user/ (settings, controls, states, shader caches), logs/.
set -euo pipefail
GAME=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$GAME/../../cartridge/lib.sh"
DATA=$(cart_data wwhd)
BUILD=$(cart_build "$GAME/builds")
if [[ ! -d $DATA/user ]]; then
    # First start on this machine. The big-screen settings (4K, 60 fps, not handheld) fit a PC on a
    # TV; a Steam Deck keeps the port's own handheld defaults and only takes the controls.
    if cart_is_deck; then
        mkdir -p "$DATA/user"; cp -n "$GAME/defaults/user/controls.json" "$DATA/user/" 2>/dev/null || true
    else
        cart_seed "$GAME/defaults/user" "$DATA/user"
    fi
fi
mkdir -p "$DATA/save" "$DATA/user" "$DATA/mesa-cache"
cart_session_env
# SDL3 on X11 (gamescope's XWayland); HDR still reaches the TV through gamescope.
export SDL_VIDEO_DRIVER=x11
export MESA_SHADER_CACHE_DIR=$DATA/mesa-cache
export MESA_SHADER_CACHE_MAX_SIZE=16G
export WWHD_USER_DIR=$DATA/user
cart_logs "$DATA/logs"
exec >"$DATA/logs/last_run.log" 2>&1
echo "wwhd cartridge launch: build $BUILD, $(date -Iseconds)"
exec "$GAME/builds/$BUILD/wwhd" --game "$GAME/game" --save "$DATA/save" "$@"
