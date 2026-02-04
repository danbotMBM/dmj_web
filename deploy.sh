#!/bin/bash
set -e

SRC_DIR="/home/danbot/dev/dmj_web"
DEST_DIR="/opt/dmj_web"

echo "=== DMJ Web Production Deploy ==="

# Build the Go backend
echo "Building backend..."
cd "$SRC_DIR/backend"
go build -o server

# Create destination directory
echo "Creating $DEST_DIR..."
sudo mkdir -p "$DEST_DIR/backend"

# Copy web files (excluding dev/git stuff)
echo "Copying web files..."
sudo rsync -av --delete \
    --exclude='.git' \
    --exclude='.gitignore' \
    --exclude='.claude' \
    --exclude='deploy.sh' \
    --exclude='README.md' \
    "$SRC_DIR/" "$DEST_DIR/"

# Copy backend binary
echo "Copying backend binary..."
sudo cp "$SRC_DIR/backend/backend" "$DEST_DIR/backend/"

# Set ownership
sudo chown -R danbot:danbot "$DEST_DIR"
sudo chmod -R 770 "$DEST_DIR/backend"

# Install systemd service
echo "Installing systemd service..."
sudo cp "$SRC_DIR/backend/dmj-backend.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable dmj-backend

# Restart the service
echo "Restarting service..."
sudo systemctl restart dmj-backend

echo "=== Deploy complete ==="
sudo systemctl status dmj-backend --no-pager
