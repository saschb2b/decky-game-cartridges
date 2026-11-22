#!/usr/bin/env bash
# Tears of the Kingdom: TotK Recomp 0.3.13 (static recompilation, native x86-64-v3, Vulkan).
# Cartridge: app/ (game files, translated shaders, totk.ini settings). It picks Steam Deck defaults
# on its own for the keys totk.ini leaves open.
# Host: $(cart_data totk)/profile (saves, play time), pipeline-cache.bin and mesa-cache/ (this GPU's
# compiled pipelines), screenshots/.
set -euo pipefail
GAME=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$GAME/../../cartridge/lib.sh"
DATA=$(cart_data totk)
level=$(cart_cpu_level)
[[ $level != base ]] || { echo "TotK Recomp needs an x86-64-v3 CPU (AVX2)" >&2; exit 1; }
mkdir -p "$DATA/profile" "$DATA/mesa-cache" "$DATA/screenshots"
cart_session_env
# XWayland exposes the focused game window to Steam Input in Gamescope.
if [[ "${XDG_CURRENT_DESKTOP,,}" == gamescope || -n "${GAMESCOPE_WAYLAND_DISPLAY:-}" ]]; then
    export SDL_VIDEODRIVER=x11
fi
export MESA_SHADER_CACHE_DIR=$DATA/mesa-cache
export TOTK_PIPELINE_CACHE=$DATA/pipeline-cache.bin
export TOTK_SHOTS_DIR=$DATA/screenshots
cd "$GAME/app"
exec ./totk --profile "$DATA/profile" "$@"
