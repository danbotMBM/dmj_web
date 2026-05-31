#!/bin/bash
set -e

SRC_DIR="/home/danbot/dev/dmj_web"
DEST_DIR="/opt/dmj_web"
DEV_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--dev)
            DEV_MODE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [-d|--dev]"
            exit 1
            ;;
    esac
done

# Validate trivia questions before doing anything else
#echo "Validating trivia questions..."
# "$SRC_DIR/backend"
#go build -o trivia_validator ./validate_trivia/ || { echo "Failed to build trivia validator"; exit 1; }
#./trivia_validator || exit 1

# Build the static site with Eleventy. Pages are assembled from _includes +
# content (.njk / .md) into $SRC_DIR/_site, which is what nginx serves.
echo "Building static site with Eleventy..."
cd "$SRC_DIR"
npm install --no-audit --no-fund
npx @11ty/eleventy

if [ "$DEV_MODE" = true ]; then
    echo "=== DMJ Web Dev Mode ==="
    echo "Static site built to $SRC_DIR/_site (nginx dev root)."
    echo "Tip: for live-reloading static changes, run 'npm run serve' in another terminal."

    # Build the Go backend
    echo "Building backend..."
    cd "$SRC_DIR/backend"
    go build -o server

    # Run backend in foreground on port 8901
    echo "Starting backend on port 8901 (foreground)..."
    PORT=8901 CORS_ORIGIN="https://danbotlab" ./server
else
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
        --exclude='node_modules' \
        --exclude='deploy.sh' \
        --exclude='README.md' \
        --exclude='SECURITY_AUDIT.md' \
        --exclude='*.go' \
        --exclude='go.mod' \
        --exclude='go.sum' \
        --exclude='backend/hashpw/' \
        --exclude='backend/validate_trivia/' \
        --exclude='backend/cronjobs/strava_runs.json' \
        --exclude='backend/running.json' \
        --exclude='backend/trivia_analytics.db' \
        --exclude='backend/trivia_analytics.db-wal' \
        --exclude='backend/trivia_analytics.db-shm' \
        "$SRC_DIR/" "$DEST_DIR/"

    # Copy backend binary
    echo "Copying backend binary..."
    sudo cp "$SRC_DIR/backend/server" "$DEST_DIR/backend/"

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

    echo "=== Deploy complete ==="
    sudo systemctl status dmj-backend --no-pager
fi
