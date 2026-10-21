#!/bin/sh
# Download a PDF Presenter Network release from GitHub and install it.
#
#   curl -fsSL https://github.com/ValentinHerrmann/pdf-presenter-network/releases/latest/download/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- /path/to/pdf-directory
#
# Set PDF_PRESENTER_VERSION=v1.2.3 to install a specific release instead of the latest.
# Re-run to upgrade; the existing service and launcher are updated in place.
set -eu

repo="ValentinHerrmann/pdf-presenter-network"
version="${PDF_PRESENTER_VERSION:-latest}"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pdf-presenter-network"
app_dir="$data_dir/app"

if [ "$version" = "latest" ]; then
  url="https://github.com/$repo/releases/latest/download/pdf-presenter-network.tar.gz"
else
  url="https://github.com/$repo/releases/download/$version/pdf-presenter-network.tar.gz"
fi

if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' "Run this installer as the desktop user, not as root." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "Node.js (>= 18) is required but was not found in PATH." >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

printf 'Downloading %s...\n' "$url"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp/release.tar.gz"
else
  wget -qO "$tmp/release.tar.gz" "$url"
fi
tar -xzf "$tmp/release.tar.gz" -C "$tmp"

mkdir -p "$data_dir"
rm -rf "$app_dir.old"
if [ -d "$app_dir" ]; then
  mv "$app_dir" "$app_dir.old"
fi
mv "$tmp/pdf-presenter-network" "$app_dir"
rm -rf "$app_dir.old"

sh "$app_dir/scripts/install-linux.sh" "$@"
