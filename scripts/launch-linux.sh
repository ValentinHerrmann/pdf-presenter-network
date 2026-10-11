#!/bin/sh
set -eu

host="${PDF_PRESENTER_HOST:-$(hostname -s)}"
url="http://${host}/list"
profile="${XDG_DATA_HOME:-$HOME/.local/share}/pdf-presenter-network/chrome-profile"

for browser in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$browser" >/dev/null 2>&1; then
    exec "$browser" --user-data-dir="$profile" --app="$url"
  fi
done

if command -v xdg-open >/dev/null 2>&1; then
  exec xdg-open "$url"
fi

printf '%s\n' "No supported browser was found. Open $url manually." >&2
exit 1