# Shared helpers for the launchers on a game cartridge (sourced, not run).
#
# Rule of the cartridge: the drive holds only things every machine can share (game files, builds,
# artwork, default settings). Everything a machine writes (saves, settings, keys, shader caches,
# logs) lives on that machine in $(cart_data <game>), so saves stay home when the cartridge moves.

# The host folder for one game: ~/.local/share/game-cartridges/<game id>
cart_data() {
    printf '%s/game-cartridges/%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}" "$1"
}

# Is this machine a Steam Deck (LCD or OLED)?
cart_is_deck() {
    [[ $(cat /sys/class/dmi/id/board_vendor 2>/dev/null) == Valve ]]
}

# CPU level: znver4 (Zen 4/5 class: AVX-512 with BF16, VBMI2, GFNI, VAES...), v3 (AVX2/FMA/BMI2:
# Steam Deck, Intel since Haswell, AMD since Zen 1) or base.
cart_cpu_level() {
    local flags
    flags=" $(grep -m1 '^flags' /proc/cpuinfo | cut -d: -f2) "
    _cart_has() { local x; for x; do [[ $flags == *" $x "* ]] || return 1; done; }
    if _cart_has avx512f avx512cd avx512bw avx512dq avx512vl avx512ifma avx512vbmi avx512_vbmi2 \
        avx512_vnni avx512_bitalg avx512_vpopcntdq avx512_bf16 gfni vaes vpclmulqdq sha_ni; then
        echo znver4
    elif _cart_has avx2 fma bmi1 bmi2 f16c movbe; then
        echo v3
    else
        echo base
    fi
}

# The fastest build in <builds dir> this CPU can run (folder names: znver4, v3).
# CART_BUILD=<folder> forces one.
cart_build() {
    local dir=$1 level b
    if [[ -n ${CART_BUILD:-} ]]; then echo "$CART_BUILD"; return; fi
    level=$(cart_cpu_level)
    case $level in
        znver4) for b in znver4 v3; do [[ -d $dir/$b ]] && { echo "$b"; return; }; done ;;
        v3) [[ -d $dir/v3 ]] && { echo v3; return; } ;;
    esac
    echo "cartridge: no build in $dir runs on this CPU (level $level)" >&2
    return 1
}

# First start of a game on this machine: copy the cartridge's default settings into the host folder.
# Never overwrites what is there. cart_seed <defaults dir> <host dir>
cart_seed() {
    local src=$1 dst=$2
    [[ -d $src ]] || return 0
    mkdir -p "$dst"
    cp -rn --no-preserve=ownership "$src/." "$dst/"
}

# Keep the last five console logs: cart_logs <dir> (then redirect output to <dir>/last_run.log)
cart_logs() {
    local L=$1 i
    mkdir -p "$L"
    for i in 4 3 2; do [[ -f $L/last_run.$((i - 1)).log ]] && mv -f "$L/last_run.$((i - 1)).log" "$L/last_run.$i.log"; done
    [[ -f $L/last_run.log ]] && mv -f "$L/last_run.log" "$L/last_run.1.log"
    return 0
}

# Session bits a game needs when Steam starts it from Game Mode or Desktop mode.
cart_session_env() {
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
    # Controller: Steam Input's virtual pad only, not the Steam Controller's raw HID as well.
    export SDL_JOYSTICK_HIDAPI_STEAM=0
    export SDL_GAMECONTROLLER_ALLOW_STEAM_VIRTUAL_GAMEPAD=1
}
