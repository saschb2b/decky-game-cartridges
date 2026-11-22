#!/usr/bin/env bash
# format-cartridge.sh <whole-disk path> <label>
# Turns a USB SSD into a game cartridge: one GPT partition, ext4 (the format SteamOS and Bazzite
# auto-mount, same options Steam uses for SD cards), owned by the calling user, then auto-mounts it.
# Run with sudo. ERASES THE WHOLE DISK.
set -euo pipefail
DISK=${1:?usage: format-cartridge.sh /dev/disk/by-id/<disk> <label>}
LABEL=${2:?label missing}
[[ $EUID -eq 0 ]] || { echo "run with sudo"; exit 1; }
OWNER="${SUDO_UID:-1000}:${SUDO_GID:-1000}"
DEV=$(readlink -f "$DISK")
[[ $DEV =~ ^/dev/sd[a-z]$ ]] || { echo "$DISK -> $DEV is not a whole SATA/USB disk"; exit 1; }
TRAN=$(lsblk -dno TRAN "$DEV"); SIZE=$(lsblk -dbno SIZE "$DEV")
[[ $TRAN == usb ]] || { echo "$DEV is not a USB disk (tran=$TRAN)"; exit 1; }
(( SIZE < 600 * 1000**3 )) || { echo "$DEV is larger than 600 GB; refusing"; exit 1; }
if lsblk -no MOUNTPOINTS "$DEV" | grep -q .; then echo "$DEV has mounted partitions; eject it first"; exit 1; fi
echo "Erasing $DEV ($(lsblk -dno MODEL "$DEV"), $((SIZE / 1000**3)) GB) as cartridge '$LABEL', owner $OWNER"
wipefs -a "$DEV"
parted --script "$DEV" mklabel gpt mkpart "$LABEL" ext4 0% 100%
udevadm settle
PART=${DEV}1
mkfs.ext4 -q -F -m 0 -O casefold -E "nodiscard,root_owner=$OWNER" -L "$LABEL" "$PART"
sync; udevadm settle
/usr/libexec/hwsupport/steamos-automount.sh add "${PART#/dev/}" || udisksctl mount -b "$PART" || true
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINTS "$DEV"
echo "done"
