#!/bin/sh
set -eu

host="${PDF_PRESENTER_HOST:-$(hostname -s)}"
url="http://${host}/list"
profile="${XDG_DATA_HOME:-$HOME/.local/share}/pdf-presenter-network/chrome-profile"
service_name="pdf-presenter-network.service"

# Ask whether to stop the service too. The server exits cleanly, so systemd
# (Restart=on-failure) leaves it stopped until the next launch.
ask_stop_service() {
  question="Stop the PDF Presenter service too? Audience screens will show the waiting page."
  if command -v zenity >/dev/null 2>&1; then
    zenity --question --title="PDF Presenter Network" --text="$question" 2>/dev/null || return 0
  elif command -v kdialog >/dev/null 2>&1; then
    kdialog --title "PDF Presenter Network" --yesno "$question" 2>/dev/null || return 0
  else
    return 0
  fi
  curl -fsS -X POST "http://${host}/api/quit" >/dev/null 2>&1 || true
}

for browser in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$browser" >/dev/null 2>&1; then
    # Already open: the browser hands the URL to the running instance and
    # returns at once, so there is nothing to wait for.
    if pgrep -f -- "--user-data-dir=$profile" >/dev/null 2>&1; then
      exec "$browser" --user-data-dir="$profile" --app="$url"
    fi

    # Start the service if a previous session stopped it. A polkit rule from
    # install-linux.sh allows this without a password.
    if ! systemctl is-active --quiet "$service_name"; then
      systemctl start "$service_name" || true
      tries=0
      while [ "$tries" -lt 20 ] && ! curl -fs -o /dev/null "http://${host}/api/current" 2>/dev/null; do
        sleep 0.5
        tries=$((tries + 1))
      done
    fi

    "$browser" --user-data-dir="$profile" --app="$url" || true
    ask_stop_service
    exit 0
  fi
done

if command -v xdg-open >/dev/null 2>&1; then
  exec xdg-open "$url"
fi

printf '%s\n' "No supported browser was found. Open $url manually." >&2
exit 1
