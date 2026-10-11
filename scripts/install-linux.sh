#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
pdf_dir=$(CDPATH= cd -- "${1:-$HOME}" && pwd)
host_name="${PDF_PRESENTER_HOST:-$(hostname -s)}"
node_bin=$(command -v node || true)
user_name=$(id -un)
service_name="pdf-presenter-network.service"
service_file="/etc/systemd/system/$service_name"
launcher_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pdf-presenter-network"
desktop_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

if [ -z "$node_bin" ]; then
  printf '%s\n' "Node.js was not found in PATH." >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' "Run this installer as the desktop user, not as root." >&2
  exit 1
fi

printf '%s\n' "Building PDF Presenter Network..."
cd "$project_root"
npx --yes pnpm@9 build

mkdir -p "$launcher_dir" "$desktop_dir"
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
sudo systemctl enable --now "$service_name"

printf '\nInstalled PDF Presenter Network.\n'
printf '  Audience: http://%s/\n' "$host_name"
printf '  Files:    http://%s/list\n' "$host_name"
printf '  App:      PDF Presenter Network (application menu)\n'
printf '\nThe service starts with %s as its initial listing directory.\n' "$pdf_dir"
printf '%s\n' 'Use Open PDF in the browser to select a PDF from anywhere.'