#!/usr/bin/env bash
# Twilight Princess: Dusklight v2.0.3 (TwilitRealm's reimplementation), official Linux build.
# Cartridge: apps/v2.0.3/ (the extracted AppImage), game/ (USA GameCube disc), defaults/user/.
# Host: $(cart_data dusklight)/user (memory card saves, config, achievements, caches), logs/.
set -euo pipefail
GAME=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$GAME/../../cartridge/lib.sh"
DATA=$(cart_data dusklight)
APP=${DUSK_APP:-v2.0.3}
DISC="$GAME/game/Legend of Zelda, The - Twilight Princess (USA).rvz"
if [[ ! -d $DATA/user ]] && ! cart_is_deck; then
    cart_seed "$GAME/defaults/user" "$DATA/user"
fi
mkdir -p "$DATA/user" "$DATA/mesa-cache"
cart_session_env
# SDL3 on X11 (gamescope's XWayland).
export SDL_VIDEO_DRIVER=x11
export MESA_SHADER_CACHE_DIR=$DATA/mesa-cache
export MESA_SHADER_CACHE_MAX_SIZE=4G
cart_logs "$DATA/logs"
exec >"$DATA/logs/last_run.log" 2>&1
echo "dusklight cartridge launch: $APP, $(date -Iseconds)"
exec "$GAME/apps/$APP/usr/bin/dusklight" --backend vulkan --log-level info --user-dir "$DATA/user" "$@" "$DISC"
