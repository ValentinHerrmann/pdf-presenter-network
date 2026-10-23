#!/bin/sh
# Update an installed PDF Presenter Network to the latest GitHub release.
# Keeps the served directory of the existing installation.
#
#   pdf-presenter-update            # installed via install.sh
#   pdf-presenter-update --check    # only report whether an update is available
#
# The presenter's Update button runs this with PDF_PRESENTER_APP_ONLY=1, which
# refreshes the app without touching the service (see install-linux.sh).
set -eu

repo="ValentinHerrmann/pdf-presenter-network"
app_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pdf-presenter-network/app"

latest_url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")
latest="${latest_url##*/}"
case "$latest" in
  v*) ;;
  *) printf 'Could not determine the latest release (%s).\n' "$latest_url" >&2; exit 1 ;;
esac

installed="v$(node -p "require('$app_dir/package.json').version" 2>/dev/null || echo none)"

if [ "$installed" = "$latest" ]; then
  printf 'PDF Presenter Network %s is up to date.\n' "$installed"
  exit 0
fi

printf 'Update available: %s -> %s\n' "$installed" "$latest"
if [ "${1:-}" = "--check" ]; then
  exit 0
fi

curl -fsSL "https://github.com/$repo/releases/download/$latest/install.sh" | PDF_PRESENTER_VERSION="$latest" sh
