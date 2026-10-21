#!/bin/sh
# Remove PDF Presenter Network: systemd service, app-menu entry, CLI links,
# and ~/.local/share/pdf-presenter-network (release files and browser profile).
#
#   curl -fsSL https://github.com/ValentinHerrmann/pdf-presenter-network/releases/latest/download/uninstall.sh | sh
set -eu

service_name="pdf-presenter-network.service"
service_file="/etc/systemd/system/$service_name"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pdf-presenter-network"
desktop_file="${XDG_DATA_HOME:-$HOME/.local/share}/applications/pdf-presenter-network.desktop"
bin_dir="$HOME/.local/bin"

if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' "Run this uninstaller as the desktop user, not as root." >&2
  exit 1
fi

if [ -f "$service_file" ]; then
  printf '%s\n' "Removing $service_name (requires administrator permission)..."
  sudo systemctl disable --now "$service_name" || true
  sudo rm -f "$service_file"
  sudo systemctl daemon-reload
fi

rm -f "$desktop_file"

# Only remove links that are ours (e.g. not an npm global install).
for link in "$bin_dir/pdf-presenter" "$bin_dir/pdf-presenter-update"; do
  if [ -L "$link" ]; then
    case "$(readlink "$link")" in
      */pdf-presenter-network/*) rm -f "$link" ;;
    esac
  fi
done

rm -rf "$data_dir"

printf '%s\n' "Uninstalled PDF Presenter Network."
