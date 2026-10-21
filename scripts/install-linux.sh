#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
host_name="${PDF_PRESENTER_HOST:-$(hostname -s)}"
node_bin=$(command -v node || true)
user_name=$(id -un)
service_name="pdf-presenter-network.service"
service_file="/etc/systemd/system/$service_name"
launcher_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pdf-presenter-network"
desktop_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
bin_dir="$HOME/.local/bin"

# Default to the directory of an existing installation so updates keep it.
default_dir=$(sed -n 's/^WorkingDirectory=//p' "$service_file" 2>/dev/null || true)
[ -n "$default_dir" ] && [ -d "$default_dir" ] || default_dir="$HOME"
pdf_dir=$(CDPATH= cd -- "${1:-$default_dir}" && pwd)

if [ -z "$node_bin" ]; then
  printf '%s\n' "Node.js was not found in PATH." >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' "Run this installer as the desktop user, not as root." >&2
  exit 1
fi

cd "$project_root"
# A git checkout is built here; a release tarball ships a prebuilt dist/.
if [ -d "$project_root/.git" ] || [ ! -f "$project_root/dist/pdf-presenter.js" ]; then
  printf '%s\n' "Building PDF Presenter Network..."
  npx --yes pnpm@9 build
fi

mkdir -p "$launcher_dir" "$desktop_dir" "$bin_dir"
ln -sf "$project_root/dist/pdf-presenter.js" "$bin_dir/pdf-presenter"
# Release installs only; a git checkout is updated with git.
if [ ! -d "$project_root/.git" ]; then
  ln -sf "$project_root/scripts/update.sh" "$bin_dir/pdf-presenter-update"
fi
cp "$project_root/scripts/launch-linux.sh" "$launcher_dir/launch.sh"
chmod 755 "$launcher_dir/launch.sh"

printf '%s\n' "Installing $service_name (requires administrator permission)..."
sudo tee "$service_file" >/dev/null <<EOF
[Unit]
Description=PDF Presenter Network
After=network.target

[Service]
Type=simple
User=$user_name
WorkingDirectory=$pdf_dir
ExecStart="$node_bin" "$project_root/dist/pdf-presenter.js" "$pdf_dir" --port 80 --no-open
Restart=on-failure
RestartSec=2
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat > "$desktop_dir/pdf-presenter-network.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=PDF Presenter Network
Comment=Open the PDF Presenter Network browser app
Exec=$launcher_dir/launch.sh
Icon=$project_root/src/ui/favicon.svg
Terminal=false
Categories=Office;Presentation;
StartupWMClass=PDF Presenter Network
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$service_name"
sudo systemctl restart "$service_name"

printf '\nInstalled PDF Presenter Network.\n'
printf '  Audience: http://%s/\n' "$host_name"
printf '  Files:    http://%s/list\n' "$host_name"
printf '  App:      PDF Presenter Network (application menu)\n'
printf '  CLI:      %s/pdf-presenter\n' "$bin_dir"
printf '  Update:   %s/pdf-presenter-update\n' "$bin_dir"
printf '\nThe service starts with %s as its initial listing directory.\n' "$pdf_dir"
printf '%s\n' 'Use Open PDF in the browser to select a PDF from anywhere.'